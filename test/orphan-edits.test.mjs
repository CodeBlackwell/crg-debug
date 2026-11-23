// Regression tests from isort in rung 3 (writeup 104). An edit no fix owned reached the final
// tree and broke an existing test, and no wave's check could see it:
//  FIX-07: a fixer whose bugs did not close kept its source edit; only its tests went back.
//  FIX-08: the baseline left a whole test file out with --ignore, so no re-run covered it.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const SRC = fs.readFileSync(new URL('../workflows/crg-debug.js', import.meta.url), 'utf8')
const gateTest = fs.readFileSync(new URL('./fix-regression-gate.test.mjs', import.meta.url), 'utf8')
const harness = gateTest.slice(gateTest.indexOf('// >>> fix-harness'), gateTest.indexOf('// <<< fix-harness'))
const { fixRun, bug } = new Function('SRC', `${harness}\nreturn { fixRun, bug }`)(SRC)
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { unclosedFixerFiles, leftOutTests, waveAllowlist }`)()

const fenced = prompt => [...prompt.matchAll(/<<<UNTRUSTED\n([\s\S]*?)\nUNTRUSTED>>>/g)].map(m => m[1]).join('\n')
const restoredIn = (calls, wave) => calls.filter(c => c.label === `restore:wave${wave}`).map(c => fenced(c.prompt))

// ---- FIX-07 -------------------------------------------------------------------------

// The isort case: the finders fixer reports a test command the container cannot run (exit
// 127), so its bugs do not close; its retry then finds the fix already there and sees no RED.
const ISORT = [bug('b30', 'isort/deprecated/finders.py'), bug('b31', 'isort/deprecated/finders.py'), bug('b1', 'isort/format.py')]
const notFound = ({ prompt }) => (/::test_b3[01]/.test(prompt) ? { results: [{ command: 'poetry run pytest', exitCode: 127, stdout: '', stderr: 'poetry: not found' }] } : undefined)
const fixedAlready = ({ label, nth, prompt }) => {
  if (label !== 'fix:finders.py' || nth < 2) return undefined
  const ids = [...prompt.matchAll(/^bugId: (\S+)$/gm)].map(m => m[1])
  return { filesTouched: [], fixes: ids.map(bugId => ({ bugId, testFile: 'tests/test_finders.py', testCommand: `pytest tests/test_finders.py::test_${bugId}`, redObserved: false, greenObserved: true })) }
}

test('FIX-07: a fixer none of whose bugs closed has its source put back, not only its tests', async () => {
  const { calls, logs } = await fixRun(SRC, { bugs: ISORT, on: { gate: notFound, fix: fixedAlready } })
  const wave1 = restoredIn(calls, 1).join('\n')
  assert.match(wave1, /'isort\/deprecated\/finders\.py'/, 'the unclosed fixer\'s source must go back with its tests')
  assert.match(wave1, /'tests\/test_finders\.py'/, 'its tests still go back')
  assert.doesNotMatch(wave1, /'isort\/format\.py'/, 'a fixer whose bug closed keeps its edit')
  assert.ok(logs.some(l => /none of whose bugs closed: isort\/deprecated\/finders\.py/.test(l)), 'the run says what it put back and why')
})

test('FIX-07: after the put-back, "source left untouched" is true of the tree', async () => {
  // Wave 2 is the retry: it starts from the source as it was, so no wave-1 edit is in it.
  const { result, calls } = await fixRun(SRC, { bugs: ISORT, on: { gate: notFound, fix: fixedAlready } })
  const firstBack = calls.findIndex(c => c.label === 'restore:wave1')
  const retry = calls.findIndex((c, i) => i > firstBack && c.label === 'fix:finders.py')
  assert.ok(firstBack >= 0 && retry > firstBack, 'the put-back comes before the retry')
  const backBeforeRetry = calls.slice(0, retry).filter(c => c.label.startsWith('restore:')).map(c => fenced(c.prompt)).join('\n')
  assert.match(backBeforeRetry, /'isort\/deprecated\/finders\.py'/, 'the retry must not start from the first fixer\'s edit')
  const unfixed = result.fix.unfixed.filter(u => /finders/.test(u.file)).map(u => u.bugId).sort()
  assert.deepEqual(unfixed, ['b30', 'b31'])
})

test('FIX-07: which files go back when a fixer\'s bugs do not close', () => {
  const [b30, b31, b1, b2] = [bug('b30', 'src/finders.py'), bug('b31', 'src/finders.py'), bug('b1', 'src/alpha.py'), bug('b2', 'src/alpha.py')]
  const fixById = new Map([['b30', { testFile: 'tests/test_b30.py' }], ['b31', { testFile: 'tests/test_b31.py' }], ['b1', { testFile: 'tests/test_b1.py' }], ['b2', { testFile: 'tests/test_b2.py' }]])
  const support = new Map([['b30', ['src/util.py', 'src/shared.py']], ['b1', ['src/shared.py']]])
  const filesOf = bugs => H.waveAllowlist(bugs, fixById, support, '/r')
  const groups = [['src/finders.py', [b30, b31]], ['src/alpha.py', [b1, b2]]]
  const tests = ['tests/test_b30.py', 'tests/test_b31.py', 'tests/test_b2.py']
  assert.deepEqual(H.unclosedFixerFiles(groups, [b1], filesOf, tests), ['src/finders.py', 'src/util.py'],
    'source and declared support of the fixer that closed nothing; not a file a closed fix kept, not a test already back')
  assert.deepEqual(H.unclosedFixerFiles(groups, [b1, b30], filesOf, []), [], 'a fixer with one bug closed keeps its file: it is committed with that bug')
  assert.deepEqual(H.unclosedFixerFiles(groups, [], filesOf, []).sort(), ['src/alpha.py', 'src/finders.py', 'src/shared.py', 'src/util.py', ...['tests/test_b1.py', 'tests/test_b2.py', 'tests/test_b30.py', 'tests/test_b31.py']].sort())
  assert.deepEqual(H.unclosedFixerFiles([], [], filesOf, []), [])
})

// ---- FIX-08 -------------------------------------------------------------------------

test('FIX-08: which test paths a baseline command leaves out', () => {
  assert.deepEqual(H.leftOutTests(['cd /isort && pytest tests/unit/ --ignore=tests/unit/test_deprecated_finders.py --continue-on-collection-errors']), ['tests/unit/test_deprecated_finders.py'])
  assert.deepEqual(H.leftOutTests(['pytest tests --ignore tests/a.py --ignore-glob="tests/b_*.py" --deselect tests/c.py']), ['tests/a.py', 'tests/b_*.py', 'tests/c.py'])
  assert.deepEqual(H.leftOutTests(["pytest tests --deselect 'tests/a.py::test_old'"]), [], 'deselecting one test by id is the asked-for way')
  assert.deepEqual(H.leftOutTests(['pytest tests/a.py', 'pytest tests/a.py --ignore=tests/x.py', 'pytest --ignore=tests/x.py']), ['tests/x.py'], 'each path once')
  assert.deepEqual(H.leftOutTests([]), [])
  assert.deepEqual(H.leftOutTests(null), [])
})

const row = (command, exitCode, passed, failing = []) => ({ command, exitCode, passed, failing: failing.map(id => ({ id })) })
const LEFT_OUT = 'cd /isort && pytest tests/unit/ --ignore=tests/unit/test_deprecated_finders.py'
const WHOLE = 'cd /isort && pytest tests/unit/'
const OLD = 'tests/unit/test_deprecated_finders.py::TestRequirementsFinder::test_requirements_dir'
const ONE = [bug('b1', 'isort/format.py')]
const byLabel = table => ({ label }) => table[label] || { runs: [row('c1', 1, 40, [OLD])] }

test('FIX-08: the baseline brief keeps every test file in the command', async () => {
  const { calls } = await fixRun(SRC, { bugs: ONE })
  const brief = calls.find(c => c.label === 'regress:baseline').prompt
  assert.match(brief, /Leave no test file or directory out of a command/)
})

test('FIX-08: a baseline that leaves a test file out is asked once more, and a whole one replaces it', async () => {
  const { calls, logs, result } = await fixRun(SRC, {
    bugs: ONE,
    on: { regress: byLabel({ 'regress:baseline': { runs: [row(LEFT_OUT, 0, 40)] }, 'regress:baseline:whole': { runs: [row(WHOLE, 1, 41, [OLD])] } }) },
  })
  const again = calls.find(c => c.label === 'regress:baseline:whole')
  assert.ok(again, 'asked once more')
  assert.match(fenced(again.prompt), /tests\/unit\/test_deprecated_finders\.py/, 'the left-out file is named, fenced')
  const rerun = calls.find(c => c.label === 'regress:wave1')
  assert.ok(rerun.prompt.includes(WHOLE) && !rerun.prompt.includes('--ignore'), 'every wave re-runs the whole command')
  assert.deepEqual(result.fix.regressionGate.leftOut, [])
  assert.ok(logs.some(l => /left out 1 test path/.test(l)))
})

test('FIX-08: a second baseline that still leaves the file out stands, and the blind spot is reported', async () => {
  const { calls, result } = await fixRun(SRC, {
    bugs: ONE,
    on: { regress: byLabel({ 'regress:baseline': { runs: [row(LEFT_OUT, 0, 40)] }, 'regress:baseline:whole': { runs: [row(LEFT_OUT, 0, 40)] } }) },
  })
  assert.equal(calls.filter(c => c.label === 'regress:baseline:whole').length, 1, 'asked once, not again and again')
  assert.deepEqual(result.fix.regressionGate.leftOut, ['tests/unit/test_deprecated_finders.py'])
})

test('FIX-08: a baseline that leaves nothing out is not asked again', async () => {
  const { labels, result } = await fixRun(SRC, { bugs: ONE })
  assert.equal(labels.includes('regress:baseline:whole'), false)
  assert.deepEqual(result.fix.regressionGate.leftOut, [])
})
