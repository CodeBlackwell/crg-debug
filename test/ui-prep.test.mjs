import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  auditRepo, auditEnv, auditFigma, parseMetadataNodes, scorecard, itemsSeal,
  buildPacket, verifyPacket, packetSealLines, verifyItem, ITEM_ORDER, PROFILE_CRITICAL,
} from '../lib/ui-prep.mjs'
import { sealOf } from '../lib/ui-measure.mjs'

// ---- repo audit ---------------------------------------------------------------------

const repoFiles = () => [
  { path: '/r/src/App.tsx', text: 'export const App = () => <div data-component="App">{routes}</div>\nconst r = [{ path: "/" }, { path: "/about" }]' },
  { path: '/r/src/Card.tsx', text: 'export const Card = () => <div style={{color: "#ff0000"}} />' },
  { path: '/r/src/lib/time.ts', text: 'export const now = () => window.__CRG_NOW__ ?? Date.now()' },
  { path: '/r/src/tokens.css', text: ':root { --color-primary: #123456; --color-bg: #fff; --gap-1: 4px; }\n@media (prefers-reduced-motion: reduce) { * { animation: none } }' },
]
const repoExtras = () => ({
  packageJson: { dependencies: { react: '^19' }, scripts: { dev: 'vite', build: 'vite build' } },
  gitHeadTime: 100, graphDbMtime: 200, fixturesDir: '/r/fixtures', storybook: false, appRoot: '.',
})

test('auditRepo computes statuses from facts, never judgment', () => {
  const res = auditRepo(repoFiles(), repoExtras())
  assert.equal(res.items['2.1'].status, 'pass')
  assert.equal(res.items['2.2'].status, 'pass')
  assert.equal(res.items['2.3'].status, 'gap', 'Card.tsx has no data-component')
  assert.match(res.items['2.3'].evidence, /1\/2/)
  assert.equal(res.items['2.4'].status, 'gap', 'Card.tsx has a raw hex literal')
  assert.equal(res.items['2.5'].status, 'pass', 'clock seam + reduced-motion present')
  assert.deepEqual(res.facts.routes, ['/', '/about'])
  assert.equal(res.items['2.8'].status, 'pass', 'graph newer than HEAD')
  assert.equal(res.items['2.9'].status, 'unknown', 'auth seam is never guessed')
  assert.equal(res.seal, itemsSeal(res.items))
})

test('auditRepo: stale graph and non-react manifest are gaps', () => {
  const res = auditRepo(repoFiles(), { ...repoExtras(), graphDbMtime: 50, packageJson: { dependencies: { vue: '3' }, scripts: {} } })
  assert.equal(res.items['2.8'].status, 'gap')
  assert.equal(res.items['2.1'].status, 'gap')
  assert.equal(res.items['2.2'].status, 'gap')
})

// ---- env audit -----------------------------------------------------------------------

test('auditEnv: probes by exit code; E2/E5 only when supplied', () => {
  const probeFn = cmd => (cmd === 'uv' ? { ok: true, out: 'uv 1.0' } : { ok: false, out: 'nope' })
  const res = auditEnv({ probeFn, e2: 'pass', e2Evidence: 'whoami ok', e5Dpr: 2 })
  assert.equal(res.items.E1.status, 'pass')
  assert.equal(res.items.E3.status, 'gap')
  assert.equal(res.items.E2.status, 'pass')
  assert.equal(res.items.E5.status, 'pass')
  assert.equal(res.dpr, 2)
  const bare = auditEnv({ probeFn })
  assert.equal(bare.items.E2.status, 'unknown')
  assert.equal(bare.items.E5.status, 'unknown')
})

// ---- figma audit ---------------------------------------------------------------------

const answers = () => ({
  breakpoints: [{ name: 'desktop', width: 1440, height: 900 }],
  screens: [{ name: 'Home', route: '/' }],
})

test('parseMetadataNodes reads both JSON and XML-ish dumps', () => {
  const json = JSON.stringify({ nodes: [{ id: '1:1', name: 'Home / Desktop', type: 'FRAME', children: [{ id: '1:2', name: 'Card', type: 'COMPONENT' }] }] })
  assert.deepEqual(parseMetadataNodes(json).map(n => n.type), ['FRAME', 'COMPONENT'])
  const xml = '<frame id="1:1" name="Home / Desktop" width="1440" height="900"><component id="1:2" name="Card"/></frame>'
  assert.deepEqual(parseMetadataNodes(xml).map(n => n.type), ['FRAME', 'COMPONENT'])
})

test('auditFigma: pairing, sizes, mirror check, census', () => {
  const res = auditFigma({
    frames: [{ id: '1:1', name: 'Home / Desktop', width: 1440, height: 900 }, { id: '9:9', name: 'Scratch', width: 100, height: 100 }],
    metadataRaw: '<component id="1:2" name="Card"/>',
    variablesRaw: JSON.stringify({ 'color/primary': '#123456', 'color/rogue': '#000000' }),
    codeConnectRaw: '{}',
    answers: answers(),
    repoFacts: { tokenNames: ['--color-primary'] },
  })
  assert.equal(res.items['1.1'].status, 'pass')
  assert.equal(res.items['1.2'].status, 'pass', 'every declared screen paired; Scratch is just unmatched')
  assert.equal(res.items['1.3'].status, 'pass')
  assert.equal(res.items['1.4'].status, 'pass')
  assert.equal(res.items['1.5'].status, 'gap', 'color/rogue mirrors no code token')
  assert.match(res.items['1.5'].evidence, /color\/rogue/)
  assert.equal(res.items['1.6'].status, 'pass')
  assert.equal(res.items['1.7'].status, 'gap', 'empty Code Connect map')
})

test('auditFigma without answered breakpoints/screens stays unknown, never guesses', () => {
  const res = auditFigma({ frames: [{ id: '1:1', name: 'Home / Desktop', width: 1440, height: 900 }] })
  assert.equal(res.items['1.2'].status, 'unknown')
  assert.equal(res.items['1.3'].status, 'unknown')
})

// ---- scorecard merge -------------------------------------------------------------------

test('scorecard: settled human decisions always win; unknown never overwrites; fresh facts beat stale ones', () => {
  const prev = { items: {
    '2.3': { status: 'done', evidence: 'hand-verified' },
    '2.7': { status: 'descoped', reason: 'no appetite' },
    '2.9': { status: 'pass', evidence: 'gate decided' },
    '2.8': { status: 'pass', evidence: 'was fresh' },
  } }
  const computed = { items: {
    '2.3': { status: 'gap', evidence: 're-audit disagrees' },
    '2.7': { status: 'gap', evidence: 'no .storybook/' },
    '2.9': { status: 'unknown', evidence: 'not computable' },
    '2.8': { status: 'gap', evidence: 'stale now' },
    '2.1': { status: 'pass', evidence: 'react' },
  } }
  const res = scorecard(prev, computed)
  assert.equal(res.items['2.3'].status, 'done', 'done is settled')
  assert.equal(res.items['2.7'].status, 'descoped', 'descoped is settled')
  assert.equal(res.items['2.9'].status, 'pass', 'unknown never overwrites')
  assert.equal(res.items['2.8'].status, 'gap', 'fresh gap beats stale pass')
  assert.deepEqual(res.gaps, ['2.8'])
  assert.equal(res.seal, itemsSeal(res.items))
  const order = Object.keys(res.items)
  assert.ok(order.indexOf('2.8') < order.indexOf('2.3'), 'rows follow the checklist loop order')
})

test('ITEM_ORDER covers every checklist id exactly once', () => {
  assert.equal(new Set(ITEM_ORDER).size, ITEM_ORDER.length)
  assert.equal(ITEM_ORDER.length, 23)
})

// ---- packet -----------------------------------------------------------------------------

const goodProfile = () => ({
  schemaVersion: 1, project: 'demo', figma: { fileKey: 'abc123' },
  stack: { framework: 'react', devCommand: 'npm run dev', devUrl: 'http://localhost:5173', readyTimeoutSec: 60 },
  mode: 'desktop-only', breakpoints: [{ name: 'desktop', width: 1440, height: 900 }],
  screens: [{ name: 'Home', route: '/', frames: { desktop: '1:1' } }],
  tolerance: { geometryPx: 1 }, fences: { allow: ['src/**'], forbid: [] }, intentionalDeviations: [],
})
const goodPrep = () => ({ items: { '1.2': { status: 'done' }, '1.6': { status: 'gap' } }, answers: { dpr: 2 } })
const goodFrames = () => [{ id: '1:1', name: 'Home / Desktop', width: 1440, height: 900 }]

test('buildPacket: non-critical gaps ride along as openGaps; critical gaps block', () => {
  const ok = buildPacket({ profile: goodProfile(), allowlist: [], prep: goodPrep(), frames: goodFrames() })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.packet.openGaps, ['1.6'])
  assert.ok(!PROFILE_CRITICAL.includes('1.6'))

  const blocked = buildPacket({
    profile: goodProfile(), allowlist: [],
    prep: { items: { '2.5': { status: 'gap' } } }, frames: goodFrames(),
  })
  assert.equal(blocked.ok, false)
  assert.match(blocked.errors.join(' '), /2\.5/)
})

test('buildPacket blocks on an invalid profile or an unpaired screen', () => {
  const bad = buildPacket({ profile: { schemaVersion: 2 }, allowlist: [], prep: goodPrep() })
  assert.equal(bad.ok, false)
  const unpaired = buildPacket({ profile: goodProfile(), allowlist: [], prep: goodPrep(), frames: [{ id: '9:9', name: 'Other / Desktop', width: 1440, height: 900 }] })
  assert.equal(unpaired.ok, false)
  assert.match(unpaired.errors.join(' '), /Home/)
})

test('verifyPacket round-trip: green on unchanged files, red on any drift', () => {
  const inputs = { profile: goodProfile(), allowlist: [], prep: goodPrep(), frames: goodFrames() }
  const { packet } = buildPacket(inputs)
  assert.deepEqual(verifyPacket({ packet, ...inputs }), { ok: true, reasons: [] })

  const flipped = { ...inputs, prep: { ...goodPrep(), items: { ...goodPrep().items, '1.2': { status: 'gap' } } } }
  const r1 = verifyPacket({ packet, ...flipped })
  assert.equal(r1.ok, false)
  assert.match(r1.reasons.join(' '), /seal mismatch/)

  const editedProfile = { ...inputs, profile: { ...goodProfile(), tolerance: { geometryPx: 5 } } }
  assert.equal(verifyPacket({ packet, ...editedProfile }).ok, false)

  assert.match(verifyPacket({ packet: undefined }).reasons[0], /run \/crg-ui-prep/)
})

test('packetSealLines feed the shared sealOf — same discipline as the ledger', () => {
  const lines = packetSealLines({ profile: { a: 1 }, allowlist: [], items: { '1.2': { status: 'done' } }, pairing: { paired: [1], unmatched: [] } })
  assert.equal(sealOf(lines), sealOf([...lines].reverse()), 'order-independent, like every seal')
})

// ---- verify dispatch ----------------------------------------------------------------------

test('verifyItem: repo items re-audit; 2.5 byte-compares captures; unsupported items say so', () => {
  const ctx = { files: repoFiles(), extras: repoExtras() }
  assert.equal(verifyItem('2.5', ctx).green, true)
  assert.equal(verifyItem('2.3', ctx).green, false, 'Card.tsx untagged')
  assert.equal(verifyItem('2.5', { ...ctx, captures: ['AAA', 'AAA'] }).green, true)
  assert.equal(verifyItem('2.5', { ...ctx, captures: ['AAA', 'BBB'] }).green, false)
  const fig = verifyItem('1.2', { frames: goodFrames(), profile: goodProfile() })
  assert.equal(fig.green, true)
  assert.equal(verifyItem('1.9', ctx).unsupported, true)
})
