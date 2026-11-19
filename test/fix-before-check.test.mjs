// Protects the final gate's answer about a failing test nobody ran before the first fix: it is
// not called new on sight, it is run once on the tree as it stood then, and the tree is back
// exactly as it was afterwards, or the run says it is not.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { noBeforeTests, beforeVerdict, finalGateVerdict, treeMoveCommands, snapshotCommand, snapshotOf, restoreOk, fence }`)()
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const BASE = 'python -m pytest tests/unit --ignore=tests/unit/test_old.py'
const EXTRA = 'python -m pytest tests/unit/test_old.py'
const OLD = { id: 'tests/unit/test_old.py::test_always_red', output: 'AttributeError' }
const failing = (command, ...tests) => ({ command, exitCode: tests.length ? 1 : 0, passed: 23, failing: tests })

// ---- the script's own judgment -----------------------------------------------------

test('a test that fails only under a command the baseline never ran has no before', () => {
  const relay = { runs: [failing(BASE), failing(EXTRA, OLD)] }
  assert.deepEqual(H.noBeforeTests(relay, [BASE], [], []), [{ id: OLD.id, command: EXTRA }])
  assert.deepEqual(H.noBeforeTests(relay, [BASE], [OLD.id], []), [], 'the baseline saw it fail: it has a before')
  assert.deepEqual(H.noBeforeTests({ runs: [failing(BASE, OLD), failing(EXTRA, OLD)] }, [BASE], [], []), [], 'a baseline command runs it, so it passed before: it is new')
  assert.deepEqual(H.noBeforeTests(relay, [BASE], [], ['tests/unit/test_old.py']), [], 'a test file a fix of this run declared must pass')
  assert.deepEqual(H.noBeforeTests({ runs: [failing(BASE), { command: EXTRA, exitCode: 2, passed: -1, failing: [] }] }, [BASE], [], []), [], 'a command that named no test is judged as before')
  assert.deepEqual(H.noBeforeTests(null, [BASE], [], []), [])
})

test('the tree before the first fix says which of them always failed and which the run broke', () => {
  const NEW = { id: 'tests/unit/test_old.py::test_was_green', command: EXTRA }
  const tests = [{ id: OLD.id, command: EXTRA }, NEW]
  assert.deepEqual(H.beforeVerdict(tests, { runs: [failing(EXTRA, OLD)] }, [EXTRA]), { failedBefore: [tests[0]], passedBefore: [NEW], unsettled: [] })
  assert.deepEqual(H.beforeVerdict(tests, null, [EXTRA]).unsettled, tests, 'a check that did not report settles nothing')
  assert.deepEqual(H.beforeVerdict(tests, { runs: [{ command: EXTRA, exitCode: 4, passed: -1, failing: [] }] }, [EXTRA]).unsettled, tests, 'a command that stopped without a count is not a pass')
  assert.deepEqual(H.beforeVerdict([NEW], { runs: [{ command: EXTRA, exitCode: 0, passed: -1, failing: [] }] }, [EXTRA]).passedBefore, [NEW], 'exit 0 is a pass from a runner that prints no count')
})

test('the gate is not red for a test it could not place, and not green over it', () => {
  const held = [[{ id: 'k1', name: 'build' }], new Map([['k1', 0]]), new Map([['k1', 0]])]
  assert.equal(H.finalGateVerdict(...held, [], [], [], []).verdict, 'green')
  const v = H.finalGateVerdict(...held, [], [], [], [OLD.id])
  assert.equal(v.verdict, 'not checked')
  assert.deepEqual(v.noBefore, [OLD.id])
  assert.equal(H.finalGateVerdict(...held, ['t::new'], [], [], [OLD.id]).verdict, 'red', 'a real new failure is still red')
})

// ---- the move, with real git -------------------------------------------------------

test('the whole tree goes to a restore point and back, and git proves each move', () => {
  const repo = mkdtempSync(join(tmpdir(), 'crg-before-'))
  const sh = command => execFileSync('sh', ['-c', command], { stdio: 'pipe' }).toString()
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { stdio: 'pipe' }).toString()
  const write = (file, text) => writeFileSync(join(repo, file), text)
  const read = file => readFileSync(join(repo, file), 'utf8')
  const snapshot = () => H.snapshotOf({ results: [{ command: 'snapshot', exitCode: 0, stdout: sh(H.snapshotCommand(repo)) }] })
  const move = to => { const [put, compare] = H.treeMoveCommands(repo, to).map(sh); return H.restoreOk({ results: [{ command: 'put-back', exitCode: 0, stdout: put }, { command: 'compare', exitCode: 0, stdout: compare }] }, to) }
  try {
    git('init', '-q'); git('config', 'user.email', 'dev@example.com'); git('config', 'user.name', 'dev')
    mkdirSync(join(repo, 'src')); mkdirSync(join(repo, 'cache'))
    write('src/a.py', 'before\n'); write("src/it's.py", 'before\n'); write('.gitignore', 'cache/\n')
    git('add', '-A'); git('commit', '-qm', 'init')
    const before = snapshot()
    // The run: a committed fix, a file no fixer reported, a new test, and an ignored cache.
    write('src/a.py', 'fixed\n'); git('commit', '-qam', 'fix')
    write("src/it's.py", 'changed, and reported by nobody\n'); write('test_new.py', 'new\n'); write('cache/x', 'ignored\n')
    const end = snapshot()
    const status = git('status', '--porcelain')

    assert.equal(move(before), true)
    assert.deepEqual([read('src/a.py'), read("src/it's.py"), existsSync(join(repo, 'test_new.py')), read('cache/x')], ['before\n', 'before\n', false, 'ignored\n'], 'every difference is gone, reported or not; ignored files are left alone')
    assert.equal(move(end), true)
    assert.deepEqual([read('src/a.py'), read("src/it's.py"), read('test_new.py')], ['fixed\n', 'changed, and reported by nobody\n', 'new\n'])
    assert.equal(git('status', '--porcelain'), status, 'the real index never moved')

    write('src/a.py', 'someone edited this mid-check\n')
    const [, compare] = H.treeMoveCommands(repo, end)
    assert.throws(() => sh(compare), 'a tree that is not the restore point exits non-zero')
    assert.equal(H.restoreOk({ results: [{ command: 'compare', exitCode: 0, stdout: `crg-restore-ok ${before}\n` }] }, end), false, 'the line for another restore point is not this one')
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

// ---- stubbed fix runs --------------------------------------------------------------

const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const WAVE1 = `${'5'.repeat(39)}1`
const END = 'e'.repeat(40)
const endSnapshot = ({ label }) => (label === 'snapshot:thebefore-check' ? { results: [{ command: 'snapshot', exitCode: 0, stdout: `crg-restore-point ${END}\n` }] } : undefined)
const regress = ({ label }) => (label === 'regress:allfixes' ? { runs: [{ command: 'c1', exitCode: 0, passed: 42, failing: [] }, failing(EXTRA, OLD)] } : undefined)
const moved = prompt => ({ results: [{ command: 'put-back', exitCode: 0, stdout: '' }, { command: 'compare', exitCode: 0, stdout: `crg-restore-ok ${/--exit-code ([0-9a-f]+) --/.exec(prompt)[1]}\n` }] })
// What the before-check's agents answer: `there` = the tests' relay on the earlier tree.
const check = (there, { back = true, forth = true } = {}) => ({ label, prompt }) =>
  label === 'before-check:tests' ? there : (label === 'before-check:back' ? back : forth) ? moved(prompt) : { results: [{ command: 'compare', exitCode: 1, stdout: 'src/alpha.py\n' }] }
const CLOSING = ['regress:allfixes', 'snapshot:thebefore-check', 'before-check:back', 'before-check:tests', 'before-check:forth']

test('a test that fails at the end and already failed before the first fix does not make the gate red', async () => {
  const there = { runs: [{ command: 'c1', exitCode: 1, passed: 23, failing: [OLD] }] }
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { regress, snapshot: endSnapshot, 'before-check': check(there) } })
  assert.deepEqual(labels.slice(-5), CLOSING)
  assert.equal(result.fix.finalGate.verdict, 'green')
  assert.deepEqual([result.fix.finalGate.newFailures, result.fix.finalGate.noBefore], [[], []])
  assert.deepEqual(result.fix.finalGate.alreadyFailing, [{ id: OLD.id, command: EXTRA }])
  const [back, tests, forth] = calls.slice(-3)
  assert.ok(back.prompt.includes(`read-tree --reset -u ${WAVE1}`), 'back to the first restore point, taken before any fix')
  assert.ok(forth.prompt.includes(`read-tree --reset -u ${END}`), 'and forward to the tree the run ended with')
  assert.ok(tests.prompt.includes(`c1:\n${H.fence(EXTRA)}`), 'only the command that ran the test, as data')
  assert.match(tests.prompt, /Do NOT edit any file\./)
  assert.ok(logs.includes(`Fix: final gate — 1 failing test(s) were never run before the first fix (${OLD.id}); on the tree as it stood then 1 already failed, 0 passed, 0 could not be checked`))
  assert.match(logs.at(-1), / · final gate green · 1 test already failing before the first fix · /)
})

test('a test that passed before the first fix and fails at the end is a new failure', async () => {
  const there = { runs: [{ command: 'c1', exitCode: 0, passed: 26, failing: [] }] }
  const { result } = await fixRun(SRC, { bugs: TWO, on: { regress, snapshot: endSnapshot, 'before-check': check(there) } })
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.deepEqual(result.fix.finalGate.newFailures, [OLD.id])
  assert.deepEqual(result.fix.finalGate.alreadyFailing, [])
})

test('when the tree cannot be moved back the test is not run, the tree is put forward, and the gate is not checked', async () => {
  const { result, labels, logs } = await fixRun(SRC, { bugs: TWO, on: { regress, snapshot: endSnapshot, 'before-check': check(null, { back: false }) } })
  assert.deepEqual(labels.slice(-3), ['snapshot:thebefore-check', 'before-check:back', 'before-check:forth'], 'no test ran on a tree nobody proved')
  assert.equal(result.fix.finalGate.verdict, 'not checked')
  assert.deepEqual(result.fix.finalGate.noBefore, [OLD.id])
  assert.equal(result.fix.halted, undefined)
  assert.ok(logs.includes('Fix: final gate not checked — 1 failing test(s) were never run before the first fix, so nothing says whether a fix broke them'))
  assert.match(logs.at(-1), / · final gate NOT CHECKED · 1 failing test never run before the first fix · /)
})

test('a tree not confirmed back after the check halts the run and says where the final tree is', async () => {
  const there = { runs: [{ command: 'c1', exitCode: 1, passed: 23, failing: [OLD] }] }
  const { result, logs } = await fixRun(SRC, { bugs: TWO, on: { regress, snapshot: endSnapshot, 'before-check': check(there, { forth: false }) } })
  assert.equal(result.fix.halted, 'the working tree was not confirmed back after the before-check')
  assert.equal(result.fix.finalGate.verdict, 'not checked', 'what the check saw is not used: nothing after it can be trusted')
  assert.deepEqual(result.fix.finalGate.alreadyFailing, [])
  assert.ok(logs.some(l => l.includes(`Every committed fix is on crg-debug/fix-abc123, and restore point ${END} holds the tree as it was. Inspect the tree.`)))
})

test('a failing test in a file a fix of this run wrote is new, and nothing is moved', async () => {
  const mine = { id: 'tests/test_alpha.py::test_b1', output: 'assert 1 == 2' }
  const own = ({ label }) => (label === 'regress:allfixes' ? { runs: [{ command: 'c1', exitCode: 0, passed: 42, failing: [] }, failing('pytest tests/test_alpha.py', mine)] } : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { regress: own } })
  assert.equal(labels.some(l => l.startsWith('before-check')), false)
  assert.equal(result.fix.finalGate.verdict, 'red')
  assert.deepEqual(result.fix.finalGate.newFailures, [mine.id])
})
