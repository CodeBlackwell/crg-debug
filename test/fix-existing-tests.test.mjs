// Protects the promise that a fix cannot pass by rewriting the tests it is judged by: a
// fix may add tests, but a fixer that changes or removes a line of a test file that existed
// when its wave began is taken back by the script, not retried, and reported for a person.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(
  `${block}\nreturn { isTestFile, testEditCommand, changedExistingFiles, existingTestsEdited, testChangeReason, snapshotCommand, snapshotOf, restoreCommands, TEST_CHECK_UNREPORTED }`,
)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const SNAP = 'df36759feac9f37a1208353c46d05951052b410e'
const relay = (stdout, exitCode = 0) => ({ results: [{ command: 'check', exitCode, stdout }] })
const summary = (n, id = SNAP) => `crg-test-edits-checked ${id} ${n}`

// ---- the script's own judgment -----------------------------------------------------

test('a test file is known by its name', () => {
  for (const f of ['tests/test_utils.py', 'pkg/utils_test.go', 'src/a.test.ts', 'src/a.spec.js', 'web/a-test.jsx', 'app/tests.py', 'test.py',
    'src/test/java/FooTest.java', 'FooTests.cs', 'FooSpec.scala', 'spec/models/user_spec.rb', 'lib/x_tests.exs', 'test_data.json']) {
    assert.equal(H.isTestFile(f), true, f)
  }
  for (const f of ['src/click/termui.py', 'tests/conftest.py', 'tests/helpers.py', 'tests/fixtures/expected.txt', 'src/contest.py', 'src/latest.py',
    'docs/testing.md', 'tests/__snapshots__/a.test.js.snap', 'Latest.java', 'src/attest.ts', '', undefined]) {
    assert.equal(H.isTestFile(f), false, String(f))
  }
})

test('the rows the check printed are read whatever the relay did to the tabs, and counted against the summary', () => {
  const rows = '3\t2\tsrc/click/termui.py\n1\t1\ttests/test_utils.py\n-\t-\ttests/test_logo.png'
  const want = [{ path: 'src/click/termui.py', removed: 2 }, { path: 'tests/test_utils.py', removed: 1 }, { path: 'tests/test_logo.png', removed: -1 }]
  assert.deepEqual(H.changedExistingFiles(relay(`${rows}\n${summary(3)}\n`), SNAP), want)
  assert.deepEqual(H.changedExistingFiles(relay(`${rows.replace(/\t/g, '  ')}\n${summary(3)}`), SNAP), want, 'tabs relayed as spaces')
  assert.deepEqual(H.changedExistingFiles(relay(`\n${summary(0)}\n`), SNAP), [], 'nothing changed is an answer')
})

test('a check that cannot be trusted to be complete is no answer at all', () => {
  const rows = '3\t2\tsrc/a.py\n1\t1\ttests/test_a.py'
  assert.equal(H.changedExistingFiles(null, SNAP), null, 'a dead relay')
  assert.equal(H.changedExistingFiles(relay(''), SNAP), null, 'an empty stdout is never "nothing changed"')
  assert.equal(H.changedExistingFiles(relay(rows), SNAP), null, 'no summary line')
  assert.equal(H.changedExistingFiles(relay(`3\t2\tsrc/a.py\n${summary(2)}`), SNAP), null, 'a row went missing in the relay')
  assert.equal(H.changedExistingFiles(relay(`${rows}\n${summary(2, '0'.repeat(40))}`), SNAP), null, 'the summary of another restore point')
  assert.equal(H.changedExistingFiles(relay(`${rows}\n${summary(2)}`, 1), SNAP), null, 'a non-zero exit')
  assert.equal(H.changedExistingFiles(relay('no existing test was changed'), SNAP), null, 'a summary in the agent\'s words')
  assert.equal(H.changedExistingFiles(relay(`${summary(0)}`), ''), null)
})

test('only an existing test with a changed or removed line is a violation', () => {
  const changed = [
    { path: 'src/click/termui.py', removed: 4 }, // source: changing it is the job
    { path: 'tests/test_utils.py', removed: 2 }, // an expected value rewritten
    { path: 'tests/test_termui.py', removed: 0 }, // only added to
    { path: 'tests/test_logo.png', removed: -1 }, // binary and different
    { path: 'checks/styling_cases.py', removed: 1 }, // a test only because a fixer said so
    { path: 'tests/conftest.py', removed: 3 }, // not covered by the rule
  ]
  assert.deepEqual(H.existingTestsEdited(changed, ['./checks/styling_cases.py', undefined]).map(e => e.path), ['tests/test_utils.py', 'tests/test_logo.png', 'checks/styling_cases.py'])
  assert.deepEqual(H.existingTestsEdited(changed, []).map(e => e.path), ['tests/test_utils.py', 'tests/test_logo.png'])
  assert.equal(H.testChangeReason([{ path: 'tests/test_utils.py' }, { path: 'tests/test_b.py' }]), 'fix needs an existing test changed: tests/test_utils.py, tests/test_b.py')
})

test('in a real repository the check lists a rewritten or removed test, and not one that was only added to', () => {
  const repo = mkdtempSync(join(tmpdir(), 'crg-tests-'))
  const sh = command => execFileSync('sh', ['-c', command], { stdio: 'pipe' }).toString()
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { stdio: 'pipe' }).toString()
  const write = (file, text) => writeFileSync(join(repo, file), text)
  try {
    git('init', '-q')
    git('config', 'user.email', 'dev@example.com')
    git('config', 'user.name', 'dev')
    mkdirSync(join(repo, 'src'))
    mkdirSync(join(repo, 'tests'))
    write('src/termui.py', 'def style(text):\n    return text\n')
    write('tests/test_utils.py', 'def test_styling():\n    assert style("x") == "x"\n')
    write('tests/test_termui.py', 'def test_one():\n    assert True\n')
    write('tests/test_old.py', 'def test_old():\n    assert True\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    write('tests/test_wip.py', 'def test_wip():\n    assert 1\n') // existed when the wave began, never committed
    const snapshot = H.snapshotOf({ results: [{ command: 'snapshot', exitCode: 0, stdout: sh(H.snapshotCommand(repo)) }] })
    const indexBefore = readFileSync(join(repo, '.git/index'))

    // The wave: a fix, an expected value rewritten to match it, a test appended, a test
    // file created, an old test deleted, and an uncommitted one edited.
    write('src/termui.py', 'def style(text):\n    return text.upper()\n')
    write('tests/test_utils.py', 'def test_styling():\n    assert style("x") == "X"\n')
    appendFileSync(join(repo, 'tests/test_termui.py'), '\ndef test_two():\n    assert True\n')
    write('tests/test_new.py', 'def test_new():\n    assert True\n')
    unlinkSync(join(repo, 'tests/test_old.py'))
    write('tests/test_wip.py', 'def test_wip():\n    assert 2\n')

    const stdout = sh(H.testEditCommand(repo, snapshot))
    assert.equal(stdout, `1\t1\tsrc/termui.py\n0\t2\ttests/test_old.py\n1\t1\ttests/test_utils.py\n1\t1\ttests/test_wip.py\ncrg-test-edits-checked ${snapshot} 4\n`)
    const edits = H.existingTestsEdited(H.changedExistingFiles({ results: [{ command: 'check', exitCode: 0, stdout }] }, snapshot), [])
    assert.deepEqual(edits, [{ path: 'tests/test_old.py', removed: 2 }, { path: 'tests/test_utils.py', removed: 1 }, { path: 'tests/test_wip.py', removed: 1 }])
    assert.deepEqual(readFileSync(join(repo, '.git/index')), indexBefore, 'the check must not touch the index')

    // Nothing changed since the restore point: the summary line, counting zero.
    for (const c of H.restoreCommands(repo, ['src/termui.py', 'tests/test_utils.py', 'tests/test_termui.py', 'tests/test_new.py', 'tests/test_old.py', 'tests/test_wip.py'], snapshot)) sh(c)
    assert.equal(sh(H.testEditCommand(repo, snapshot)), `\ncrg-test-edits-checked ${snapshot} 0\n`)
    // A restore point that does not exist is an error, never "nothing changed".
    assert.throws(() => sh(H.testEditCommand(repo, '0'.repeat(40))), err => err.status !== 0 && !err.stdout.toString().includes('crg-test-edits-checked'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

// ---- stubbed fix runs --------------------------------------------------------------

const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const idIn = prompt => /crg-test-edits-checked ([0-9a-f]+) /.exec(prompt)[1]
// What the check prints for a wave: its rows, then the summary line counting them.
const printed = (...rows) => ({ prompt }) => ({ results: [{ command: 'check', exitCode: 0, stdout: `${rows.join('\n')}\n${summary(rows.length, idIn(prompt))}\n` }] })
const SOURCES = ['3\t2\tsrc/alpha.py', '1\t1\tsrc/bravo.py'] // both fixes changed source lines, as fixes do
const names = bugs => bugs.map(b => b.bugId)

test('a fixer that rewrites an expected value in an existing test is taken back, not retried, and the rest of the wave commits', async () => {
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...SOURCES, '1\t1\ttests/test_alpha.py') } })
  assert.deepEqual(labels, [
    'ingest-ledger', 'fix-branch', 'regress:baseline', 'snapshot:wave1', 'fix:alpha.py', 'fix:bravo.py', 'gate:alpha.py', 'gate:bravo.py',
    'testedits:wave1', 'restore:wave1', 'regress:wave1', 'commit:wave', 'gate',
  ], 'no blame agent — the fixer is known — and no second try')
  const restore = calls.find(c => c.label === 'restore:wave1')
  assert.ok(restore.prompt.includes(`-- 'src/alpha.py' 'tests/test_alpha.py' `) && !restore.prompt.includes('bravo'), 'only that fixer\'s files go back')
  assert.match(calls.find(c => c.label === 'commit:wave').prompt, /add -- "src\/bravo\.py" "tests\/test_bravo\.py" {3}\(EXACTLY/)
  assert.deepEqual(names(result.fix.fixed), ['b2'])
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', 'fix needs an existing test changed: tests/test_alpha.py']])
  assert.deepEqual(result.fix.existingTestEdits, [{ wave: 1, bugs: ['b1'], files: [{ path: 'tests/test_alpha.py', removed: 1 }] }])
  assert.deepEqual(result.fix.waves, [{ wave: 1, files: 2, attempted: 2, closed: 1 }])
  assert.ok(logs.includes('Fix wave 1: fix needs an existing test changed: tests/test_alpha.py — took back b1; not retried, a person decides'))
  assert.match(logs.at(-1), /· 1 fix\(es\) refused: they need an existing test changed$/)

  const check = calls.find(c => c.label === 'testedits:wave1')
  assert.ok(check.prompt.includes(H.testEditCommand('/tmp/crg-fixture', `${'5'.repeat(39)}1`)), 'the check is the script\'s own command, against this wave\'s restore point')
  assert.deepEqual(check.opts.schema.required, ['results'])
})

test('a fixer that only adds a test to an existing file is untouched', async () => {
  // The command leaves an added-to file out; a relay that listed it anyway changes nothing.
  for (const rows of [SOURCES, [...SOURCES, '9\t0\ttests/test_alpha.py']]) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...rows) } })
    assert.equal(labels.some(l => l.startsWith('restore:')), false)
    assert.deepEqual(names(result.fix.fixed), ['b1', 'b2'])
    assert.deepEqual(result.fix.existingTestEdits, [])
    assert.equal(result.fix.commits.length, 1)
  }
})

test('a check that does not report is not a pass: the wave is put back and nothing commits', async () => {
  const dropped = ({ prompt }) => ({ results: [{ command: 'check', exitCode: 0, stdout: `3\t2\tsrc/alpha.py\n${summary(2, idIn(prompt))}` }] })
  const empty = () => ({ results: [{ command: 'check', exitCode: 0, stdout: '' }] })
  const prose = () => ({ results: [{ command: 'check', exitCode: 0, stdout: 'No existing test file was modified.' }] })
  const failed = ({ prompt }) => ({ results: [{ command: 'check', exitCode: 128, stdout: summary(0, idIn(prompt)) }] })
  for (const testedits of [() => null, () => { throw new Error('retry cap') }, empty, prose, dropped, failed]) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits } })
    assert.deepEqual(labels.slice(8), ['testedits:wave1', 'restore:wave1', 'gate'], 'no regression gate is asked and no commit is made')
    assert.deepEqual(result.fix.fixed, [])
    assert.deepEqual(result.fix.commits, [])
    assert.deepEqual(result.fix.unfixed.map(b => b.reason), Array(2).fill(H.TEST_CHECK_UNREPORTED))
    assert.equal(result.fix.halted, undefined, 'the wave is lost; the fix phase is not')
  }
})

test('an existing test changed by a fixer that did not declare it is put back alone, and the gate judges the fixes', async () => {
  const { result, labels, calls } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...SOURCES, '2\t2\ttests/test_utils.py') } })
  const restore = calls.find(c => c.label === 'restore:wave1')
  assert.ok(restore.prompt.includes(`-- 'tests/test_utils.py' `) && !restore.prompt.includes('alpha') && !restore.prompt.includes('bravo'), 'only the test file goes back')
  assert.deepEqual(labels.slice(8), ['testedits:wave1', 'restore:wave1', 'regress:wave1', 'commit:wave', 'gate'], 'then the regression gate runs against the original test')
  assert.deepEqual(names(result.fix.fixed), ['b1', 'b2'])
  assert.deepEqual(result.fix.existingTestEdits, [{ wave: 1, bugs: [], files: [{ path: 'tests/test_utils.py', removed: 2 }] }])
})

test('a file a fixer named as its test is a test, whatever it is called', async () => {
  const fix = ({ label, prompt }) => {
    if (label !== 'fix:alpha.py') return undefined
    return { filesTouched: ['src/alpha.py', 'checks/alpha_cases.py'], fixes: [{ bugId: 'b1', testFile: 'checks/alpha_cases.py', testCommand: 'pytest checks/alpha_cases.py::case_b1', redObserved: true, greenObserved: true }] }
  }
  const { result } = await fixRun(SRC, { bugs: TWO, on: { fix, testedits: printed(...SOURCES, '1\t1\tchecks/alpha_cases.py') } })
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', 'fix needs an existing test changed: checks/alpha_cases.py']])
  assert.deepEqual(names(result.fix.fixed), ['b2'])
})

test('a wave whose fixes were all refused does not send the bugs it never tried to the coupled fallback', async () => {
  const five = [...Array(5)].map((_, i) => bug(`b${i + 1}`, 'src/alpha.py')) // wave 1 takes four
  const firstWaveOnly = ({ label, nth, prompt }) => (label === 'testedits:wave1' && nth === 1 ? printed('3\t2\tsrc/alpha.py', '1\t1\ttests/test_alpha.py')({ prompt }) : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: five, on: { testedits: firstWaveOnly } })
  assert.ok(labels.includes('snapshot:wave2') && !labels.includes('fix:coupled'), 'b5 gets its own wave')
  assert.equal(labels.includes('regress:wave1'), false, 'with nothing of wave 1 left in the tree there is nothing for the gate to judge')
  assert.deepEqual(names(result.fix.fixed), ['b5'])
  assert.deepEqual(result.fix.unfixed.map(b => b.reason), Array(4).fill('fix needs an existing test changed: tests/test_alpha.py'))
  assert.deepEqual(result.fix.existingTestEdits.map(t => t.bugs), [['b1', 'b2', 'b3', 'b4']])
})

test('a refused fixer is answered once, even when the rest of its wave is then lost', async () => {
  const regress = ({ label }) => (label === 'regress:wave1' ? null : undefined) // the regression gate goes silent
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...SOURCES, '1\t1\ttests/test_alpha.py'), regress } })
  assert.deepEqual(labels.slice(8), ['testedits:wave1', 'restore:wave1', 'regress:wave1', 'restore:wave1', 'gate'])
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [
    ['b1', 'fix needs an existing test changed: tests/test_alpha.py'],
    ['b2', 'regression gate did not report'],
  ])
  assert.deepEqual(result.fix.commits, [])
})

test('if the refused fixer cannot be confirmed put back, the fix phase stops', async () => {
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...SOURCES, '1\t1\ttests/test_alpha.py'), restore: () => null } })
  assert.deepEqual(labels.slice(8), ['testedits:wave1', 'restore:wave1', 'gate'])
  assert.equal(result.fix.halted, 'the restore after wave 1 was not confirmed')
  assert.deepEqual(result.fix.commits, [])
  assert.deepEqual(result.fix.fixed, [])
})

test('the coupled attempt may not rewrite an existing test either', async () => {
  const stuck = [bug('b1', 'src/alpha.py')]
  const perBugRed = ({ label, nth }) => (label === 'gate:alpha.py' && nth === 1 ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const coupledOnly = answer => ({ label, prompt }) => (label === 'testedits:coupled' ? answer({ prompt }) : undefined)
  const edited = await fixRun(SRC, { bugs: stuck, on: { gate: perBugRed, testedits: coupledOnly(printed('3\t2\tsrc/alpha.py', '1\t1\ttests/test_alpha.py')) } })
  assert.deepEqual(edited.labels.slice(-4), ['gate:alpha.py', 'testedits:coupled', 'restore:coupled', 'gate'], 'no regression gate, no commit')
  assert.deepEqual(edited.result.fix.unfixed.map(b => b.reason), ['fix needs an existing test changed: tests/test_alpha.py'])
  assert.deepEqual(edited.result.fix.existingTestEdits, [{ wave: 'coupled', bugs: ['b1'], files: [{ path: 'tests/test_alpha.py', removed: 1 }] }])

  const silent = await fixRun(SRC, { bugs: stuck, on: { gate: perBugRed, testedits: coupledOnly(() => null) } })
  assert.deepEqual(silent.result.fix.unfixed.map(b => b.reason), [H.TEST_CHECK_UNREPORTED])
  assert.deepEqual(silent.result.fix.commits, [])
})

// ---- a retry keeps its reason ---------------------------------------------------------

const EXISTING = { id: 'tests/test_alpha.py::test_existing', output: 'AssertionError: 1 != 2' }
const BASE_CMD = 'pytest tests/test_alpha.py tests/test_bravo.py'
const failing = (...f) => ({ runs: [{ command: BASE_CMD, exitCode: f.length ? 1 : 0, failing: f }] })
const script = (...answers) => {
  let i = 0
  return () => answers[i++] ?? failing()
}
const blame = () => ({ causes: [{ test: EXISTING.id, bugIds: ['b1'] }] })

test('a fix taken back for breaking a test, and not closed on its retry, is unfixed because of that test', async () => {
  const retries = {
    'reports no RED': ({ label, nth }) => (label === 'fix:alpha.py' && nth === 2 ? { filesTouched: [], fixes: [{ bugId: 'b1', redObserved: false, greenObserved: false }] } : undefined),
    'dies': ({ label, nth }) => (label === 'fix:alpha.py' && nth === 2 ? null : undefined),
  }
  for (const [how, fix] of Object.entries(retries)) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { regress: script(failing(), failing(EXISTING)), blame, fix } })
    assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', `fix breaks existing test ${EXISTING.id}`]], `retry ${how}`)
    assert.equal(labels.includes('fix:coupled'), false, 'and its one retry is the last')
    assert.deepEqual(names(result.fix.fixed), ['b2'])
  }
})

test('a retry whose own gate fails ends with the same reason', async () => {
  const gate = ({ label, nth }) => (label === 'gate:alpha.py' && nth === 2 ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const { result } = await fixRun(SRC, { bugs: TWO, on: { regress: script(failing(), failing(EXISTING)), blame, gate } })
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', `fix breaks existing test ${EXISTING.id}`]])
})

test('a bug that was never taken back still says RED was not observed', async () => {
  const fix = ({ label }) => (label === 'fix:alpha.py' ? { filesTouched: [], fixes: [{ bugId: 'b1', redObserved: false, greenObserved: false }] } : undefined)
  const { result } = await fixRun(SRC, { bugs: TWO, on: { fix } })
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', 'RED not observed — not reproduced; source left untouched']])
})
