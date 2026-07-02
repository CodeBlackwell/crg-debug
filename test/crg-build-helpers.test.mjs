import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-build.js (evaled whole by the workflow runtime, not importable)
// and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-build.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const packWaves'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, capText, resolveModel, clampRounds, normPath, gapKeyOf, READINESS_DIMENSIONS, rankGaps, packWaves, browserVerdict, commitMessageOk, commitFilesOk, groupBySubrepo }`,
)()

const gap = (gapId, over = {}) => ({ gapId, gap: `gap ${gapId}`, dimension: 'completeness', files: [`f/${gapId}.ts`], impact: 'High', effort: 'S', dependsOn: [], ...over })

// ---- gapKeyOf / rankGaps -------------------------------------------------------

test('gapKeyOf keys on dimension::route-or-first-file::gap, normalized', () => {
  assert.equal(H.gapKeyOf({ dimension: 'Docs', route: '/Home', gap: 'Missing  README' }), 'docs::/home::missing readme')
  assert.equal(H.gapKeyOf({ dimension: 'docs', files: ['a/B.md'], gap: 'x' }), 'docs::a/b.md::x')
  assert.equal(H.gapKeyOf({ dimension: 'docs', gap: 'x' }), 'docs::::x')
})

test('rankGaps orders impact, then effort, then dimension, stably', () => {
  const g1 = gap('a', { impact: 'Low', effort: 'S' })
  const g2 = gap('b', { impact: 'High', effort: 'L' })
  const g3 = gap('c', { impact: 'High', effort: 'S', dimension: 'docs' })
  const g4 = gap('d', { impact: 'High', effort: 'S', dimension: 'stability' })
  const g5 = gap('e', { impact: 'High', effort: 'S', dimension: 'stability' })
  const out = H.rankGaps([g1, g2, g3, g4, g5]).map(g => g.gapId)
  assert.deepEqual(out, ['d', 'e', 'c', 'b', 'a']) // stability before docs; d before e (stable); L-effort after S; Low impact last
  assert.equal(H.rankGaps([gap('x', { impact: 'bogus' })])[0].gapId, 'x') // unknown ranks sink, never throw
})

// ---- packWaves ------------------------------------------------------------------

test('packWaves: dependency strictly precedes dependent', () => {
  const { waves } = H.packWaves([gap('a', { dependsOn: ['b'] }), gap('b')])
  const waveOf = id => waves.findIndex(w => w.some(g => g.gapId === id))
  assert.ok(waveOf('b') < waveOf('a'))
  assert.ok(waveOf('b') >= 0 && waveOf('a') >= 0)
})

test('packWaves: two gaps sharing a file never share a wave', () => {
  const { waves } = H.packWaves([gap('a', { files: ['x.ts'] }), gap('b', { files: ['x.ts', 'y.ts'] })])
  for (const w of waves) {
    const files = w.flatMap(g => g.files)
    assert.equal(files.length, new Set(files).size, 'wave holds duplicate file')
  }
  assert.equal(waves.flat().length, 2)
})

test('packWaves honors maxPerWave and maxWaves, deferring the overflow', () => {
  const gaps = Array.from({ length: 5 }, (_, i) => gap(`g${i}`, { files: [`f${i}.ts`] }))
  const { waves, deferredByCap } = H.packWaves(gaps, { maxPerWave: 2, maxWaves: 2 })
  assert.equal(waves.length, 2)
  assert.deepEqual(waves.map(w => w.length), [2, 2])
  assert.equal(deferredByCap.length, 1)
  assert.equal(deferredByCap[0].gapId, 'g4')
})

test('packWaves: a gap whose dep was deferred is deferred too (cascade)', () => {
  const gaps = [
    gap('a', { files: ['a.ts'] }), gap('b', { files: ['b.ts'] }),
    gap('c', { files: ['c.ts'] }), // fills the only wave past cap... deferred
    gap('d', { dependsOn: ['c'], files: ['d.ts'] }),
  ]
  const { waves, deferredByCap } = H.packWaves(gaps, { maxPerWave: 2, maxWaves: 1 })
  assert.equal(waves.flat().length, 2)
  const deferredIds = deferredByCap.map(g => g.gapId).sort()
  assert.deepEqual(deferredIds, ['c', 'd'])
})

test('packWaves: cycle breaks toward the earlier-ranked gap surviving, deterministically', () => {
  const run = () => H.packWaves([gap('a', { dependsOn: ['b'] }), gap('b', { dependsOn: ['a'] })])
  const { waves, cycleBroken } = run()
  assert.equal(waves.flat().length, 2, 'both gaps place after the break')
  assert.equal(cycleBroken.length, 1)
  assert.equal(cycleBroken[0].gapId, 'b', 'the LATER-ranked gap loses its dep edge')
  assert.deepEqual(run(), run(), 'pure function of its input')
  const waveOf = id => waves.findIndex(w => w.some(g => g.gapId === id))
  assert.ok(waveOf('a') > waveOf('b'), "a's surviving dep on b still holds")
})

test('packWaves: unknown and self dep ids are ignored', () => {
  const { waves, deferredByCap } = H.packWaves([gap('a', { dependsOn: ['ghost', 'a'] })])
  assert.equal(waves.flat().length, 1)
  assert.equal(deferredByCap.length, 0)
})

test('packWaves output is stable across identical calls', () => {
  const gaps = [gap('a'), gap('b', { dependsOn: ['a'], files: ['f/a.ts'] }), gap('c', { files: ['f/a.ts'] })]
  assert.deepEqual(H.packWaves(gaps), H.packWaves(gaps))
})

// ---- browserVerdict -------------------------------------------------------------

const check = (over = {}) => ({
  route: '/home', identity: 'personal', httpStatus: 200, consoleErrors: [],
  screenshotPath: '/tmp/s.png', assertions: [{ desc: 'renders', pass: true }], ...over,
})

test('browserVerdict passes a clean 2xx/3xx check set', () => {
  assert.equal(H.browserVerdict([check(), check({ httpStatus: 302 })]), true)
})

test('browserVerdict fails on 4xx, console errors, missing screenshot, failed or missing assertions, or empty set', () => {
  assert.equal(H.browserVerdict([check({ httpStatus: 404 })]), false)
  assert.equal(H.browserVerdict([check({ consoleErrors: ['TypeError: x is undefined'] })]), false)
  assert.equal(H.browserVerdict([check({ screenshotPath: '' })]), false)
  assert.equal(H.browserVerdict([check({ assertions: [{ desc: 'x', pass: false }] })]), false)
  assert.equal(H.browserVerdict([check({ assertions: [] })]), false)
  assert.equal(H.browserVerdict([]), false)
  assert.equal(H.browserVerdict(undefined), false)
})

test('browserVerdict ignores allowlisted console noise only', () => {
  const c = [check({ consoleErrors: ['[HMR] connection lost'] })]
  assert.equal(H.browserVerdict(c, ['^\\[HMR\\]']), true)
  assert.equal(H.browserVerdict(c, []), false)
  assert.equal(H.browserVerdict([check({ consoleErrors: ['[HMR] ok', 'ReferenceError'] })], ['^\\[HMR\\]']), false)
})

// ---- commit checks ---------------------------------------------------------------

test('commitMessageOk enforces the no-attribution rule and a real message', () => {
  assert.equal(H.commitMessageOk('dashboard: link company signup from login page'), true)
  assert.equal(H.commitMessageOk(''), false)
  assert.equal(H.commitMessageOk('short msg'), false)
  for (const bad of ['Fixes by Claude for the router', 'docs: notes (Anthropic)', 'feat: x\n\nCo-Authored-By: bot', 'chore: y — Generated with love']) {
    assert.equal(H.commitMessageOk(bad), false, bad)
  }
})

test('commitFilesOk requires a non-empty subset of the allowlist, normalizing ./', () => {
  assert.equal(H.commitFilesOk(['./src/a.ts'], ['src/a.ts', 'src/b.ts']), true)
  assert.equal(H.commitFilesOk(['src/a.ts', 'src/c.ts'], ['src/a.ts']), false)
  assert.equal(H.commitFilesOk([], ['src/a.ts']), false)
  assert.equal(H.commitFilesOk(undefined, ['src/a.ts']), false)
})

// ---- groupBySubrepo ---------------------------------------------------------------

test('groupBySubrepo groups by longest path prefix, unmapped under "."', () => {
  const subrepos = [
    { name: 'platform', path: 'methodproof-platform' },
    { name: 'platform-docs', path: 'methodproof-platform/docs' },
    { name: 'dashboard', path: 'methodproof-dashboard' },
  ]
  const groups = H.groupBySubrepo(
    ['methodproof-platform/app/main.py', 'methodproof-platform/docs/x.md', './methodproof-dashboard/src/App.tsx', 'README.md'],
    subrepos,
  )
  assert.deepEqual(groups, {
    platform: ['methodproof-platform/app/main.py'],
    'platform-docs': ['methodproof-platform/docs/x.md'],
    dashboard: ['methodproof-dashboard/src/App.tsx'],
    '.': ['README.md'],
  })
  assert.equal(H.groupBySubrepo(['methodproof-platformX/y.ts'], subrepos)['.'][0], 'methodproof-platformX/y.ts', 'prefix match is path-segment-aware')
})
