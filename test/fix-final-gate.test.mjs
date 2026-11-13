// Protects what "final gate green" tells the user: that nothing which passed before the
// fixes fails after them — not that every tool happened to be installed. A check that was
// already red before the first fix is named as not checked, and a gate where nothing ran
// green is never called green.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { fence, finalChecks, exitCodesById, runCodesById, finalGateVerdict, GATE_SCHEMA }`)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

// ---- the script's own judgment -----------------------------------------------------

const CHECKS = [{ id: 'k1', name: 'typecheck' }, { id: 'k2', name: 'build' }, { id: 'c1', name: 'tests' }]
const codes = pairs => new Map(Object.entries(pairs))
const verdict = (before, after, newFailing = []) => H.finalGateVerdict(CHECKS, codes(before), codes(after), newFailing)

test('the checks are the toolchain\'s typecheck and build commands, each under its own short id', () => {
  assert.deepEqual(H.finalChecks([{ package: 'app', typecheck: 'mypy src', build: ' python -m build ', test: 'pytest' }]), [
    { id: 'k1', name: 'typecheck', command: 'mypy src' },
    { id: 'k2', name: 'build', command: 'python -m build' },
  ])
  assert.deepEqual(H.finalChecks([{ package: 'app', typecheck: '-', build: '', test: 'pytest' }, null, { package: 'scaffolded', test: 'vitest run' }]), [], 'a step the project does not have is not a check')
  assert.deepEqual(H.finalChecks([{ package: 'web', typecheck: 'tsc -p web' }, { package: 'api', typecheck: 'tsc -p api', build: 'npm run build' }, { package: 'dup', typecheck: 'tsc -p web' }]).map(c => [c.id, c.name]), [
    ['k1', 'typecheck:web'], ['k2', 'typecheck:api'], ['k3', 'build'],
  ], 'several of a kind are told apart by package, and one command is run once')
  assert.deepEqual(H.finalChecks(undefined), [])
})

test('a check\'s exit code is read by its id, and a doubt is resolved toward red', () => {
  const checks = [{ id: 'k1', name: 'typecheck', command: 'mypy src' }, { id: 'k2', name: 'build', command: 'npm run build' }]
  const relay = rows => ({ results: rows.map(([command, exitCode]) => ({ command, exitCode })) })
  assert.deepEqual([...H.exitCodesById(relay([['k1', 127], ['K2: npm run build', 0]]), checks)], [['k1', 127], ['k2', 0]])
  assert.deepEqual([...H.exitCodesById(relay([['mypy  src', 1]]), checks)], [['k1', 1]], 'an echoed command still finds its check')
  assert.deepEqual([...H.exitCodesById(relay([['k1', 0], ['k1', 2]]), checks)], [['k1', 2]], 'reported twice, the red one stands')
  assert.deepEqual([...H.exitCodesById(relay([['k1', 2], ['k1', 0]]), checks)], [['k1', 2]])
  assert.deepEqual([...H.exitCodesById(relay([['k9', 0], ['the type checker', 0], ['k2', undefined]]), checks)], [], 'an unknown id, a label and a missing code are no answer')
  assert.deepEqual([...H.exitCodesById(null, checks)], [])
  const runs = { runs: [{ command: 'pytest tests', exitCode: 1 }, { command: 'npm test', exitCode: 0 }, { command: 'something else', exitCode: 0 }] }
  assert.deepEqual([...H.runCodesById(runs, ['pytest tests', 'npm test'])], [['c1', 1], ['c2', 0]])
  assert.deepEqual([...H.runCodesById(null, ['pytest tests'])], [])
})

test('a type checker that is missing before and after does not make the gate red', () => {
  const v = verdict({ k1: 127, k2: 0, c1: 0 }, { k2: 0, c1: 0 })
  assert.equal(v.verdict, 'green')
  assert.deepEqual(v.notChecked, [{ name: 'typecheck', exitCode: 127 }], 'named, with its exit code, and counted neither way')
  assert.deepEqual(v.held, ['build', 'tests'])
  assert.deepEqual(v.regressed, [])
})

test('a check that passed before the first fix and fails after it makes the gate red', () => {
  const v = verdict({ k1: 0, k2: 0, c1: 0 }, { k1: 1, k2: 0, c1: 0 })
  assert.equal(v.verdict, 'red')
  assert.deepEqual(v.regressed, [{ name: 'typecheck', before: 0, after: 1 }])
  assert.equal(verdict({ k1: 127, k2: 2, c1: 1 }, { c1: 1 }, ['tests/test_a.py::test_x']).verdict, 'red', 'and so does a test that fails now and did not before')
})

test('a gate where nothing ran green is not green', () => {
  const v = verdict({ k1: 127, k2: 2, c1: 1 }, { c1: 1 })
  assert.equal(v.verdict, 'not checked')
  assert.deepEqual(v.notChecked.map(c => [c.name, c.exitCode]), [['typecheck', 127], ['build', 2], ['tests', 1]])
  assert.equal(H.finalGateVerdict([], new Map(), new Map(), []).verdict, 'not checked', 'no checks at all')
  assert.deepEqual(verdict({}, {}).notChecked, [{ name: 'typecheck', exitCode: null }, { name: 'build', exitCode: null }, { name: 'tests', exitCode: null }], 'a baseline that never reported checks nothing')
})

test('a check that was green before and did not report after keeps the gate from green', () => {
  const v = verdict({ k1: 0, k2: 0, c1: 0 }, { k2: 0, c1: 0 })
  assert.equal(v.verdict, 'not checked')
  assert.deepEqual(v.unreported, ['typecheck'])
  assert.equal(verdict({ k1: 0, k2: 0, c1: 0 }, { k2: 1, c1: 0 }).verdict, 'red', 'a regression is still a regression')
})

// ---- stubbed fix runs --------------------------------------------------------------

const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const BASE_CMD = 'pytest tests/test_alpha.py tests/test_bravo.py'
const EXISTING = { id: 'tests/test_alpha.py::test_existing', output: 'AssertionError: 1 != 2' }
// A ledger whose toolchain has a type checker and a build beside the tests.
const ledger = toolchain => () => ({ confirmedBugs: TWO, deferred: [], rejected: [], toolchain, baselineFailures: [] })
const TYPED = ledger([{ package: 'app', test: 'pytest', typecheck: 'mypy src', build: 'python -m build' }])
// Answer the checks: `baseline` and `final` map id -> exit code.
const checksAt = (baseline, final) => ({ label }) => ({ results: Object.entries(label === 'checks:baseline' ? baseline : final).map(([command, exitCode]) => ({ command, exitCode, stdout: '', stderr: '' })) })

test('a clean run with a type checker that is not installed ends green, and says what was not checked', async () => {
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': TYPED, checks: checksAt({ k1: 127, k2: 0 }, { k2: 0 }) } })
  assert.deepEqual(labels, [
    'tree-status', 'ingest-ledger', 'fix-branch', 'regress:baseline', 'checks:baseline',
    'snapshot:wave1', 'fix:alpha.py', 'fix:bravo.py', 'gate:alpha.py', 'gate:bravo.py', 'testedits:wave1', 'regress:wave1', 'commit:wave',
    'checks:final', 'regress:allfixes',
  ])
  assert.deepEqual(result.fix.finalGate, {
    clean: true, verdict: 'green', regressed: [], newFailures: [],
    notChecked: [{ name: 'typecheck', exitCode: 127 }], unreported: [], held: ['build', 'tests'],
    results: [{ command: 'k2', exitCode: 0, stdout: '', stderr: '' }],
  })
  assert.match(logs.at(-1), / · final gate green · not checked: typecheck · regression gate: /)
  assert.ok(logs.includes('Fix: final-gate baseline — typecheck exit 127 (not checked: it cannot show what a fix breaks), build exit 0'))

  const [before, after] = calls.filter(c => c.label.startsWith('checks:'))
  assert.ok(before.prompt.includes(`k1:\n${H.fence('mypy src')}\nk2:\n${H.fence('python -m build')}`), 'the commands are the toolchain\'s, as data, under short ids')
  assert.match(before.prompt, /BEFORE any fix is applied\. Do NOT edit any file\./)
  assert.match(before.prompt, /A command whose tool is not installed is still run and its exit code reported as it is/)
  assert.match(before.prompt, /command = JUST its id \(k1, k2, …\) — do not copy the command text/)
  assert.deepEqual(before.opts.schema, H.GATE_SCHEMA)
  assert.equal(after.prompt.includes('mypy src'), false, 'a check that was red before is not run again: it has nothing to say')
  assert.ok(after.prompt.includes(`k2:\n${H.fence('python -m build')}`), 'and the one that was green keeps its id')

  const tests = calls.find(c => c.label === 'regress:allfixes')
  assert.ok(tests.prompt.includes(`c1:\n${H.fence(BASE_CMD)}`), 'the tests are the baseline\'s own commands')
  assert.ok(tests.prompt.includes(H.fence('src/alpha.py\ntests/test_alpha.py\nsrc/bravo.py\ntests/test_bravo.py')), 'over every file the fixes touched')
})

test('a type checker that passed before the fixes and fails after them makes the final gate red', async () => {
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': TYPED, checks: checksAt({ k1: 0, k2: 0 }, { k1: 1, k2: 0 }) } })
  assert.equal(result.fix.finalGate.clean, false)
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.deepEqual(result.fix.finalGate.regressed, [{ name: 'typecheck', before: 0, after: 1 }])
  assert.match(logs.at(-1), / · final gate RED · regression gate: /)
  assert.ok(logs.includes('Fix: final gate — typecheck was green before the first fix and now exits 1'))
})

test('a test that fails at the end and did not before the first fix makes the final gate red', async () => {
  const regress = ({ label }) => (label === 'regress:allfixes' ? { runs: [{ command: 'c1', exitCode: 1, failing: [EXISTING] }] } : undefined)
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { regress } })
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.deepEqual(result.fix.finalGate.newFailures, [EXISTING.id])
  assert.ok(logs.some(l => l.includes(`1 test(s) newly failing (${EXISTING.id})`)))
})

test('a final gate where nothing ran green is not called green', async () => {
  // The type checker is missing and the test command was already red before the first fix.
  const red = { runs: [{ command: BASE_CMD, exitCode: 1, failing: [EXISTING] }] }
  const regress = ({ label }) => (label === 'regress:baseline' ? red : { runs: [{ command: 'c1', exitCode: 1, failing: [EXISTING] }] })
  const untyped = ledger([{ package: 'app', test: 'pytest', typecheck: 'mypy src' }])
  const { result, labels, logs } = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': untyped, checks: checksAt({ k1: 127 }, {}), regress } })
  assert.equal(labels.includes('checks:final'), false)
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1', 'b2'], 'the fixes stand: nothing they broke')
  assert.equal(result.fix.finalGate.clean, false)
  assert.equal(result.fix.finalGate.verdict, 'not checked')
  assert.deepEqual(result.fix.finalGate.notChecked, [{ name: 'typecheck', exitCode: 127 }, { name: 'tests', exitCode: 1 }])
  assert.match(logs.at(-1), / · final gate NOT CHECKED · not checked: typecheck, tests · regression gate: /)
  assert.ok(logs.includes('Fix: final gate not checked — no check was green both before the first fix and after the last'))
})

test('a final check that does not report is not a green one', async () => {
  const dead = ({ label }) => (label === 'checks:final' ? null : { results: [{ command: 'k1', exitCode: 0 }, { command: 'k2', exitCode: 0 }] })
  const silent = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': TYPED, checks: dead } })
  assert.equal(silent.result.fix.finalGate.verdict, 'not checked')
  assert.deepEqual(silent.result.fix.finalGate.unreported, ['typecheck', 'build'])
  assert.ok(silent.logs.includes('Fix: final gate not checked — did not report: typecheck, build'))

  const tests = await fixRun(SRC, { bugs: TWO, on: { regress: ({ label }) => (label === 'regress:allfixes' ? null : undefined) } })
  assert.equal(tests.result.fix.finalGate.clean, false)
  assert.deepEqual(tests.result.fix.finalGate.unreported, ['tests'])
})

test('a checks baseline that does not report stops nothing, and vouches for nothing', async () => {
  const dead = ({ label }) => (label === 'checks:baseline' ? null : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { 'ingest-ledger': TYPED, checks: dead } })
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1', 'b2'])
  assert.equal(labels.includes('checks:final'), false)
  assert.deepEqual(result.fix.finalGate.notChecked, [{ name: 'typecheck', exitCode: null }, { name: 'build', exitCode: null }])
  assert.equal(result.fix.finalGate.verdict, 'green', 'the tests held, and say so')
})

test('a toolchain with no typecheck or build is gated on its tests alone', async () => {
  const { result, labels, logs } = await fixRun(SRC, { bugs: TWO })
  assert.equal(labels.some(l => l.startsWith('checks:')), false)
  assert.deepEqual(result.fix.finalGate, { clean: true, verdict: 'green', regressed: [], newFailures: [], notChecked: [], unreported: [], held: ['tests'], results: [] })
  assert.match(logs.at(-1), / · final gate green · regression gate: /)
})
