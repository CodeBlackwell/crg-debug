// A machine fault stops the run plainly or gets the right verdict: git refusing the
// repository, a gate whose runner ran no test, a ledger command whose node failed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../workflows/crg-debug.js', import.meta.url), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { treeStatusOf, treeRefusal, gitRefusalOf, allGreen, gateGreen, reportsZeroTests, ledgerExitNote }`)()
const HARNESS = readFileSync(new URL('./fix-regression-gate.test.mjs', import.meta.url), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const relay = (stdout, exitCode = 0, stderr) => ({ results: [{ command: 'status', exitCode, stdout, ...(stderr === undefined ? {} : { stderr }) }] })
const DUBIOUS = "crg-git-refused git version 2.39.5: fatal: detected dubious ownership in repository at '/arrow'"
const verdict = r => H.gitRefusalOf(r) || H.treeRefusal(H.treeStatusOf(r))

test('git refusal: the printed line is the reason, whatever exit the agent wrote', () => {
  assert.equal(H.gitRefusalOf(relay(DUBIOUS, 1)), "git does not work in the repository for this run's user (git version 2.39.5: fatal: detected dubious ownership in repository at '/arrow')")
  assert.equal(H.gitRefusalOf(relay(`  ${DUBIOUS}  `, 0)), H.gitRefusalOf(relay(DUBIOUS, 1)), 'a line the agent indented or misreported as exit 0 still refuses')
  assert.match(H.gitRefusalOf(relay('crg-git-refused git version 2.11.0: --absolute-git-dir', 1)), /2\.11\.0: --absolute-git-dir\)$/)
  assert.match(H.gitRefusalOf(relay('crg-git-refused sh: 1: git: not found: sh: 1: git: not found', 1)), /git: not found/)
  assert.equal(H.treeStatusOf(relay(DUBIOUS, 1)), null, 'the refusal is never read as a tree')
})

test('no refusal line: the tree verdict is exactly what it was', () => {
  assert.equal(H.gitRefusalOf(null), '')
  assert.equal(H.gitRefusalOf({ results: [] }), '')
  assert.equal(H.gitRefusalOf(relay('\ncrg-tree-status 0\n')), '')
  assert.equal(verdict(relay('\ncrg-tree-status 0\n')), '', 'clean')
  assert.match(verdict(relay('staged a.py\ncrg-tree-status 1\n')), /1 staged/)
  assert.equal(verdict(null), 'the working tree could not be checked for uncommitted changes')
  assert.equal(verdict(relay('crg-tree-status 0', 1)), 'the working tree could not be checked for uncommitted changes')
  assert.equal(H.gitRefusalOf(relay('a file named crg-git-refused.txt\ncrg-tree-status 0')), '', 'only a line that begins with the word')
})

const UNITTEST_39 = 'test_x (tests.test_crg_b1.T) ... ok\n\n----------------------------------------------------------------------\nRan 0 tests in 0.000s\n\nOK\nexit=0'
test('a gate that exited 0 but ran no test is not green', () => {
  assert.equal(H.gateGreen(relay(UNITTEST_39)), false, 'unittest on Python 3.11 and older')
  assert.equal(H.gateGreen(relay('', 0, 'Ran 0 tests in 0.000s\n\nOK')), false, 'the summary relayed as stderr')
  assert.equal(H.gateGreen(relay('Ran 0 tests in 0.001s\n\nNO TESTS RAN', 5)), false, 'Python 3.12 exits 5: red already')
  assert.equal(H.gateGreen({ results: [{ command: 'a', exitCode: 0, stdout: '1 passed in 0.02s' }, { command: 'b', exitCode: 0, stdout: 'Ran 0 tests in 0.000s\nOK' }] }), false, 'any row')
})

test('a gate that ran a test is green exactly as before', () => {
  for (const out of ['1 passed in 0.12s', '===== 1 passed, 2 warnings in 0.31s =====', 'Ran 1 test in 0.001s\n\nOK', 'Ran 10 tests in 0.2s\n\nOK', 'Ran 100 tests in 3s\nOK', '', undefined]) {
    assert.equal(H.gateGreen(relay(out)), H.allGreen(relay(out)), JSON.stringify(out))
    assert.equal(H.gateGreen(relay(out)), true)
  }
  assert.equal(H.gateGreen(relay('1 failed', 1)), false)
  assert.equal(H.gateGreen(null), false)
  assert.equal(H.gateGreen({ results: [] }), false)
  assert.equal(H.reportsZeroTests(null), false)
  assert.equal(H.gateGreen(relay('    print("Ran 0 tests in a loop")\n1 passed')), true, 'the words inside a line of code are not a summary')
})

test('a ledger read that did not report names its exit, and 127 as node', () => {
  assert.equal(H.ledgerExitNote(relay('bash: line 1: node: command not found', 127)), " (exit 127: node is not on the PATH of the agents' shell)")
  assert.equal(H.ledgerExitNote(relay('', 1)), ' (exit 1)')
  assert.equal(H.ledgerExitNote(relay('', 1, 'TypeError: R.flatMap is not a function\n    at [eval]:1:751')), ' (exit 1: TypeError: R.flatMap is not a function)', 'HAR-07, as wfl-arrow-py-SR1.1 relayed it')
  assert.equal(H.ledgerExitNote(relay('[eval]:1', 1, '[eval]:1\nconst {a,...b} = x\n         ^^^\n\nSyntaxError: Unexpected token ...')), ' (exit 1: SyntaxError: Unexpected token ...)')
  assert.equal(H.ledgerExitNote(relay('crg-ledger-rows 1 0 0 0')), '')
  assert.equal(H.ledgerExitNote(null), '')
  assert.equal(H.ledgerExitNote({ confirmedBugs: [] }), '', 'a hollow answer has no exit code')
})

// ---- the script, run whole over the repo's own stub ---------------------------------------
const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]

test('git refusing: Fix does not start, the log names git and says nothing of stashing', async () => {
  const { result, labels, logs } = await fixRun(SRC, { bugs: TWO, on: { 'tree-status': () => relay(DUBIOUS, 1) } })
  assert.deepEqual(labels, ['tree-status', 'ingest-ledger'], 'no branch, no fixer, no commit')
  assert.match(result.fix.notStarted, /^git does not work in the repository for this run's user \(git version 2\.39\.5: fatal: detected dubious ownership/)
  assert.equal(result.fix.tree, null)
  const line = logs.find(l => l.startsWith('Fix will NOT start'))
  assert.equal(line, `Fix will NOT start: ${result.fix.notStarted}. Nothing in the tree, the index or any branch is changed by the fix phase.`)
})

test('a dirty tree logs exactly what it logged before', async () => {
  const { logs } = await fixRun(SRC, { bugs: TWO, on: { 'tree-status': () => relay('staged src/alpha.py\nchanged README.md\ncrg-tree-status 2\n') } })
  assert.ok(logs.includes('Fix will NOT start: the working tree had uncommitted changes in tracked files before the run (1 staged, 1 modified or deleted) — src/alpha.py, README.md. Commit or stash them and run again. Nothing in the tree, the index or any branch is changed by the fix phase.'))
})

test('a per-bug gate that ran no test does not close its bug; the other closes as before', async () => {
  const gate = ({ prompt }) => (prompt.includes('test_b1') ? relay(UNITTEST_39) : undefined)
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { gate } })
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b2'])
  assert.ok(result.fix.unfixed.some(b => b.bugId === 'b1'))
  assert.ok(logs.some(l => /^Fix wave 1: 1 gate\(s\) exited 0 but the runner said it ran 0 tests, so b1 did not close$/.test(l)), logs.join('\n'))
  const clean = await fixRun(SRC, { bugs: TWO })
  assert.deepEqual(clean.result.fix.fixed.map(b => b.bugId).sort(), ['b1', 'b2'])
  assert.equal(clean.logs.some(l => l.includes('ran 0 tests')), false)
})
