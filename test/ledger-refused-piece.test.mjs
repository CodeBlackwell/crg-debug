// A ledger piece a writer will not write. In wfe-arrow-py-RH3.3 and its relaunch a safety
// classifier stopped the writer of one nine-row piece, every retry packed the same nine rows
// together and was stopped again, and the run saved no ledger, so its fix half never started.
// A piece none of whose rows arrived now goes again one row to an agent: only a row refused
// alone stays out, and the partial save stands without it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const NAMES = ['retryPieces', 'packLines', 'WRITE_ROWS_ALONE', 'LEDGER_PIECE']
const H = new Function(`${block}\nreturn { ${NAMES.join(', ')} }`)()
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { ledgerDisk } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { ledgerDisk }`)()

const line = (slot, place) => `crg-ledger-put ${slot} ${place} 0000abcd {"file":"f${place}"}`
const rows = (slot, from, n) => Array.from({ length: n }, (_, i) => line(slot, from + i))
const nameOf = l => l.split(' ', 3).slice(1).join(' ')
const ROOM = 100

test('retryPieces: a piece lost whole on its first try goes again packed, as before: the fault may have passed', () => {
  const lost = rows('set.deferred', 15, 9)
  const sent = [rows('set.deferred', 0, 15).join('\n'), lost.join('\n'), rows('set.deferred', 24, 10).join('\n')]
  assert.deepEqual(H.retryPieces(sent, lost.map(nameOf), ROOM, false), H.packLines(lost, H.LEDGER_PIECE))
})
test('retryPieces: a piece lost whole on a retry goes again one row to an agent', () => {
  const lost = rows('set.deferred', 15, 9)
  const sent = [rows('set.deferred', 0, 15).join('\n'), lost.join('\n'), rows('set.deferred', 24, 10).join('\n')]
  assert.deepEqual(H.retryPieces(sent, lost.map(nameOf), ROOM, true), lost)
})
test('retryPieces: a retry of one piece lost whole goes again one row to an agent', () => {
  const lost = rows('set.confirmedBugs', 0, 7)
  assert.deepEqual(H.retryPieces([lost.join('\n')], lost.map(nameOf), ROOM, true), lost)
})
test('retryPieces: rows missing from a piece that partly arrived go as before, alone when few and packed when many', () => {
  const piece = rows('set.deferred', 0, 10)
  assert.deepEqual(H.retryPieces([piece.join('\n')], [nameOf(piece[3])], ROOM, true), [piece[3]])
  const many = piece.slice(0, H.WRITE_ROWS_ALONE + 1)
  assert.deepEqual(H.retryPieces([piece.join('\n')], many.map(nameOf), ROOM, true), H.packLines(many, H.LEDGER_PIECE))
})
test('retryPieces: a piece lost whole and stray rows of another: the piece row by row, the strays as before', () => {
  const lost = rows('set.deferred', 15, 9)
  const other = rows('set.deferred', 0, 15)
  const strays = [other[2], other[7]]
  const sent = [other.join('\n'), lost.join('\n')]
  assert.deepEqual(H.retryPieces(sent, [...strays, ...lost].map(nameOf), ROOM, true), [...lost, ...strays])
})
test('retryPieces: when several pieces were sent on a retry and none arrived, every row goes alone: refused rows can sit in each', () => {
  const a = rows('set.deferred', 0, 9)
  const b = rows('set.deferred', 9, 9)
  assert.deepEqual(H.retryPieces([a.join('\n'), b.join('\n')], [...a, ...b].map(nameOf), ROOM, true), [...a, ...b])
  assert.deepEqual(H.retryPieces([a.join('\n'), b.join('\n')], [...a, ...b].map(nameOf), 17, true), H.packLines([...a, ...b], H.LEDGER_PIECE), 'unless the agents left cannot take one each')
})
test('retryPieces: too few agents for a row each, the rows go as before, packed', () => {
  const lost = rows('set.deferred', 15, 9)
  const sent = [rows('set.deferred', 0, 15).join('\n'), lost.join('\n')]
  assert.deepEqual(H.retryPieces(sent, lost.map(nameOf), 8, true), H.packLines(lost, H.LEDGER_PIECE))
  assert.deepEqual(H.retryPieces(sent, lost.map(nameOf), 9, true), lost)
})
test('retryPieces: rows already sent alone go alone again', () => {
  const sent = rows('set.deferred', 15, 3)
  assert.deepEqual(H.retryPieces(sent, [nameOf(sent[0])], ROOM, true), [sent[0]])
})

// ---- whole runs: a sweep of findings with stub agents and the stand-in disk ----------------
const LEDGER = '/tmp/crg-fixture/.crg-debug/ledger.json'
const finding = (i, pad = '') => ({ file: `src/m${i}.py:${i + 1}`, concern: 'backend-logic', symptom: `symptom ${i}${pad}`, rootCause: `root cause ${i}`, severity: 'High', whyRepro: `in ${i} -> out`, confidence: 'high' })
const sweep = async (refuse, { perFinder = 3, pad = '' } = {}) => {
  const logs = []
  const labels = []
  const disk = ledgerDisk(SRC)
  let n = 0
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    labels.push(label)
    if (label.startsWith('persist:') && label !== 'persist:assemble' && [].concat(refuse.row).some(row => prompt.includes(row))) return refuse.answer
    if (label === 'setup') return { graphStats: '1 file', resolvedScope: 'full repo', toolchain: [{ package: 'app', test: 'pytest' }], baselineFailures: [] }
    if (label === 'map') return { overview: 'o', targets: [{ file: 'src/a.py', concern: 'security', functions: ['check'] }] }
    if (label.startsWith('find:')) return { audited: [], findings: Array.from({ length: perFinder }, () => finding(n++, pad)) }
    if (label === 'dedup') return { duplicateGroups: [] }
    const onDisk = disk.answer(prompt)
    if (onDisk !== undefined) return onDisk
    if (opts.phase === 'Verify') return { confirmed: true, reason: 'traced it', classification: 'real-bug' }
    return 'ok'
  }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const run = new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC.replace(/^export\s+const\s+meta/m, 'const meta'))
  const copy = r => (r === undefined ? r : JSON.parse(JSON.stringify(r)))
  const result = await run({ repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/M.md' }, (p, o) => Promise.resolve(agent(p, o)).then(copy), ts => Promise.all(ts.map(t => t())).then(copy), m => logs.push(m), undefined, () => {})
  const text = disk.files.get(LEDGER)
  return { logs, result, ledger: text && JSON.parse(text), labels }
}
const ROW4 = '"symptom":"symptom 4"'

for (const [kind, answer] of [['stopped (the agent errs)', null], ['declining (it answers and writes nothing)', 'I did not write the file.']]) {
  test(`a run: a writer ${kind} on one row saves every other row, and a placeholder for that one`, async () => {
    const r = await sweep({ row: ROW4, answer })
    assert.equal(r.result.ledgerSaved, 'partial')
    assert.deepEqual(r.result.notWritten, [{ bucket: 'confirmedBugs', index: 4, file: 'src/m4.py:5' }])
    assert.deepEqual(r.ledger.confirmedBugs.filter((_, i) => i !== 4), r.result.confirmedBugs.filter((_, i) => i !== 4))
    assert.deepEqual(r.ledger.confirmedBugs[4], { file: 'src/m4.py:5', notWritten: r.ledger.confirmedBugs[4].notWritten })
    assert.equal(r.ledger.counts.confirmedBugs, r.result.confirmedBugs.length)
    const writers = r.labels.filter(l => l.startsWith('persist:') && l !== 'persist:assemble')
    assert.ok(writers.length > 3, 'the lost piece went again row by row')
    assert.ok(r.logs.some(l => l.includes('ledger persisted WITHOUT 1 row(s)')))
  })
}

test('a run: the live shape, a ledger of several pieces and one refused on every try, saves without the one row', async () => {
  const pad = ` ${'x'.repeat(1500)}`
  const r = await sweep({ row: '"symptom":"symptom 13 ', answer: null }, { perFinder: 12, pad })
  const pieces = r.labels.indexOf('persist:assemble')
  assert.ok(pieces >= 3, `the write went in ${pieces} pieces`)
  assert.equal(r.result.ledgerSaved, 'partial')
  assert.deepEqual(r.result.notWritten, [{ bucket: 'confirmedBugs', index: 13, file: 'src/m13.py:14' }])
  assert.deepEqual(r.ledger.confirmedBugs.filter((_, i) => i !== 13), r.result.confirmedBugs.filter((_, i) => i !== 13))
  assert.equal(r.labels.filter(l => l === 'persist:assemble').length, 4, 'three tries, then the write without the row')
})

test('a run: more than four rows each refused alone, in several pieces, are all left out and every other row is saved', async () => {
  const pad = ` ${'x'.repeat(1500)}`
  const refused = [2, 9, 13, 17, 21, 22]
  const r = await sweep({ row: refused.map(i => `"symptom":"symptom ${i} `), answer: null }, { perFinder: 12, pad })
  assert.equal(r.result.ledgerSaved, 'partial')
  assert.deepEqual(r.result.notWritten, refused.map(i => ({ bucket: 'confirmedBugs', index: i, file: `src/m${i}.py:${i + 1}` })))
  assert.deepEqual(r.ledger.confirmedBugs.filter((_, i) => !refused.includes(i)), r.result.confirmedBugs.filter((_, i) => !refused.includes(i)))
  assert.ok(refused.every(i => r.ledger.confirmedBugs[i].notWritten), 'a placeholder in each refused row\'s place')
  assert.equal(r.ledger.counts.confirmedBugs, r.result.confirmedBugs.length)
  assert.ok(r.logs.some(l => l.includes(`ledger persisted WITHOUT ${refused.length} row(s)`)))
})
