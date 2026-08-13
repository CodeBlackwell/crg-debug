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

test('an empty toolchain means no package covers anything, so silence is clean', () => {
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], []), true)
  assert.equal(H.waveGateClean([], ['apps/web/src/Page.tsx'], undefined), true)
})

test('the wave gate calls the helper with the touched set and the toolchain', () => {
  assert.match(src, /waveClean = waveGateClean\(wg && wg\.results, \[\.\.\.waveTouched\], toolchain\)/)
  assert.equal(src.includes('waveClean = !!(wg && (wg.results || []).length &&'), false, 'the collapsed verdict must be gone')
})

test('the wave-gate brief tells the agent zero rows is the honest no-package answer', () => {
  const at = src.indexOf('const waveGateAgent = ')
  const brief = src.slice(at, src.indexOf('\n  )', at))
  assert.match(brief, /no package/i, 'the gate agent must be told what to do when no package covers the touched files')
})
