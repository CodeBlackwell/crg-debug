import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects: a gap whose surface uses the documented 'repo:<name>' form is judged against
// ITS OWN frontend's console-error allowlist — not silently against frontends[0]'s, which
// fails the browser gate and requeues a correctly built gap.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-build.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { surfaceName, frontendFor }`)()

const FRONTENDS = [
  { name: 'dashboard', url: 'http://d', consoleErrorAllow: ['ResizeObserver'] },
  { name: 'portal', url: 'http://p', consoleErrorAllow: ['Failed to load resource: 401'] },
]

test('surfaceName decodes GAP_ROW.surface once — repo:<name> and bare names alike', () => {
  assert.equal(H.surfaceName('repo:portal'), 'portal')
  assert.equal(H.surfaceName('portal'), 'portal')
  assert.equal(H.surfaceName('repo:methodproof-platform'), 'methodproof-platform')
  assert.equal(H.surfaceName(''), '')
  assert.equal(H.surfaceName(undefined), '')
})

test("frontendFor resolves surface='repo:portal' to portal, not the first frontend", () => {
  assert.deepEqual(H.frontendFor('repo:portal', FRONTENDS).consoleErrorAllow, ['Failed to load resource: 401'])
  assert.deepEqual(H.frontendFor('portal', FRONTENDS).consoleErrorAllow, ['Failed to load resource: 401'])
  assert.deepEqual(H.frontendFor('dashboard', FRONTENDS).consoleErrorAllow, ['ResizeObserver'])
})

test('frontendFor falls back to the first frontend only for an unknown surface, and never throws', () => {
  assert.equal(H.frontendFor('repo:cli', FRONTENDS).name, 'dashboard')
  assert.deepEqual(H.frontendFor('repo:portal', []), {})
  assert.deepEqual(H.frontendFor('repo:portal', undefined), {})
})

test('both surface lookups in the build phase go through the ONE decoder', () => {
  // The bug was two decoders for one field: the browser-gate selector stripped 'repo:',
  // the console-allowlist lookup did not. Neither may hand-roll the match again.
  const hand = [...src.matchAll(/frontends\s*\.?\s*find\(/g)]
  assert.equal(hand.length, 0, 'a hand-rolled frontends.find() re-introduces a second decoder')
  assert.ok([...src.matchAll(/frontendFor\(g\.surface, frontends\)/g)].length >= 2, 'both call sites must use frontendFor')
})
