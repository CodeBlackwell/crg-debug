import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects: a docs-only wave — files no toolchain package covers — commits instead of
// halting the whole campaign. Zero gate rows means "nothing to run" there, not "the gate
// failed"; only silence about files a package DOES cover stays red.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-build.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { waveGateClean }`)()

const TOOLCHAIN = [{ package: 'apps/web', typecheck: 'tsc' }, { package: 'services/api', test: 'pytest' }]

test('a wave touching nothing under any package is clean on zero gate rows', () => {
  assert.equal(H.waveGateClean([], ['README.md', 'docs/setup.md'], TOOLCHAIN), true)
  assert.equal(H.waveGateClean(undefined, ['README.md'], TOOLCHAIN), true)
})

test('zero gate rows stays RED when a touched file IS under a gate package', () => {
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], TOOLCHAIN), false)
  assert.equal(H.waveGateClean([], ['docs/setup.md', 'services/api/main.py'], TOOLCHAIN), false)
})

test('with rows present, every real exit code still decides the verdict', () => {
  const touched = ['apps/web/src/Page.tsx']
  assert.equal(H.waveGateClean([{ command: 'tsc', exitCode: 0 }], touched, TOOLCHAIN), true)
  assert.equal(H.waveGateClean([{ command: 'tsc', exitCode: 0 }, { command: 'x', exitCode: 1 }], touched, TOOLCHAIN), false)
  // A green row set on an unscoped wave is still green — the scoped check only reads silence.
  assert.equal(H.waveGateClean([{ command: 'ls', exitCode: 0 }], ['README.md'], TOOLCHAIN), true)
})

// "Nothing to run" is only an answer when there is a toolchain to be outside of. With an
// empty one the gate is vacuous for the WHOLE campaign, and reading that as clean commits
// every wave unverified — the loudest possible failure, reported as the quietest.
test('an empty toolchain cannot gate anything, so silence is NOT clean', () => {
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], []), false)
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], undefined), false)
  assert.equal(H.waveGateClean([], ['README.md'], []), false, 'even a docs-only wave has no gate to have passed')
})

// underFence(f, ['.']) is false — normPath('.') is '.', which prefix-matches nothing — so
// the single-package repo, the common case, took the vacuous path for every file.
test("a package of '.' covers every touched file", () => {
  const root = [{ package: '.', test: 'npm test' }]
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], root), false)
  assert.equal(H.waveGateClean([], ['README.md'], root), false)
  assert.equal(H.waveGateClean([{ command: 'npm test', exitCode: 0 }], ['README.md'], root), true)
})

test('the wave gate calls the helper only when the gate agent actually reported', () => {
  assert.match(src, /waveClean = !!wg && waveGateClean\(wg\.results, \[\.\.\.waveTouched\], toolchain\)/)
  assert.equal(src.includes('waveClean = !!(wg && (wg.results || []).length &&'), false, 'the collapsed verdict must be gone')
  assert.equal(src.includes('waveGateClean(wg && wg.results'), false,
    'a dead gate agent must not reach the helper — null rows are indistinguishable from a scope-less gate there')
})

test('the ledger schema requires the toolchain the gate is built on', () => {
  const at = src.indexOf('const BUILD_LEDGER_SCHEMA')
  const schema = src.slice(at, src.indexOf('\n}', at))
  assert.match(schema, /required: \['gaps', 'toolchain'\]/,
    'an optional toolchain let an ingest agent make every wave gate in the run vacuous')
})

test('the wave-gate brief tells the agent zero rows is the honest no-package answer', () => {
  const at = src.indexOf('const waveGateAgent = ')
  const brief = src.slice(at, src.indexOf('\n  )', at))
  assert.match(brief, /no package/i, 'the gate agent must be told what to do when no package covers the touched files')
})
