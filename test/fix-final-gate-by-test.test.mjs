// Protects what the final gate says about the tests when one of them was failing before any
// fix: the verdict comes from the tests by name and from the passed count the runner printed,
// not from the command's exit code — so an old failure neither hides a new one nor leaves the
// whole run "not checked", and it is named every time rather than folded into a plain green.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { passedById, alreadyFailingOf, finalGateVerdict, REGRESSION_SCHEMA }`)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const BASE_CMD = 'pytest tests/test_alpha.py tests/test_bravo.py'
const OLD = { id: 'tests/test_factory.py::TestGet::test_one_arg_dateparser_datetime', output: 're.error: bad escape \\d' }
const NEW = { id: 'tests/test_alpha.py::test_existing', output: 'AssertionError: 1 != 2' }

// ---- the script's own judgment -----------------------------------------------------

const suite = (before, after, exitCode = 1) => [{ name: 'tests', exitCode, before, after }]
const judged = (before, after, newFailing = []) => H.finalGateVerdict([], new Map(), new Map(), newFailing, suite(before, after))

test('the passed count is read per baseline command, and a doubt is no count', () => {
  const relay = rows => ({ runs: rows.map(([command, passed]) => ({ command, exitCode: 0, passed, failing: [] })) })
  assert.deepEqual([...H.passedById(relay([['pytest a', 412], ['npm test', -1], ['something else', 9]]), ['pytest a', 'npm test'])], [['c1', 412], ['c2', -1]], 'the agent\'s word that the runner printed none is kept as it is')
  assert.deepEqual([...H.passedById(relay([['pytest a', undefined], ['npm test', '97']]), ['pytest a', 'npm test'])], [], 'a row without a number is no count')
  assert.deepEqual([...H.passedById(relay([['pytest a', 412], ['pytest a', 400]]), ['pytest a'])], [], 'two rows that disagree: the script does not pick one')
  assert.deepEqual([...H.passedById(relay([['pytest a', 412], ['pytest a', 412]]), ['pytest a'])], [['c1', 412]])
  assert.deepEqual([...H.passedById(null, ['pytest a'])], [])
})

test('the tests failing before the first fix are listed with the command that showed them', () => {
  const baseline = { runs: [
    { command: 'pytest a', exitCode: 1, passed: 412, failing: [OLD, OLD] },
    { command: 'pytest b', exitCode: 2, passed: -1, failing: [] },
    { command: 'pytest c', exitCode: 0, passed: 9, failing: [] },
  ] }
  assert.deepEqual(H.alreadyFailingOf(baseline), [
    { id: OLD.id, command: 'pytest a' },
    { id: 'pytest b (exit 2, no failing test named)', command: 'pytest b' },
  ])
  assert.deepEqual(H.alreadyFailingOf(null), [])
})

test('one test failing before and the same one after, with the passed count steady, is green', () => {
  const v = judged(1423, 1423)
  assert.equal(v.verdict, 'green', 'the command exits red both times, and that is not its verdict')
  assert.deepEqual(v.held, ['tests'])
  assert.deepEqual(v.notChecked, [])
  assert.equal(judged(1423, 1431).verdict, 'green', 'fixes add tests: more passing is not a doubt')
})

test('a second test failing after is red', () => {
  const v = judged(1423, 1423, [NEW.id])
  assert.equal(v.verdict, 'red')
  assert.deepEqual(v.newFailures, [NEW.id])
  assert.equal(judged(-1, -1, [NEW.id]).verdict, 'red', 'and it is red with no passed count at all: a new failure needs no count')
})

test('a passed count that drops is red', () => {
  const v = judged(1423, 1422)
  assert.equal(v.verdict, 'red')
  assert.deepEqual(v.fewerPassed, [{ name: 'tests', before: 1423, after: 1422 }])
  assert.deepEqual(judged(1423, 0).fewerPassed, [{ name: 'tests', before: 1423, after: 0 }])
  assert.equal(judged(1423, -1).verdict, 'red', 'a runner that printed a count before and none now did not run the suite the same way')
})

test('no passed count is not green', () => {
  for (const before of [undefined, -1, 0]) {
    const v = judged(before, 1423)
    assert.equal(v.verdict, 'not checked', `before = ${before}`)
    assert.deepEqual(v.notChecked, [{ name: 'tests', exitCode: 1 }], 'named, with the exit code it had')
    assert.deepEqual(v.held, [])
  }
  const silent = judged(1423, undefined)
  assert.equal(silent.verdict, 'not checked', 'counted before, no count relayed after: nothing was compared')
  assert.deepEqual(silent.unreported, ['tests'])
})

test('every test relay is asked for the passed count, and cannot leave it out', async () => {
  assert.deepEqual(H.REGRESSION_SCHEMA.properties.runs.items.required, ['command', 'exitCode', 'passed', 'failing'])
  assert.equal(H.REGRESSION_SCHEMA.properties.runs.items.properties.passed.type, 'integer')
  const { calls } = await fixRun(SRC, { bugs: [bug('b1', 'src/alpha.py')] })
  const briefs = calls.filter(c => c.label.startsWith('regress:'))
  assert.deepEqual(briefs.map(c => c.label), ['regress:baseline', 'regress:wave1', 'regress:allfixes'])
  for (const brief of briefs) {
    assert.match(brief.prompt, /passed = the number of tests the runner's own summary says passed/)
    assert.match(brief.prompt, /do not count tests yourself/)
    assert.match(brief.prompt, /printed no such number, or more than one summary for the command, passed = -1/)
  }
})

// ---- stubbed fix runs --------------------------------------------------------------

const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const untyped = () => ({ confirmedBugs: TWO, deferred: [], rejected: [], toolchain: [{ package: 'app', test: 'pytest', typecheck: 'mypy src' }], baselineFailures: [] })
const missingChecker = ({ label }) => ({ results: label === 'checks:baseline' ? [{ command: 'k1', exitCode: 127 }] : [] })
// One row for the baseline command: the baseline names it in full, a re-run by its id.
const row = (label, passed, ...failing) => ({ runs: [{ command: label === 'regress:baseline' ? BASE_CMD : 'c1', exitCode: failing.length ? 1 : 0, passed, failing }] })

test('a suite with one test already failing ends green, and names that test', async () => {
  // The live case: a third-party error fails one test before any fix, and nothing new fails.
  const regress = ({ label }) => row(label, 1423, OLD)
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': untyped, checks: missingChecker, regress } })
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1', 'b2'])
  assert.deepEqual(result.fix.finalGate, {
    clean: true, verdict: 'green', regressed: [], newFailures: [], openBugTests: [], noBefore: [], fewerPassed: [],
    notChecked: [{ name: 'typecheck', exitCode: 127 }], unreported: [], held: ['tests'],
    alreadyFailing: [{ id: OLD.id, command: BASE_CMD }],
    passedCounts: [{ name: 'tests', before: 1423, after: 1423 }],
    results: [],
  })
  assert.match(logs.at(-1), / · final gate green · 1 test already failing before the first fix · not checked: typecheck · regression gate: /)
})

test('a new failure beside the old one is red, and the old one is still named', async () => {
  const regress = ({ label }) => (label === 'regress:allfixes' ? row(label, 1422, OLD, NEW) : row(label, 1423, OLD))
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { regress } })
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.equal(result.fix.finalGate.clean, false)
  assert.deepEqual(result.fix.finalGate.newFailures, [NEW.id])
  assert.deepEqual(result.fix.finalGate.alreadyFailing, [{ id: OLD.id, command: BASE_CMD }])
  assert.match(logs.at(-1), / · final gate RED · 1 test already failing before the first fix · regression gate: /)
})

test('a test of a bug left unfixed that still fails at the end is red, and named apart from regressions', async () => {
  // The live case (writeup 024, tree B): two bugs in one file, one closes and its commit takes
  // the shared test file, the other never passes its own gate and its red test stays behind.
  // Since ownTests that file goes back before the commit; the stub's gate still reports the
  // test at the end, which is what is judged here.
  const OPEN = { id: 'tests/test_alpha.py::test_b2', output: 'AssertionError' }
  const gate = ({ prompt }) => (prompt.includes('::test_b2') ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const regress = ({ label }) => (label === 'regress:baseline' ? row(label, 40) : row(label, 41, OPEN))
  const { result, logs } = await fixRun(SRC, { bugs: [bug('b1', 'src/alpha.py'), bug('b2', 'src/alpha.py')], on: { gate, regress } })
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1'])
  assert.deepEqual(result.fix.unfixed.map(b => b.bugId), ['b2'])
  assert.equal(result.fix.finalGate.verdict, 'red', 'the suite fails, so the gate cannot read green')
  assert.deepEqual(result.fix.finalGate.openBugTests, [OPEN.id])
  assert.deepEqual(result.fix.finalGate.newFailures, [], 'it is not a regression, and is not called one')
  assert.ok(logs.includes(`Fix: final gate — 1 test(s) of bugs left unfixed still fail in the tree (${OPEN.id})`))
  assert.match(logs.at(-1), / · final gate RED · /)
})

test('fewer tests passing at the end than before the first fix is red, whatever fails by name', async () => {
  // A test file that no longer collects: nothing new is named, 40 tests are simply gone.
  const regress = ({ label }) => row(label, label === 'regress:allfixes' ? 1383 : 1423, OLD)
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { regress } })
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.deepEqual(result.fix.finalGate.newFailures, [])
  assert.deepEqual(result.fix.finalGate.fewerPassed, [{ name: 'tests', before: 1423, after: 1383 }])
  assert.ok(logs.includes('Fix: final gate — tests: 1423 passed before the first fix, 1383 now'))

  const none = await fixRun(SRC, { bugs: TWO, on: { regress: ({ label }) => row(label, label === 'regress:allfixes' ? -1 : 1423, OLD) } })
  assert.equal(none.result.fix.finalGate.verdict, 'red')
  assert.ok(none.logs.includes('Fix: final gate — tests: the runner printed 1423 passed before the first fix and no count now'))
})

test('a runner that prints no passed count leaves the tests not checked, never green', async () => {
  const regress = ({ label }) => row(label, -1, OLD)
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { regress } })
  assert.equal(result.fix.finalGate.verdict, 'not checked')
  assert.equal(result.fix.finalGate.clean, false)
  assert.deepEqual(result.fix.finalGate.notChecked, [{ name: 'tests', exitCode: 1 }])
  assert.deepEqual(result.fix.finalGate.passedCounts, [{ name: 'tests', before: null, after: null }])
  assert.match(logs.at(-1), / · final gate NOT CHECKED · 1 test already failing before the first fix · not checked: tests · regression gate: /)

  // A relay that leaves the count out altogether is no better.
  const bare = ({ label }) => ({ runs: [{ command: label === 'regress:baseline' ? BASE_CMD : 'c1', exitCode: 0, failing: [] }] })
  const left = await fixRun(SRC, { bugs: TWO, on: { regress: bare } })
  assert.equal(left.result.fix.finalGate.verdict, 'not checked')
})

test('a clean suite with nothing failing before says nothing about old failures', async () => {
  const { result, logs } = await fixRun(SRC, { bugs: TWO })
  assert.equal(result.fix.finalGate.verdict, 'green')
  assert.deepEqual(result.fix.finalGate.alreadyFailing, [])
  assert.equal(logs.at(-1).includes('already failing'), false)
  assert.match(logs.at(-1), / · final gate green · regression gate: /)
})

test('two tests already failing are counted in the plural', async () => {
  const regress = ({ label }) => row(label, 1423, OLD, NEW)
  const { logs } = await fixRun(SRC, { bugs: TWO, on: { regress } })
  assert.match(logs.at(-1), / · final gate green · 2 tests already failing before the first fix · regression gate: /)
})

test('the test of a fix taken back is an open bug\'s test at the end, not a regression', async () => {
  // M6.1: tests of fixes taken back were filed as newly failing, and in the next wave they cost
  // two innocent fixes. A bug the wave does not keep has its test marked red, whatever took it back.
  const OWN = { id: 'tests/test_alpha.py::test_b1', output: 'AssertionError' }
  const regress = ({ label }) => (label === 'regress:baseline' ? row(label, 40) : label === 'regress:wave1' ? row(label, 40, NEW) : row(label, 40, OWN))
  const { result } = await fixRun(SRC, { bugs: TWO, on: { regress, blame: () => null } })
  assert.deepEqual(result.fix.commits, [], 'the whole wave went back')
  assert.deepEqual(result.fix.finalGate.openBugTests, [OWN.id])
  assert.deepEqual(result.fix.finalGate.newFailures, [])
})
