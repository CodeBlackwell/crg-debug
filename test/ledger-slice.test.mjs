import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bugKeyOf, sliceLedger } from '../lib/crg-debug.ledger-slice.mjs'

const bug = (file, rootCause, extra = {}) => ({ file, rootCause, severity: 'High', ...extra })
const LEDGER = {
  confirmedBugs: [
    bug('a.py:10', 'off-by-one in loop'),
    bug('b.py:3', 'inverted guard'),
    bug('c.py', 'wrong operator'),
  ],
  deferred: [{ file: 'd.py', rootCause: 'intentional stub' }],
  rejected: [],
  toolchain: [{ package: 'root', test: 'pytest' }],
  baselineFailures: [{ file: 'x.py', rootCause: 'typecheck' }],
}

test('bugKeyOf matches the workflow: normalized file::rootCause', () => {
  assert.equal(bugKeyOf({ file: 'A.py:10', rootCause: 'Off-By-One  in   Loop' }), 'a.py:10::off-by-one in loop')
})

test('slice by bug objects keeps only the matching confirmedBugs', () => {
  const out = sliceLedger(LEDGER, [bug('b.py:3', 'inverted guard')])
  assert.equal(out.confirmedBugs.length, 1)
  assert.equal(out.confirmedBugs[0].file, 'b.py:3')
})

test('slice by bugKeyOf strings works the same', () => {
  const out = sliceLedger(LEDGER, [bugKeyOf(bug('a.py:10', 'off-by-one in loop'))])
  assert.deepEqual(out.confirmedBugs.map(b => b.file), ['a.py:10'])
})

test('slice matches a returned unfixed bug (spread carries file+rootCause)', () => {
  const unfixed = { ...bug('c.py', 'wrong operator'), reason: 'RED not observed', wave: 1 }
  const out = sliceLedger(LEDGER, [unfixed])
  assert.deepEqual(out.confirmedBugs.map(b => b.file), ['c.py'])
})

test('preserves toolchain and other metadata, only narrows confirmedBugs', () => {
  const out = sliceLedger(LEDGER, [])
  assert.deepEqual(out.confirmedBugs, [])
  assert.deepEqual(out.toolchain, LEDGER.toolchain)
  assert.deepEqual(out.deferred, LEDGER.deferred)
})

test('accepts a Set of keys', () => {
  const keys = new Set([bugKeyOf(LEDGER.confirmedBugs[0]), bugKeyOf(LEDGER.confirmedBugs[2])])
  const out = sliceLedger(LEDGER, keys)
  assert.deepEqual(out.confirmedBugs.map(b => b.file), ['a.py:10', 'c.py'])
})

test('empty/absent confirmedBugs → empty result, no throw', () => {
  assert.deepEqual(sliceLedger({}, ['whatever::key']).confirmedBugs, [])
})
