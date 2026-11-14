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

// crg-debug refuses a ledger that does not hold what its own counts say, so a slice has to
// say how many confirmed rows it kept; the other buckets are untouched and so are their counts.
test('a sliced ledger says how many confirmed rows it kept', () => {
  const counted = { ...LEDGER, counts: { confirmedBugs: 3, deferred: 1, rejected: 0, unreviewed: 0 }, unreviewed: [] }
  const out = sliceLedger(counted, [bug('b.py:3', 'inverted guard')])
  assert.deepEqual(out.counts, { confirmedBugs: 1, deferred: 1, rejected: 0, unreviewed: 0 })
  assert.deepEqual(counted.counts.confirmedBugs, 3, 'the ledger it was given is not changed')
  assert.deepEqual(Object.keys(out), Object.keys(counted), 'no field is added, dropped or moved')
  assert.deepEqual(sliceLedger(counted, []).counts.confirmedBugs, 0)
})

test('a ledger with no counts gets none from a slice', () => {
  assert.equal('counts' in sliceLedger(LEDGER, [bug('b.py:3', 'inverted guard')]), false)
})

// A slice is the bugs somebody chose to fix. A fix run from a ledger reviews its unreviewed
// rows and fixes what it confirms, so the slice carries none.
test('a sliced ledger carries no unreviewed rows; the ledger it was cut from keeps them', () => {
  const held = [{ file: 'u.py:1', rootCause: 'nobody read this', unreviewedReason: 'agent limit' }]
  const whole = { ...LEDGER, counts: { confirmedBugs: 3, deferred: 1, rejected: 0, unreviewed: 1 }, unreviewed: held }
  const out = sliceLedger(whole, whole.confirmedBugs)
  assert.deepEqual(out.unreviewed, [])
  assert.equal(out.counts.unreviewed, 0)
  assert.deepEqual(out.confirmedBugs, whole.confirmedBugs, 'keeping every confirmed bug is still a slice')
  assert.deepEqual(whole.unreviewed, held)
  assert.equal(whole.counts.unreviewed, 1)
  assert.deepEqual(Object.keys(out), Object.keys(whole))
  // No counts: the rows go all the same. No bucket: none is added.
  assert.deepEqual(sliceLedger({ ...LEDGER, unreviewed: held }, []).unreviewed, [])
  assert.equal('unreviewed' in sliceLedger(LEDGER, []), false)
})

test('a slice does not carry the places of rows another run could not read', () => {
  const saved = { ...LEDGER, unread: [{ bucket: 'confirmedBugs', index: 2 }] }
  const out = sliceLedger(saved, [bug('b.py:3', 'inverted guard')])
  assert.equal('unread' in out, false, 'place 2 of the slice is another row, or none')
  assert.deepEqual(saved.unread, [{ bucket: 'confirmedBugs', index: 2 }])
  assert.deepEqual(Object.keys(out), Object.keys(LEDGER))
})

