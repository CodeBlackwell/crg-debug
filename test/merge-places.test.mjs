// Protects a bug that sits in several places from being fixed in one: when the merge folds
// several findings into one row, that row keeps the place and cause of each one it replaced,
// through the saved ledger and into the fixer's brief, and no reviewer is shown them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(
  `${block}\nreturn { mergeDuplicateGroups, alsoAtLines, alsoAtNote, ALSO_AT_NOTE, ALSO_AT_CAP, ALSO_AT_TEXT_CAP, reviewerBrief, fence, ledgerWrite, ledgerParts, ledgerPartPath, ledgerWriteCommand, ledgerReadCommand }`,
)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug, ledgerDisk } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug, ledgerDisk }`)()

const found = (place, rootCause) => ({ file: `src/factory.py:${place}`, rootCause, symptom: 's', severity: 'High' })
const FIVE = ['a', 'b', 'c', 'd', 'e'].map(n => found(n, n.repeat(400)))

test('the merge drops the rows it dropped before and keeps the lowest index of each group', () => {
  const out = H.mergeDuplicateGroups(FIVE, [[3, 1], [1, 4], [9, 'x', 0]])
  assert.deepEqual(out.map(r => r.file), ['src/factory.py:a', 'src/factory.py:b', 'src/factory.py:c'])
  assert.equal(H.mergeDuplicateGroups(FIVE, null).length, 5, 'no groups, nothing dropped')
  assert.equal(H.mergeDuplicateGroups(FIVE, []).length, 5)
})

test('the kept row carries the place and cause of each row it replaced, once, and capped', () => {
  const out = H.mergeDuplicateGroups(FIVE, [[3, 1], [1, 4], [9, 'x', 0]])
  assert.deepEqual(out[1].alsoAt.map(p => p.file), ['src/factory.py:d', 'src/factory.py:e'])
  assert.equal(out[1].alsoAt[0].rootCause.length, H.ALSO_AT_TEXT_CAP)
  assert.deepEqual(Object.keys(out[1].alsoAt[0]), ['file', 'rootCause'], 'a place is a place and a cause, nothing more')
  assert.equal(out[0], FIVE[0], 'a row no group touches is the same object')
  assert.equal('alsoAt' in out[2], false)
  const twelve = Array.from({ length: 12 }, (_, i) => found(i, 'r'))
  assert.equal(H.mergeDuplicateGroups(twelve, [[...Array(12).keys()]])[0].alsoAt.length, H.ALSO_AT_CAP)
})

const BRANCHES = {
  ...bug('b1', 'src/factory.py'),
  alsoAt: [
    { file: 'src/factory.py:243', rootCause: 'the datetime branch ignores tzinfo too' },
    { file: 'src/api.py:12', rootCause: 'get() forwards tzinfo to the factory' },
  ],
}

test('a place in the bug\'s own file is the fixer\'s to check, and one in another file is context', () => {
  assert.equal(
    H.alsoAtLines(BRANCHES),
    '\nalsoReportedHere: src/factory.py:243 :: the datetime branch ignores tzinfo too\nalsoReportedElsewhere: src/api.py:12 :: get() forwards tzinfo to the factory',
  )
  assert.equal(H.alsoAtLines(bug('b2', 'src/bravo.py')), '')
  assert.equal(H.alsoAtNote([bug('b2', 'src/bravo.py')]), '', 'a fixer whose bugs carry no place is told nothing new')
  assert.equal(H.alsoAtNote([bug('b2', 'src/bravo.py'), BRANCHES]), `\n${H.ALSO_AT_NOTE}`)
})

test('a reviewer is shown the row as before, without its other places', () => {
  const brief = H.reviewerBrief({ ...BRANCHES, concern: 'backend-logic' }, 'STANCE', '/repo', '/skill.md', 'UNTRUSTED NOTICE')
  assert.equal(brief.includes('alsoReported'), false)
  assert.equal(brief.includes('the datetime branch'), false)
  assert.equal(brief, H.reviewerBrief({ ...bug('b1', 'src/factory.py'), concern: 'backend-logic' }, 'STANCE', '/repo', '/skill.md', 'UNTRUSTED NOTICE'))
})

test('a ledger written and read back by the script\'s own programs keeps the places', () => {
  const disk = ledgerDisk(SRC)
  const path = '/tmp/ledger.json'
  const write = H.ledgerWrite({ set: { confirmedBugs: [BRANCHES] } })
  const parts = H.ledgerParts(write)
  parts.forEach((part, i) => disk.answer(`Write to ${H.ledgerPartPath(path, i + 1)} as the ENTIRE contents:\n<<<UNTRUSTED\n${part}\nUNTRUSTED>>>`))
  const wrote = disk.answer(`<<<UNTRUSTED\n${H.ledgerWriteCommand(path, parts.length, write, false)}\nUNTRUSTED>>>`)
  assert.equal(wrote.results[0].exitCode, 0)
  const read = disk.answer(`<<<UNTRUSTED\n${H.ledgerReadCommand(path, 0)}\nUNTRUSTED>>>`)
  const line = read.results[0].stdout.split('\n').find(l => l.startsWith('crg-ledger-row confirmedBugs 0 '))
  assert.deepEqual(JSON.parse(line.split(' ').slice(4).join(' ')).alsoAt, BRANCHES.alsoAt)
})

test('a fix run from a ledger shows the fixer the places inside the bug\'s fence, with the rule for them', async () => {
  const { result, calls } = await fixRun(SRC, { bugs: [BRANCHES, bug('b2', 'src/bravo.py')] })
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1', 'b2'])
  assert.deepEqual(result.confirmedBugs[0].alsoAt, BRANCHES.alsoAt, 'the row read from the ledger still carries them')
  const [first, second] = ['fix:factory.py', 'fix:bravo.py'].map(label => calls.find(c => c.label === label).prompt)
  const row = [...first.matchAll(/<<<UNTRUSTED\n([\s\S]*?)\nUNTRUSTED>>>/g)].map(m => m[1]).find(text => text.startsWith('bugId: b1'))
  assert.ok(row.endsWith(H.alsoAtLines(BRANCHES)), 'the places are data, fenced with the row they belong to')
  assert.ok(first.includes(H.ALSO_AT_NOTE))
  assert.equal(second.includes('alsoReported'), false, 'the fixer of a file with no such row is asked what it was asked before')
})
