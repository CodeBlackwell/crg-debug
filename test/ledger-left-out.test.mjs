// A ledger that survives a row its agents cannot copy: when finding rows, any number of them,
// still have not reached the disk after every retry, the write program is run once more and
// told which rows to stand without. It writes every other row and a placeholder
// {file, notWritten} in each lost row's place. Helpers are eval-extracted from the shipped
// script; whole runs use the script's own two ledger programs over a stand-in disk.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const NAMES = ['canLeaveOut', 'plainWord', 'ledgerWrite', 'ledgerWriteWithout', 'ledgerWriteCommand', 'ledgerReadCommand', 'ledgerParts', 'notWrittenOf', 'notWrittenNames', 'isNotWrittenRow', 'ledgerReadOf', 'ledgerSaveLine', 'ledgerSavedOf', 'LEDGER_UNREPORTED', 'textSeal']
const H = new Function(`${block}\nreturn { ${NAMES.join(', ')} }`)()
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, ledgerDisk } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, ledgerDisk }`)()

const finding = (i, extra = {}) => ({ file: `src/m${i}.py:${i + 1}`, concern: 'backend-logic', symptom: `symptom ${i}`, rootCause: `root cause ${i}`, severity: 'High', whyRepro: `in ${i} -> out`, confidence: 'high', ...extra })
const sealOfRow = (write, name) => write.rows.find(r => r.name === name).line.split(' ')[3]

test('canLeaveOut: a few finding rows yes; nothing missing, a head row, a count or a kept place no', () => {
  assert.equal(H.canLeaveOut(['set.confirmedBugs 22']), true)
  assert.equal(H.canLeaveOut(['append.deferred 36', 'set.unreviewed 0', 'set.rejected 4', 'set.confirmedBugs 1']), true)
  assert.equal(H.canLeaveOut([]), false)
  for (const name of ['set.counts -', 'set.toolchain 0', 'set.baselineFailures 3', 'keep.confirmedBugs 0', 'set.unread 1', 'set.repoRoot -', 'set.models -']) assert.equal(H.canLeaveOut([name]), false, name)
})
test('canLeaveOut: finding rows in any number yes; one row that may not be left out among them no', () => {
  assert.equal(H.canLeaveOut(Array.from({ length: 5 }, (_, i) => `set.deferred ${i}`)), true)
  assert.equal(H.canLeaveOut(Array.from({ length: 300 }, (_, i) => `set.${['confirmedBugs', 'deferred', 'rejected', 'unreviewed'][i % 4]} ${i}`)), true)
  assert.equal(H.canLeaveOut(['set.confirmedBugs 1', 'set.counts -']), false)
  assert.equal(H.canLeaveOut([...Array.from({ length: 9 }, (_, i) => `append.deferred ${i}`), 'set.toolchain 0']), false)
})
test('plainWord: one shell word with no quote, backslash, space or tilde, which decodes back', () => {
  for (const file of ['/arrow/arrow/arrow.py:1582-1587', "src/it's here.py:3", 'a\\b (c)*!~.py', 'ünïcode/路径.py:1']) {
    const word = H.plainWord(file)
    assert.match(word, /^[A-Za-z0-9._%-]+$/, word)
    assert.equal(decodeURIComponent(word), file)
  }
})

const PATCH = { set: { repoRoot: '/r', counts: { confirmedBugs: 3, deferred: 1, rejected: 0, unreviewed: 0 }, confirmedBugs: [finding(0), finding(1), finding(2)], deferred: [finding(3)] } }
const WRITE = H.ledgerWrite(PATCH)
const LOST = ['set.confirmedBugs 1']
const PATH = '/r/.crg-debug/ledger.json'

test('ledgerWriteWithout: the token names the rows in write order and the seal covers the kept lines and the token', () => {
  const without = H.ledgerWriteWithout(WRITE, PATCH, ['set.deferred 0', 'set.confirmedBugs 1'])
  assert.equal(without.left, `set.confirmedBugs:1:${sealOfRow(WRITE, 'set.confirmedBugs 1')}:src%2Fm1.py%3A2,set.deferred:0:${sealOfRow(WRITE, 'set.deferred 0')}:src%2Fm3.py%3A4`)
  const kept = WRITE.rows.filter(r => !['set.deferred 0', 'set.confirmedBugs 1'].includes(r.name)).map(r => r.line)
  assert.equal(without.want, H.textSeal([...kept, without.left].join('\n')))
  assert.equal(without.shape, WRITE.shape)
  assert.deepEqual(without.rows, WRITE.rows)
})
test('ledgerWriteCommand: a write without rows ends with the token; a whole write sends the command it always sent', () => {
  const without = H.ledgerWriteWithout(WRITE, PATCH, LOST)
  assert.ok(H.ledgerWriteCommand(PATH, 4, without, false).endsWith(` new ${without.left}`))
  assert.ok(H.ledgerWriteCommand(PATH, 4, WRITE, false).endsWith(' new'))
})

// Runs the real write program over a stand-in disk whose part file holds `lines`.
const writeWith = (write, lines, command = H.ledgerWriteCommand(PATH, 1, write, false)) => {
  const disk = ledgerDisk(SRC)
  disk.files.set(`${PATH}.part-1`, `${lines.join('\n')}\n`)
  const out = disk.answer(`<<<UNTRUSTED\n${command}\nUNTRUSTED>>>`).results[0]
  return { disk, out, text: disk.files.get(PATH) }
}
const whole = writeWith(WRITE, WRITE.rows.map(r => r.line))
const withoutRow = H.ledgerWriteWithout(WRITE, PATCH, LOST)
const linesWithout = write => write.rows.filter(r => !LOST.includes(r.name)).map(r => r.line)

test('write program: a write whole is written whole', () => {
  assert.equal(whole.out.exitCode, 0)
  assert.deepEqual(JSON.parse(whole.text).confirmedBugs, PATCH.set.confirmedBugs)
})
test('write program: with exactly the named rows missing, it writes a placeholder in their place and every other row byte for byte', () => {
  const partial = writeWith(withoutRow, linesWithout(withoutRow))
  assert.equal(partial.out.exitCode, 0)
  const expected = JSON.parse(whole.text)
  expected.confirmedBugs[1] = { file: 'src/m1.py:2', notWritten: sealOfRow(WRITE, 'set.confirmedBugs 1') }
  assert.equal(partial.text, JSON.stringify(expected, null, 2))
  assert.equal(JSON.parse(partial.text).counts.confirmedBugs, 3)
})
test('write program: it refuses and writes nothing when a different row than the named one is missing', () => {
  const lines = withoutRow.rows.filter(r => !LOST.includes(r.name) && r.name !== 'set.confirmedBugs 2').map(r => r.line)
  const refused = writeWith(withoutRow, lines)
  assert.equal(refused.out.exitCode, 1)
  assert.match(refused.out.stdout, /crg-ledger-not-written/)
  assert.equal(refused.text, undefined)
})
test('write program: it refuses and writes nothing when the named row is present after all, or the seal is wrong', () => {
  assert.equal(writeWith(withoutRow, WRITE.rows.map(r => r.line)).text, undefined)
  const badSeal = { ...withoutRow, want: '00000000' }
  const refused = writeWith(badSeal, linesWithout(badSeal))
  assert.equal(refused.out.exitCode, 1)
  assert.equal(refused.text, undefined)
})

test('read program: a placeholder counts as a finding, so the counts the file states stay true', () => {
  const partial = writeWith(withoutRow, linesWithout(withoutRow))
  const read = ledgerDisk(SRC)
  read.files.set(PATH, partial.text)
  const head = read.answer(`<<<UNTRUSTED\n${H.ledgerReadCommand(PATH, '0')}\nUNTRUSTED>>>`).results[0]
  assert.equal(head.exitCode, 0)
  const counts = tag => new RegExp(`^crg-ledger-${tag} (.*)$`, 'm').exec(head.stdout)[1]
  assert.equal(counts('findings'), counts('rows'), 'every row, the placeholder included, is a finding')
})
test('ledgerReadOf: a placeholder comes back under unread, marked, with its file; every other row as before', () => {
  const manifest = { expects: { toolchain: 1, baselineFailures: 0, confirmedBugs: 3, unreviewed: 1 } }
  const got = new Map([['toolchain[0]', { package: 'app' }], ['confirmedBugs[0]', finding(0)], ['confirmedBugs[1]', { file: 'src/m1.py:2', notWritten: '0badf00d' }], ['confirmedBugs[2]', finding(2)]])
  assert.deepEqual(H.ledgerReadOf(manifest, got), {
    unread: [{ bucket: 'confirmedBugs', index: 1, file: 'src/m1.py:2', notWritten: true }, { bucket: 'unreviewed', index: 0 }],
    toolchain: [{ package: 'app' }], baselineFailures: [], confirmedBugs: [finding(0), finding(2)], unreviewed: [],
  })
})

test('notWrittenOf, notWrittenNames, isNotWrittenRow: rows left out are named by bucket, place and file', () => {
  assert.deepEqual(H.notWrittenOf(PATCH, LOST), [{ bucket: 'confirmedBugs', index: 1, file: 'src/m1.py:2' }])
  assert.deepEqual(H.notWrittenOf({ append: { deferred: [finding(9)] } }, ['append.deferred 0']), [{ bucket: 'deferred', index: 0, file: 'src/m9.py:10' }])
  assert.equal(H.notWrittenNames(H.notWrittenOf(PATCH, LOST)), 'confirmedBugs[1] (src/m1.py:2)')
  assert.equal(H.isNotWrittenRow({ file: 'a:1', notWritten: 'ab12' }), true)
  assert.equal(H.isNotWrittenRow(finding(0)), false)
  assert.equal(H.isNotWrittenRow(null), false)
})
test('ledgerSaveLine and ledgerSavedOf: each outcome has its own words, and a partial write never reads as a whole one', () => {
  const left = [{ bucket: 'confirmedBugs', index: 22, file: '/arrow/arrow/arrow.py:1582-1587' }]
  assert.equal(H.ledgerSaveLine('/r/l.json', { why: '', notWritten: [] }), 'ledger persisted -> /r/l.json')
  const partial = H.ledgerSaveLine('/r/l.json', { why: '', notWritten: left })
  assert.ok(partial.startsWith('ledger persisted WITHOUT 1 row(s) -> /r/l.json'))
  assert.ok(partial.includes('confirmedBugs[22] (/arrow/arrow/arrow.py:1582-1587)'))
  assert.ok(!partial.includes('ledger persisted ->'))
  assert.ok(H.ledgerSaveLine('/r/l.json', { why: 'some rows did not reach the disk', notWritten: [] }).startsWith('ledger persist FAILED — /r/l.json was not written'))
  assert.ok(H.ledgerSaveLine('/r/l.json', { why: H.LEDGER_UNREPORTED, notWritten: [] }).includes('is not known to be written'))
  assert.deepEqual([H.ledgerSavedOf({ why: '', notWritten: [] }), H.ledgerSavedOf({ why: '', notWritten: left }), H.ledgerSavedOf({ why: 'x', notWritten: [] })], [true, 'partial', false])
})

// ---- whole runs: a sweep of findings with stub agents and the stand-in disk ----------------
const LEDGER = '/tmp/crg-fixture/.crg-debug/ledger.json'
// Two reviewers confirm every finding. `edit(prompt, label)` is what a writer that alters its text acts on.
const sweep = async ({ perFinder = 3, edit = p => p, on = () => undefined } = {}) => {
  const logs = []
  const labels = []
  const disk = ledgerDisk(SRC)
  let n = 0
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    labels.push(label)
    const custom = on(label, prompt)
    if (custom !== undefined) return custom
    if (label === 'setup') return { graphStats: '1 file', resolvedScope: 'full repo', toolchain: [{ package: 'app', test: 'pytest' }], baselineFailures: [] }
    if (label === 'map') return { overview: 'o', targets: [{ file: 'src/a.py', concern: 'security', functions: ['check'] }] }
    if (label.startsWith('find:')) return { audited: [], findings: Array.from({ length: perFinder }, () => finding(n++)) }
    if (label === 'dedup') return { duplicateGroups: [] }
    const onDisk = disk.answer(edit(prompt, label))
    if (onDisk !== undefined) return onDisk
    if (opts.phase === 'Verify') return { confirmed: true, reason: 'traced it', classification: 'real-bug' }
    return 'ok'
  }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const run = new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC.replace(/^export\s+const\s+meta/m, 'const meta'))
  const copy = r => (r === undefined ? r : JSON.parse(JSON.stringify(r)))
  const result = await run({ repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/M.md' }, (p, o) => Promise.resolve(agent(p, o)).then(copy), ts => Promise.all(ts.map(t => t())).then(copy), m => logs.push(m), undefined, () => {})
  const text = disk.files.get(LEDGER)
  return { logs, result, text, ledger: text && JSON.parse(text), labels }
}
const isWriter = label => label.startsWith('persist:') && label !== 'persist:assemble'
// Every writer handed this row drops the same words from it, as in the live failure.
const dropRoot = n => (p, l) => (isWriter(l) ? p.replace(`"rootCause":"root cause ${n}"`, `"rootCause":"root ${n}"`) : p)

test('a run: one row copied wrong on every try saves the rest, a placeholder in its place, and says so', async () => {
  const r = await sweep({ edit: dropRoot(1) })
  assert.equal(r.result.ledgerSaved, 'partial')
  assert.deepEqual(r.result.notWritten, [{ bucket: 'confirmedBugs', index: 1, file: 'src/m1.py:2' }])
  assert.deepEqual(r.ledger.confirmedBugs[1], { file: 'src/m1.py:2', notWritten: r.ledger.confirmedBugs[1].notWritten })
  assert.match(r.ledger.confirmedBugs[1].notWritten, /^[0-9a-f]{8}$/)
  assert.deepEqual(r.ledger.confirmedBugs.filter((_, i) => i !== 1), r.result.confirmedBugs.filter((_, i) => i !== 1))
  assert.deepEqual(r.result.confirmedBugs[1], finding(1), 'the return still holds the row whole')
  assert.equal(r.ledger.counts.confirmedBugs, 6, 'the placeholder stands in its place in the count')
  assert.ok(r.logs.some(l => l.includes('ledger persisted WITHOUT 1 row(s)')))
  assert.deepEqual(r.labels.filter(l => l.startsWith('persist')), ['persist:1', 'persist:assemble', 'persist:2', 'persist:assemble', 'persist:3', 'persist:assemble', 'persist:assemble'])
})
test('a run: a write with no fault is what it was before: ledgerSaved true and no notWritten key', async () => {
  const r = await sweep()
  assert.equal(r.result.ledgerSaved, true)
  assert.equal('notWritten' in r.result, false)
  assert.ok(r.logs.some(l => l.includes('ledger persisted -> ')))
  assert.ok(!r.logs.some(l => l.includes('WITHOUT')))
  assert.ok(!r.text.includes('notWritten'))
})
test('a run: five rows copied wrong on every try (more than the old cap of four) are left out, and the rest saved', async () => {
  const r = await sweep({ edit: (p, l) => (isWriter(l) ? p.replace(/"rootCause":"root cause ([0-4])"/g, '"rootCause":"root $1"') : p) })
  assert.equal(r.result.ledgerSaved, 'partial')
  assert.deepEqual(r.result.notWritten, [0, 1, 2, 3, 4].map(i => ({ bucket: 'confirmedBugs', index: i, file: `src/m${i}.py:${i + 1}` })))
  assert.deepEqual(r.ledger.confirmedBugs.slice(0, 5).map(row => Object.keys(row)), Array(5).fill(['file', 'notWritten']))
  assert.deepEqual(r.ledger.confirmedBugs[5], r.result.confirmedBugs[5])
  assert.equal(r.ledger.counts.confirmedBugs, 6)
  assert.ok(r.logs.some(l => l.includes('ledger persisted WITHOUT 5 row(s)')))
  assert.equal(r.labels.filter(l => l === 'persist:assemble').length, 4, 'three tries, then the write without them')
})
test('a run: a count that never arrives is not left out, and nothing is written', async () => {
  const r = await sweep({ edit: (p, l) => (isWriter(l) ? p.replace('"confirmedBugs":6', '"confirmedBugs":5') : p) })
  assert.equal(r.result.ledgerSaved, false)
  assert.equal(r.text, undefined)
})
test('a run: a write without the row that does not report is not believed', async () => {
  let k = 0
  const r = await sweep({ edit: dropRoot(1), on: l => (l === 'persist:assemble' && ++k === 4 ? null : undefined) })
  assert.equal(r.result.ledgerSaved, false)
  assert.ok(r.logs.some(l => l.includes('is not known to be written')))
})

// ---- a run from such a ledger ----------------------------------------------------------------
const held = async () => {
  const r = await sweep({ edit: dropRoot(1) })
  return r.ledger
}
const errorOf = async run => {
  try {
    await run()
    return null
  } catch (err) {
    return err.message
  }
}
test('a fix run from the ledger leaves the placeholder out, takes the other rows to Fix, and logs it', async () => {
  const ledger = await held()
  const run = await fixRun(SRC, { bugs: [], on: { 'ingest-ledger': () => ledger } })
  assert.equal(run.result.mode, 'fix-from-ledger')
  assert.equal(run.result.confirmedBugs.length, 5)
  assert.ok(run.labels.some(l => l.startsWith('fix:')))
  assert.deepEqual(run.result.unread, [{ bucket: 'confirmedBugs', index: 1, file: 'src/m1.py:2', notWritten: true }])
  assert.ok(run.logs.some(l => l.startsWith('Ingest: 1 row(s)') && l.includes('confirmedBugs[1] (src/m1.py:2)')))
  assert.ok(run.logs.some(l => l.startsWith('Fix: 1 confirmed bug(s) are only placeholders')))
})
test('a fixOnly run from the ledger stops with an error, since a confirmed row is a placeholder', async () => {
  const ledger = await held()
  const message = await errorOf(() => fixRun(SRC, { bugs: [], args: { fixOnly: true }, on: { 'ingest-ledger': () => ledger } }))
  assert.match(message, /confirmedBugs\[1\] did not arrive whole/)
  assert.match(message, /fixOnly/)
})
