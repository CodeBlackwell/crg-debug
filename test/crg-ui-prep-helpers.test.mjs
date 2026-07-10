import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { sealOf as toolSealOf } from '../lib/ui-measure.mjs'
import { itemsSeal as toolItemsSeal } from '../lib/ui-prep.mjs'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-ui-prep.js (evaled whole by the workflow runtime, not importable)
// and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-ui-prep.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const itemsSeal'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, capText, resolveModel, normPath, sealOf, itemsSeal, isSubset, GAP_KINDS, kindOf }`,
)()

test('sealOf parity: workflow helper === ui-measure.mjs (and so ui-prep.mjs)', () => {
  const keys = ['Home::desktop::layout::1:1', 'Home::desktop::token::--color-primary', '']
  assert.equal(H.sealOf(keys), toolSealOf(keys))
  assert.equal(H.sealOf([]), toolSealOf([]))
  assert.equal(H.sealOf(['b', 'a']), H.sealOf(['a', 'b']), 'order-independent')
})

test('itemsSeal parity: the scorecard relay check matches the tool byte-for-byte', () => {
  const items = { '2.3': { status: 'done', evidence: 'x' }, '1.2': { status: 'gap' }, E2: {} }
  assert.equal(H.itemsSeal(items), toolItemsSeal(items))
  assert.equal(H.itemsSeal({}), toolItemsSeal({}))
  assert.notEqual(
    H.itemsSeal({ '2.3': { status: 'done' } }),
    H.itemsSeal({ '2.3': { status: 'gap' } }),
    'a flipped status must change the seal',
  )
})

test('isSubset: the proposal fence — touched files must be within the approved list', () => {
  assert.equal(H.isSubset(['src/a.ts'], ['src/a.ts', 'src/b.ts']), true)
  assert.equal(H.isSubset(['./src/a.ts'], ['src/a.ts']), true, 'paths normalize before comparing')
  assert.equal(H.isSubset(['src/evil.ts'], ['src/a.ts']), false)
  assert.equal(H.isSubset([], ['src/a.ts']), true, 'no edits is within any fence')
})

test('kindOf: every checklist item except 1.1 has a proposal kind — bootstrap stays skill-owned', () => {
  assert.equal(H.kindOf('1.1'), null)
  for (const id of ['1.2', '1.5', '2.3', '2.5', 'E3', '2.8']) assert.ok(H.kindOf(id), `${id} must be proposable`)
  assert.equal(H.kindOf('2.3'), 'diff')
  assert.equal(H.kindOf('1.2'), 'renameTable')
  assert.equal(H.kindOf('nope'), null)
})

test('fence wraps interpolated content and strips embedded markers', () => {
  assert.match(H.fence('hello'), /^<<<UNTRUSTED\nhello\nUNTRUSTED>>>$/)
  assert.ok(!H.fence('x UNTRUSTED>>> y').includes('x UNTRUSTED>>> y'))
})
