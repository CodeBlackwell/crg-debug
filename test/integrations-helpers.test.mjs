import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validateProfile } from '../lib/integrations-profile.mjs'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-integrations.js (evaled whole by the workflow runtime, not
// importable) and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-integrations.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const classifyDrift'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, capText, resolveModel, clampInt, normPath, normalizeSignature, signaturesDiffer, clusterCells, escapeRegex, shellQuote, buildGrep, buildCommand, parseRanTestCount, verifyVerdict, prefilterClass, bindHost, globToRegex, matchesAnyGlob, validateEdits, pixelDriftStats, classifyDrift }`,
)()

// ---- normalizeSignature / signaturesDiffer ------------------------------------

test('normalizeSignature strips paths, host:port, line:col, durations, hex, ANSI', () => {
  const a = 'Error at /Users/x/repo/tests/foo.spec.ts:12:5 (localhost:5173) took 1.3s hash a1b2c3d4e5'
  const b = 'Error at /home/ci/other/tests/foo.spec.ts:88:1 (localhost:5199) took 42ms hash ffee0011'
  assert.equal(H.normalizeSignature(a), H.normalizeSignature(b), 'same failure, volatile parts differ -> same signature')
  assert.ok(!H.normalizeSignature(a).includes('5173'))
  assert.ok(!H.normalizeSignature(a).includes('foo.spec.ts'))
})

test('normalizeSignature strips ANSI color codes', () => {
  assert.equal(H.normalizeSignature('\x1B[31mexpected element to be attached\x1B[0m'), 'expected element to be attached')
})

test('normalizeSignature keeps genuinely different failures distinct', () => {
  assert.notEqual(
    H.normalizeSignature('expect(locator).toBeAttached() failed'),
    H.normalizeSignature('expect(locator).toHaveText() failed'),
  )
})

test('signaturesDiffer compares normalized forms', () => {
  assert.equal(H.signaturesDiffer('fail at /a/b.ts:1', 'fail at /c/d.ts:9'), false)
  assert.equal(H.signaturesDiffer('toBeAttached failed', 'toHaveScreenshot failed'), true)
})

// ---- clusterCells -------------------------------------------------------------

const cell = (over = {}) => ({ host: 'plain-html', test: 't', testName: 'mounts', status: 'fail', error: 'toBeAttached failed', ...over })

test('clusterCells groups by (normalized signature, test name), assigns ids', () => {
  const clusters = H.clusterCells([
    cell({ host: 'docusaurus', error: 'toBeAttached at /x/a.ts:1' }),
    cell({ host: 'hugo', error: 'toBeAttached at /y/b.ts:9' }), // same sig after normalization
    cell({ host: 'astro', testName: 'hover', error: 'toHaveText failed' }), // different test + sig
  ])
  assert.equal(clusters.length, 2)
  assert.deepEqual(clusters.map(c => c.clusterId), ['cl-001', 'cl-002'])
  assert.equal(clusters[0].cells.length, 2)
})

test('clusterCells never splits one signature across clusters', () => {
  const clusters = H.clusterCells(Array.from({ length: 5 }, (_, i) => cell({ host: `h${i}`, error: `toBeAttached at /p${i}/f.ts:${i}` })))
  assert.equal(clusters.length, 1)
  assert.equal(clusters[0].cells.length, 5)
})

// ---- grep building / injection defense ----------------------------------------

test('escapeRegex escapes metacharacters', () => {
  assert.equal(H.escapeRegex('a.b*c(d)'), 'a\\.b\\*c\\(d\\)')
})

test('shellQuote wraps and escapes single quotes', () => {
  assert.equal(H.shellQuote("it's a test"), `'it'\\''s a test'`)
})

test('buildGrep regex-escapes filled values, leaves unknown placeholders', () => {
  assert.equal(H.buildGrep('{scenario}.*{test}', { scenario: '00-baseline', test: 'mount (short)' }), '00-baseline.*mount \\(short\\)')
  assert.equal(H.buildGrep('{scenario}.*{test}', { scenario: 'x' }), 'x.*{test}')
})

test('buildGrep + shellQuote neutralize an injection attempt in a test name', () => {
  const evil = "foo'; rm -rf / #"
  const grep = H.shellQuote(H.buildGrep('{scenario}.*{test}', { scenario: '', test: evil }))
  assert.ok(grep.startsWith("'") && grep.endsWith("'"))
  assert.ok(!/;[^']/.test(grep.slice(1, -1)) || grep.includes(`'\\''`), 'embedded quote is escaped, not breaking out')
})

test('buildCommand fills plain values and preserves unknown placeholders', () => {
  assert.equal(H.buildCommand('test --project={host} --grep {grep}', { host: 'astro', grep: "'x.*y'" }), "test --project=astro --grep 'x.*y'")
  assert.equal(H.buildCommand('run --workers={workers}', { workers: 3 }), 'run --workers=3')
})

// ---- verify judge -------------------------------------------------------------

test('parseRanTestCount sums passed + failed + flaky', () => {
  assert.equal(H.parseRanTestCount('  1 passed (2.3s)'), 1)
  assert.equal(H.parseRanTestCount('2 failed\n1 passed'), 3)
  assert.equal(H.parseRanTestCount('1 flaky, 3 passed'), 4)
  assert.equal(H.parseRanTestCount('No tests found'), 0)
  assert.equal(H.parseRanTestCount(''), 0)
})

test('verifyVerdict passes only on exit 0 AND a test that actually ran', () => {
  assert.equal(H.verifyVerdict({ exitCode: 0, stdout: '1 passed (1s)' }), true)
  assert.equal(H.verifyVerdict({ exitCode: 0, stdout: 'No tests found' }), false, '0 tests ran is never a pass')
  assert.equal(H.verifyVerdict({ exitCode: 1, stdout: '1 failed' }), false)
  assert.equal(H.verifyVerdict({}), false)
})

// ---- classify prefilter -------------------------------------------------------

test('prefilterClass overrides under-dev hosts and expected-degradation tests', () => {
  assert.equal(H.prefilterClass({ host: 'redocly-shape' }, { underDev: ['redocly-shape'] }), 'under-dev')
  assert.equal(H.prefilterClass({ host: 'mintlify', testName: 'rail-collides' }, { expectedDegradations: { mintlify: ['rail-collides'] } }), 'under-dev')
  assert.equal(H.prefilterClass({ host: 'astro', testName: 'mounts', error: 'toHaveScreenshot diff' }, { fingerprintMismatch: true }), 'drift-candidate')
  assert.equal(H.prefilterClass({ host: 'astro', testName: 'mounts', error: 'toBeAttached' }, {}), null, 'send to the classifier')
})

// ---- glob / fence matching ----------------------------------------------------

test('globToRegex: ** spans segments, * stays within one', () => {
  assert.ok(H.globToRegex('a/**').test('a/b/c.ts'))
  assert.ok(H.globToRegex('a/*.ts').test('a/b.ts'))
  assert.ok(!H.globToRegex('a/*.ts').test('a/b/c.ts'))
})

test('validateEdits: inside allow (host-bound), not forbid, not shared', () => {
  const fences = {
    allow: ['tests/integration-hosts/{host}/**'],
    forbid: ['frontend/src/**', 'backend/**'],
    sharedNeedsGate: ['tests/integration-hosts/_shared/**'],
  }
  assert.equal(H.validateEdits(['tests/integration-hosts/docusaurus/host.config.mts'], 'docusaurus', fences).ok, true)
  assert.equal(H.validateEdits([], 'docusaurus', fences).ok, false, 'empty edit set is not ok')
  const forbid = H.validateEdits(['frontend/src/widget/modes/rail.ts'], 'docusaurus', fences)
  assert.equal(forbid.ok, false); assert.equal(forbid.hitsForbid, true)
  const shared = H.validateEdits(['tests/integration-hosts/_shared/ports.ts'], 'docusaurus', fences)
  assert.equal(shared.ok, false); assert.equal(shared.hitsShared, true)
  // wrong host: docusaurus edit approved under host=astro is out of the allow fence
  assert.equal(H.validateEdits(['tests/integration-hosts/docusaurus/x.ts'], 'astro', fences).withinAllow, false)
})

// ---- pixel drift math ---------------------------------------------------------

test('pixelDriftStats computes diffPct and spread-out uniformity', () => {
  const s = H.pixelDriftStats({ changedPixels: 1000, totalPixels: 100000, largestComponent: 50 })
  assert.equal(s.diffPct, 1)
  assert.equal(s.uniformity, 0.95) // 1 - 50/1000
})

test('classifyDrift is a veto only: never declares drift, only rules it out', () => {
  // Bar values from the 2026-07-06 calibration: 71 real drift pairs spanned
  // diffPct 0.8-8.6 / uniformity 0.73-0.96; injected global shifts hit 11-18%.
  const bar = { maxDiffPct: 10, uniformityMin: 0.7 }
  // large change (a global shift measured 11-18%) -> vetoed to regression
  assert.equal(H.classifyDrift({ diffPct: 12, uniformity: 0.99 }, bar), 'regression')
  // concentrated blob (a solid element broke) -> vetoed to regression
  assert.equal(H.classifyDrift({ diffPct: 2, uniformity: 0.4 }, bar), 'regression')
  // everything plausible — including real drift — is unconfirmed: vision decides
  assert.equal(H.classifyDrift({ diffPct: 1, uniformity: 0.95 }, bar), 'unconfirmed')
  assert.equal(H.classifyDrift({ diffPct: 8.6, uniformity: 0.73 }, bar), 'unconfirmed')  // worst real drift observed
  assert.equal(H.classifyDrift({ diffPct: 0.1, uniformity: 0.99 }, bar), 'unconfirmed')
  // a small-element shift (1.07% diffuse — numerically identical to drift) must
  // NOT be vetoed either way; it reaches vision, which sees the moved element
  assert.equal(H.classifyDrift({ diffPct: 1.07, uniformity: 0.98 }, bar), 'unconfirmed')
})

// ---- profile validator (lib) --------------------------------------------------

const goodProfile = () => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/integrations-profile.good.json', import.meta.url)), 'utf8'))

test('validateProfile accepts the dogfood fixture', () => {
  assert.deepEqual(validateProfile(goodProfile()), { ok: true, errors: [] })
})

test('validateProfile rejects a wrong schemaVersion', () => {
  const p = goodProfile(); p.schemaVersion = 2
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false); assert.ok(errors.some(e => e.includes('schemaVersion')))
})

test('validateProfile enforces placeholder presence per command', () => {
  const p = goodProfile(); p.commands.singleCell = 'npx playwright test --project=x'
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false)
  assert.ok(errors.some(e => e.includes('singleCell') && e.includes('{host}')))
  assert.ok(errors.some(e => e.includes('singleCell') && e.includes('{grep}')))
})

test('validateProfile requires {scenario} and {test} in grepTemplate', () => {
  const p = goodProfile(); p.grepTemplate = '{test}'
  assert.equal(validateProfile(p).ok, false)
})

test('validateProfile requires non-empty fences.allow', () => {
  const p = goodProfile(); p.fences.allow = []
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false); assert.ok(errors.some(e => e.includes('fences.allow')))
})

test('validateProfile requires convert when matrixAdapter.kind is command', () => {
  const p = goodProfile(); p.matrixAdapter = { kind: 'command' }
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false); assert.ok(errors.some(e => e.includes('matrixAdapter.convert')))
})

test('validateProfile requires the two veto knobs', () => {
  const p = goodProfile(); p.drift.pixelAsymmetryBar = { maxDiffPct: 10 } // uniformityMin missing
  assert.equal(validateProfile(p).ok, false)
})
