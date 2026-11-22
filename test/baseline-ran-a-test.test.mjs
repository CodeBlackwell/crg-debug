// A baseline no test stands behind is asked for once more (FIX-03), driven through the
// repo's own fix-run stand-in.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = fs.readFileSync(new URL('../workflows/crg-debug.js', import.meta.url), 'utf8')
const gateTest = fs.readFileSync(new URL('./fix-regression-gate.test.mjs', import.meta.url), 'utf8')
const harness = gateTest.slice(gateTest.indexOf('// >>> fix-harness'), gateTest.indexOf('// <<< fix-harness'))
const { fixRun, bug } = new Function('SRC', `${harness}\nreturn { fixRun, bug }`)(SRC)
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const { baselineRanATest } = new Function(`${block}\nreturn { baselineRanATest }`)()

const row = (command, exitCode, passed, failing = []) => ({ command, exitCode, passed, failing: failing.map(id => ({ id })) })
const WORKING = 'cd /arrow && python -m pytest -o addopts="" tests/test_factory.py'
const MADE_UP = { runs: [row('cd /arrow && python -m pytest tox.ini-default-addopts-failed-placeholder', 0, 0)] }
const REAL = { runs: [row('cd /arrow && python -m pytest tests/test_factory.py', 4, -1), row(WORKING, 1, 47, ['tests/test_factory.py::TestGet::test_one_arg_dateparser_datetime'])] }
const ONE = [bug('b0', 'arrow/factory.py')]
// A regress stand-in that answers each label from a table, and a clean re-run otherwise.
const byLabel = table => ({ label }) => table[label] || { runs: [row('c1', 1, 47, ['tests/test_factory.py::TestGet::test_one_arg_dateparser_datetime'])] }

test('which baselines show that a test ran', () => {
  assert.equal(baselineRanATest(MADE_UP), false, 'exit 0, 0 passed, nothing failing')
  assert.equal(baselineRanATest(REAL), true)
  assert.equal(baselineRanATest({ runs: [row('pytest', 4, -1)] }), false, 'a rejected command')
  assert.equal(baselineRanATest({ runs: [row('python -m unittest', 0, -1)] }), false, 'a runner that prints no count')
  assert.equal(baselineRanATest({ runs: [row('pytest t', 1, 0, ['t::a'])] }), true, 'a failing test named')
  assert.equal(baselineRanATest({ runs: [null, row('pytest t', 0, 3)] }), true)
  assert.equal(baselineRanATest(null), false)
})

test('the made-up baseline of 078 is asked for again, and the run keeps its fix', async () => {
  const { result, labels, logs } = await fixRun(SRC, { bugs: ONE, on: { regress: byLabel({ 'regress:baseline': MADE_UP, 'regress:baseline:again': REAL }) } })
  assert.deepEqual(labels.filter(l => l.startsWith('regress:baseline')), ['regress:baseline', 'regress:baseline:again'])
  assert.ok(logs.includes('Fix: regression baseline showed no test run in its 1 command(s) — asked once more, and the second one ran tests'))
  assert.ok(logs.includes('Fix: regression baseline — 1 command(s), 1 test(s) already failing, 1 command(s) that ran no test left out'))
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b0'])
  assert.equal(result.fix.regressionGate.takenBack, 0)
})

test('without the second baseline the same run loses its fix, as 078 did', async () => {
  const dead = { runs: [row('c1', 4, -1)] }
  const { result } = await fixRun(SRC, { bugs: ONE, on: { regress: ({ label }) => (label.startsWith('regress:baseline') ? MADE_UP : dead) } })
  assert.deepEqual(result.fix.fixed, [], 'two made-up baselines in a row are still believed: the limit of this change')
})

test('a baseline that ran tests is asked for once, as before', async () => {
  const { labels, logs } = await fixRun(SRC, { bugs: ONE, on: { regress: byLabel({ 'regress:baseline': REAL }) } })
  assert.deepEqual(labels.filter(l => l.startsWith('regress:baseline')), ['regress:baseline'])
  assert.equal(logs.some(l => /asked once more/.test(l)), false)
})

test('a second baseline that does not report leaves the first standing', async () => {
  const { labels, logs } = await fixRun(SRC, { bugs: ONE, on: { regress: ({ label }) => (label === 'regress:baseline:again' ? null : label === 'regress:baseline' ? MADE_UP : { runs: [row('c1', 4, -1)] }) } })
  assert.ok(labels.includes('regress:baseline:again'))
  assert.ok(logs.some(l => /the second did not report, so the first stands$/.test(l)))
})

test('a repo whose runner prints no count pays one more agent and goes on', async () => {
  const quiet = { runs: [row('python -m unittest discover', 0, -1)] }
  const { result, labels, logs } = await fixRun(SRC, { bugs: ONE, on: { regress: ({ label }) => (label.startsWith('regress:baseline') ? quiet : { runs: [row('c1', 0, -1)] }) } })
  assert.deepEqual(labels.filter(l => l.startsWith('regress:baseline')), ['regress:baseline', 'regress:baseline:again'])
  assert.ok(logs.some(l => /the second one ran none either$/.test(l)))
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b0'])
})
