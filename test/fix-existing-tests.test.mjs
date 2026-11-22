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
  `${block}\nreturn { fence, isTestFile, testEditCommand, changedExistingFiles, existingTestsEdited, testChangeReason, snapshotCommand, snapshotOf, restoreCommands, strikeOf, takenBackNote, proposalName, proposalMessage, proposalCommand, proposalOf, changedTestLines, decisionRow, branchSlug, commitMessageOk, FIX_RETRY_SCHEMA, TEST_CHECK_UNREPORTED }`,
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

// ---- a fix kept as a proposal ---------------------------------------------------------

const COMMIT = `0123456789ab${'c'.repeat(28)}`
const savedLine = (name, commit = COMMIT) => `crg-proposal-saved refs/crg-debug/proposed/${name}-${commit.slice(0, 12)} ${commit}`

test('a proposal is saved only when the command printed its line, under the name the script chose', () => {
  const ok = relay(`${savedLine('abc-wave-2-termui-py')}\n`)
  assert.deepEqual(H.proposalOf(ok, 'abc-wave-2-termui-py'), { ref: 'refs/crg-debug/proposed/abc-wave-2-termui-py-0123456789ab', commit: COMMIT })
  assert.equal(H.proposalOf(null, 'abc-wave-2-termui-py'), null, 'a dead relay')
  assert.equal(H.proposalOf(relay(savedLine('abc-wave-2-termui-py'), 1), 'abc-wave-2-termui-py'), null, 'a non-zero exit')
  assert.equal(H.proposalOf(relay('saved the proposal'), 'abc-wave-2-termui-py'), null, 'the agent\'s word for it')
  assert.equal(H.proposalOf(ok, 'abc-wave-3-termui-py'), null, 'another proposal\'s line')
  assert.equal(H.proposalOf(relay(`crg-proposal-saved refs/heads/main ${COMMIT}`), 'abc-wave-2-termui-py'), null, 'a ref outside refs/crg-debug/proposed/')
  assert.equal(H.proposalOf(relay(`crg-proposal-saved refs/crg-debug/proposed/abc-wave-2-termui-py-ffffffffffff ${COMMIT}`), 'abc-wave-2-termui-py'), null, 'a ref that does not carry its own commit')
  assert.equal(H.proposalOf(ok, ''), null)
})

test('a proposal\'s name and message are built by the script and are safe to hand a shell and a commit', () => {
  assert.equal(H.proposalName('1x9k2', 'wave 2', 'src/click/termui.py'), '1x9k2-wave-2-termui-py')
  assert.match(H.proposalName('1x9k2', 'coupled', 'src/a b.py, src/$(rm -rf ~).py'), /^[a-z0-9-]+$/)
  const one = [{ bugId: 'b1', file: 'src/click/termui.py:412' }]
  assert.equal(H.proposalMessage(one, H.strikeOf([], [{ path: 'tests/test_utils.py', removed: 2 }])), 'Proposed fix for a bug in termui.py: needs an existing test changed')
  assert.equal(H.proposalMessage([...one, { bugId: 'b2', file: 'src/click/termui.py:9' }], H.strikeOf([{ id: 't::x', output: '' }], [])), 'Proposed fix for 2 bugs in termui.py: breaks an existing test')
  const awkward = [{ bugId: 'b1', file: 'src/claude_client.py' }]
  for (const strike of [H.strikeOf([], [{ path: 't/test_a.py', removed: 1 }]), H.strikeOf([{ id: 't::x', output: '' }], [])]) {
    assert.equal(H.commitMessageOk(H.proposalMessage(awkward, strike)), true)
    assert.equal(/claude/i.test(H.proposalMessage(awkward, strike)), false)
  }
})

test('the changed lines of an existing test are read per file, and only when the relay carried them all', () => {
  const diff = [
    'diff --git a/tests/test_utils.py b/tests/test_utils.py', 'index 1111111..2222222 100644', '--- a/tests/test_utils.py', '+++ b/tests/test_utils.py',
    '@@ -12 +12 @@ def test_styling():', '-    assert style("x", overline=True) == "\\x1b[55mx"', '+    assert style("x", overline=True) == "\\x1b[53mx"',
    '@@ -20 +20 @@', '--- an sql comment that was removed', '+++ and one that was added',
    'diff --git a/tests/test_old.py b/tests/test_old.py', 'deleted file mode 100644', '--- a/tests/test_old.py', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-def test_old():', '-    assert True',
  ]
  const marked = diff.filter(l => /^[-+]/.test(l)).length
  const whole = relay(`${savedLine('n')}\n${diff.join('\n')}\ncrg-test-lines ${COMMIT} ${marked}\n`)
  assert.deepEqual(H.changedTestLines(whole, COMMIT), [
    { path: 'tests/test_utils.py', old: ['    assert style("x", overline=True) == "\\x1b[55mx"', '-- an sql comment that was removed'], new: ['    assert style("x", overline=True) == "\\x1b[53mx"', '++ and one that was added'], omitted: 0 },
    { path: 'tests/test_old.py', old: ['def test_old():', '    assert True'], new: [], omitted: 0 },
  ])
  const short = relay(`${savedLine('n')}\n${diff.slice(0, 7).join('\n')}\ncrg-test-lines ${COMMIT} ${marked}\n`)
  assert.equal(H.changedTestLines(short, COMMIT), null, 'a line went missing in the relay')
  assert.equal(H.changedTestLines(relay(diff.join('\n')), COMMIT), null, 'no count to check against')
  assert.equal(H.changedTestLines(relay(`${diff.join('\n')}\ncrg-test-lines ${'f'.repeat(40)} ${marked}`), COMMIT), null, 'the count of another proposal')

  const long = ['diff --git a/t/test_big.py b/t/test_big.py', '--- a/t/test_big.py', '+++ /dev/null', '@@ -1,50 +0,0 @@', ...[...Array(50)].map((_, i) => `-line ${i}`)]
  const [big] = H.changedTestLines(relay(`${long.join('\n')}\ncrg-test-lines ${COMMIT} 52`), COMMIT)
  assert.deepEqual([big.old.length, big.old[39], big.omitted], [40, 'line 39', 10], 'a deleted test file does not flood the result')
})

test('a needs-decision row labels the fixer\'s ground as a claim and carries the one command that applies the fix', () => {
  const strike = H.strikeOf([], [{ path: 'tests/test_utils.py', removed: 2 }])
  const row = H.decisionRow('/work/it\'s here', 2, [{ bugId: 'b1' }, { bugId: 'b2' }], 'src/click/termui.py', strike, { ref: 'refs/crg-debug/proposed/n-0123456789ab', commit: COMMIT }, null, `  ${'g'.repeat(2000)}`)
  assert.deepEqual(Object.keys(row), ['wave', 'bugs', 'file', 'reason', 'existingTests', 'failingTests', 'fixerClaim', 'ref', 'commit', 'apply'])
  assert.equal(row.fixerClaim.length, 1500)
  assert.equal(row.apply, `git -C '/work/it'\\''s here' cherry-pick refs/crg-debug/proposed/n-0123456789ab`)
  assert.deepEqual(row.existingTests, [{ path: 'tests/test_utils.py', removed: 2, changed: null }])
})

test('in a real repository a proposal is one commit on no branch, and saving it changes nothing else', () => {
  const repo = mkdtempSync(join(tmpdir(), 'crg-propose-'))
  const sh = command => execFileSync('sh', ['-c', command], { stdio: 'pipe' }).toString()
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { stdio: 'pipe' }).toString()
  const write = (file, text) => writeFileSync(join(repo, file), text)
  const read = file => readFileSync(join(repo, file), 'utf8')
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'dev@example.com')
    git('config', 'user.name', 'dev')
    mkdirSync(join(repo, 'src'))
    mkdirSync(join(repo, 'tests'))
    write('src/termui.py', 'def style(text, overline=False):\n    return ("55" if overline else "") + text\n')
    write('src/other.py', 'x = 1\n')
    write('tests/test_utils.py', 'def test_styling():\n    assert style("x", overline=True) == "55x"\n')
    write('tests/test_gone.py', 'def test_gone():\n    assert True\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    const snapshot = H.snapshotOf({ results: [{ command: 'snapshot', exitCode: 0, stdout: sh(H.snapshotCommand(repo)) }] })

    // The fixer's whole change: source, an existing test's expected value, a new test, a
    // test it deleted. Beside it, things that are NOT its change and must not ride along.
    write('src/termui.py', 'def style(text, overline=False):\n    return ("53" if overline else "") + text\n')
    write('tests/test_utils.py', 'def test_styling():\n    assert style("x", overline=True) == "53x"\n')
    write('tests/test_overline.py', 'def test_overline():\n    assert style("x", overline=True).startswith("53")\n')
    unlinkSync(join(repo, 'tests/test_gone.py'))
    write('src/other.py', 'x = 2\n')
    write('notes.txt', 'mine\n')
    const before = { head: git('rev-parse', 'HEAD'), branch: git('symbolic-ref', 'HEAD'), status: git('status', '--porcelain'), index: readFileSync(join(repo, '.git/index')), branches: git('branch', '-a') }

    const files = ['src/termui.py', 'tests/test_utils.py', 'tests/test_overline.py', 'tests/test_gone.py', 'tests/never_existed.py']
    const message = H.proposalMessage([{ bugId: 'b1', file: 'src/termui.py' }], H.strikeOf([], [{ path: 'tests/test_utils.py', removed: 1 }]))
    const stdout = sh(H.proposalCommand(repo, files, ['tests/test_utils.py'], snapshot, 'abc-wave-2-termui-py', message))
    const saved = H.proposalOf({ results: [{ command: 'save', exitCode: 0, stdout }] }, 'abc-wave-2-termui-py')
    assert.ok(saved, stdout)

    // Nothing but the git directory changed: not the tree, the index, HEAD or any branch.
    assert.deepEqual({ head: git('rev-parse', 'HEAD'), branch: git('symbolic-ref', 'HEAD'), status: git('status', '--porcelain'), index: readFileSync(join(repo, '.git/index')), branches: git('branch', '-a') }, before)
    assert.equal(git('branch', '-a', '--contains', saved.commit), '', 'the proposal is on no branch')
    assert.equal(git('rev-parse', saved.ref).trim(), saved.commit)
    // One commit on top of HEAD, holding the fixer's change and nothing else.
    assert.equal(git('rev-parse', `${saved.commit}^`), before.head)
    assert.equal(git('log', '-1', '--format=%s', saved.commit).trim(), 'Proposed fix for a bug in termui.py: needs an existing test changed')
    assert.equal(git('diff', '--name-status', 'HEAD', saved.commit), 'M\tsrc/termui.py\nD\ttests/test_gone.py\nA\ttests/test_overline.py\nM\ttests/test_utils.py\n')
    assert.equal(git('show', `${saved.commit}:src/termui.py`), read('src/termui.py'))
    // The existing test's changed lines, old and new, from the same command.
    assert.deepEqual(H.changedTestLines({ results: [{ command: 'save', exitCode: 0, stdout }] }, saved.commit), [
      { path: 'tests/test_utils.py', old: ['    assert style("x", overline=True) == "55x"'], new: ['    assert style("x", overline=True) == "53x"'], omitted: 0 },
    ])

    // After the fix is taken back, the one command the row carries brings it all back.
    for (const c of H.restoreCommands(repo, files, snapshot)) sh(c)
    assert.equal(read('tests/test_utils.py').includes('55x'), true)
    git('checkout', '-q', '--', 'src/other.py')
    const row = H.decisionRow(repo, 2, [{ bugId: 'b1' }], 'src/termui.py', H.strikeOf([], []), saved, null, '')
    sh(row.apply)
    assert.equal(read('src/termui.py').includes('"53"'), true)
    assert.equal(read('tests/test_utils.py').includes('53x'), true)
    assert.equal(read('tests/test_overline.py').includes('test_overline'), true)
    assert.throws(() => read('tests/test_gone.py'))
    assert.equal(read('notes.txt'), 'mine\n')

    // With no commit to build on, nothing is saved and the command says so by failing.
    const empty = mkdtempSync(join(tmpdir(), 'crg-propose-empty-'))
    try {
      execFileSync('git', ['-C', empty, 'init', '-q'], { stdio: 'pipe' })
      writeFileSync(join(empty, 'a.py'), 'x = 1\n')
      execFileSync('git', ['-C', empty, 'add', '-A'], { stdio: 'pipe' })
      assert.throws(() => sh(H.proposalCommand(empty, ['a.py'], [], snapshot, 'n', message)), err => err.status !== 0 && !err.stdout.toString().includes('crg-proposal-saved'))
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
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
const WAVE = `${'5'.repeat(39)}1` // the restore point the harness hands out for a label's first call

// Answer one label's calls with `answer`; every other call gets the harness default.
const only = (label, answer) => call => (call.label === label ? answer(call) : undefined)
const ALPHA_EDIT = printed(...SOURCES, '1\t1\ttests/test_alpha.py')
const EDITED = H.strikeOf([], [{ path: 'tests/test_alpha.py', removed: 1 }])

test('a fixer that rewrites an expected value in an existing test is taken back and tried once more, and the rest of the wave commits', async () => {
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { testedits: only('testedits:wave1', ALPHA_EDIT) } })
  assert.deepEqual(labels, [
    'tree-status', 'ingest-ledger', 'fix-branch', 'regress:baseline', 'snapshot:wave1', 'fix:alpha.py', 'fix:bravo.py', 'gate:alpha.py', 'gate:bravo.py',
    'testedits:wave1', 'restore:wave1', 'regress:wave1', 'commit:wave',
    'snapshot:wave2', 'fix:alpha.py', 'gate:alpha.py', 'testedits:wave2', 'regress:wave2', 'commit:wave', 'regress:allfixes',
  ], 'no blame agent — the fixer is known — and one retry')
  const restore = calls.find(c => c.label === 'restore:wave1')
  assert.ok(restore.prompt.includes(`-- 'src/alpha.py' 'tests/test_alpha.py' `) && !restore.prompt.includes('bravo'), 'only that fixer\'s files go back')
  assert.match(calls.find(c => c.label === 'commit:wave').prompt, /add -- "src\/bravo\.py" "tests\/test_bravo\.py" {3}\(EXACTLY/)

  const [firstTry, secondTry] = calls.filter(c => c.label === 'fix:alpha.py')
  assert.equal(firstTry.prompt.includes('TAKEN BACK'), false)
  assert.ok(secondTry.prompt.includes(H.takenBackNote([{ bugId: 'b1' }], new Map([['b1', EDITED]]))), 'the retry is told which existing test it changed')
  assert.deepEqual(secondTry.opts.schema, H.FIX_RETRY_SCHEMA)

  assert.deepEqual(names(result.fix.fixed), ['b2', 'b1'])
  assert.deepEqual(result.fix.unfixed, [])
  assert.deepEqual(result.fix.needsDecision, [])
  assert.deepEqual(result.fix.existingTestEdits, [{ wave: 1, bugs: ['b1'], files: [{ path: 'tests/test_alpha.py', removed: 1 }] }])
  assert.ok(logs.includes('Fix wave 1: fix needs an existing test changed: tests/test_alpha.py — took back b1'))

  const check = calls.find(c => c.label === 'testedits:wave1')
  assert.ok(check.prompt.includes(H.testEditCommand('/tmp/crg-fixture', WAVE)), 'the check is the script\'s own command, against this wave\'s restore point')
  assert.deepEqual(check.opts.schema.required, ['results'])
})

test('the second time, the fix is saved as a proposal before it is taken back, and reported for a decision', async () => {
  const GROUND = 'docs/api.rst, "Styling": overline=True adds an overline. The test expects the underline code.'
  const fix = ({ label, nth }) => (label === 'fix:alpha.py' && nth === 2
    ? { ground: GROUND, filesTouched: ['src/alpha.py', 'tests/test_alpha.py'], fixes: [{ bugId: 'b1', testFile: 'tests/test_alpha.py', testCommand: 'pytest tests/test_alpha.py::test_b1', redObserved: true, greenObserved: true }] }
    : undefined)
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { testedits: ALPHA_EDIT, fix } })
  assert.deepEqual(labels.slice(labels.indexOf('snapshot:wave2')), ['snapshot:wave2', 'fix:alpha.py', 'gate:alpha.py', 'testedits:wave2', 'propose:wave2', 'restore:wave2', 'regress:allfixes'], 'saved first, then put back; never committed')
  const name = H.proposalName(H.branchSlug(TWO), 'wave 2', 'src/alpha.py')
  const ref = `refs/crg-debug/proposed/${name}-abc123abc123`
  assert.deepEqual(result.fix.needsDecision, [{
    wave: 2,
    bugs: ['b1'],
    file: 'src/alpha.py',
    reason: 'fix needs an existing test changed: tests/test_alpha.py',
    existingTests: [{ path: 'tests/test_alpha.py', removed: 1, changed: { path: 'tests/test_alpha.py', old: ['    assert style("x") == "x"'], new: ['    assert style("x") == "X"'], omitted: 0 } }],
    failingTests: [],
    fixerClaim: GROUND,
    ref,
    commit: `abc123abc123${'0'.repeat(28)}`,
    apply: `git -C '/tmp/crg-fixture' cherry-pick ${ref}`,
  }])
  const propose = calls.find(c => c.label === 'propose:wave2')
  assert.ok(propose.prompt.includes(H.fence(H.proposalCommand('/tmp/crg-fixture', ['src/alpha.py', 'tests/test_alpha.py'], ['tests/test_alpha.py'], WAVE, name, 'Proposed fix for a bug in alpha.py: needs an existing test changed'))))
  assert.match(propose.prompt, /It writes only inside the git directory: it changes neither the working tree nor the index, and it moves no branch\./)
  assert.deepEqual(names(result.fix.fixed), ['b2'])
  assert.deepEqual(result.fix.unfixed, [], 'needing a decision is its own outcome')
  assert.equal(labels.filter(l => l === 'fix:alpha.py').length, 2, 'and there is no third try')
  assert.equal(calls.filter(c => c.label === 'commit:wave').length, 1)
  assert.match(logs.at(-1), /^Fix complete: 1 fixed · 0 unfixed · 1 need a decision · 1 wave commit/)
})

test('a proposal holds one fixer\'s files, not the wave\'s', async () => {
  const both = printed(...SOURCES, '1\t1\ttests/test_alpha.py', '1\t1\ttests/test_bravo.py')
  const testedits = call => (call.label === 'testedits:wave1' ? both(call) : ALPHA_EDIT(call))
  const { result, calls } = await fixRun(SRC, { bugs: TWO, on: { testedits } })
  const propose = calls.filter(c => c.label === 'propose:wave2')
  assert.equal(propose.length, 1)
  assert.ok(propose[0].prompt.includes(`--cached --ignore-unmatch -- 'src/alpha.py' 'tests/test_alpha.py' && `) && !propose[0].prompt.includes('bravo'))
  assert.deepEqual(result.fix.needsDecision.map(d => d.bugs), [['b1']])
  assert.deepEqual(names(result.fix.fixed), ['b2'], 'the other fixer, taken back once, closed on its retry')
})

test('a proposal whose changed lines were not relayed whole still stands, without the lines', async () => {
  const short = ({ prompt }) => ({ results: [{ command: 'save', exitCode: 0, stdout: `crg-proposal-saved ${/R="(refs\/crg-debug\/proposed\/[a-z0-9-]+-)/.exec(prompt)[1]}abc123abc123 abc123abc123${'0'.repeat(28)}\n-    assert style("x") == "x"\ncrg-test-lines abc123abc123${'0'.repeat(28)} 4\n` }] })
  const { result } = await fixRun(SRC, { bugs: TWO, on: { testedits: ALPHA_EDIT, propose: short } })
  assert.deepEqual(result.fix.needsDecision.map(d => d.existingTests), [[{ path: 'tests/test_alpha.py', removed: 1, changed: null }]])
})

test('a fixer that only adds a test to an existing file is untouched', async () => {
  // The command leaves an added-to file out; a relay that listed it anyway changes nothing.
  for (const rows of [SOURCES, [...SOURCES, '9\t0\ttests/test_alpha.py']]) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: printed(...rows) } })
    assert.equal(labels.some(l => l.startsWith('restore:')), false)
    assert.deepEqual(names(result.fix.fixed), ['b1', 'b2'])
    assert.deepEqual(result.fix.existingTestEdits, [])
    assert.equal(result.fix.commits.length, 2, 'a commit per fixer')
  }
})

test('a check that does not report is not a pass: the wave is put back and nothing commits', async () => {
  const dropped = ({ prompt }) => ({ results: [{ command: 'check', exitCode: 0, stdout: `3\t2\tsrc/alpha.py\n${summary(2, idIn(prompt))}` }] })
  const empty = () => ({ results: [{ command: 'check', exitCode: 0, stdout: '' }] })
  const prose = () => ({ results: [{ command: 'check', exitCode: 0, stdout: 'No existing test file was modified.' }] })
  const failed = ({ prompt }) => ({ results: [{ command: 'check', exitCode: 128, stdout: summary(0, idIn(prompt)) }] })
  for (const testedits of [() => null, () => { throw new Error('retry cap') }, empty, prose, dropped, failed]) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits } })
    assert.deepEqual(labels.slice(9), ['testedits:wave1', 'restore:wave1', 'regress:allfixes'], 'no regression gate is asked and no commit is made')
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
  assert.deepEqual(labels.slice(9), ['testedits:wave1', 'restore:wave1', 'regress:wave1', 'commit:wave', 'commit:wave', 'regress:allfixes'], 'then the regression gate runs against the original test')
  assert.deepEqual(names(result.fix.fixed), ['b1', 'b2'])
  assert.deepEqual(result.fix.existingTestEdits, [{ wave: 1, bugs: [], files: [{ path: 'tests/test_utils.py', removed: 2 }] }])
})

test('a file a fixer named as its test is a test, whatever it is called', async () => {
  const fix = ({ label }) => {
    if (label !== 'fix:alpha.py') return undefined
    return { filesTouched: ['src/alpha.py', 'checks/alpha_cases.py'], fixes: [{ bugId: 'b1', testFile: 'checks/alpha_cases.py', testCommand: 'pytest checks/alpha_cases.py::case_b1', redObserved: true, greenObserved: true }] }
  }
  const { result } = await fixRun(SRC, { bugs: TWO, on: { fix, testedits: printed(...SOURCES, '1\t1\tchecks/alpha_cases.py') } })
  assert.deepEqual(result.fix.needsDecision.map(d => [d.bugs, d.reason]), [[['b1'], 'fix needs an existing test changed: checks/alpha_cases.py']])
  assert.deepEqual(names(result.fix.fixed), ['b2'])
})

test('a wave the script took a fixer back in has not stalled: the bug gets its own retry, not the coupled attempt', async () => {
  const one = [bug('b1', 'src/alpha.py')]
  const { result, labels } = await fixRun(SRC, { bugs: one, on: { testedits: only('testedits:wave1', printed('3\t2\tsrc/alpha.py', '1\t1\ttests/test_alpha.py')) } })
  assert.deepEqual(labels.filter(l => l.startsWith('fix:')), ['fix:alpha.py', 'fix:alpha.py'])
  assert.equal(labels.includes('regress:wave1'), false, 'with nothing of wave 1 left in the tree there is nothing for the gate to judge')
  assert.deepEqual(names(result.fix.fixed), ['b1'])
  assert.deepEqual(result.fix.waves, [{ wave: 1, files: 1, attempted: 1, closed: 0 }, { wave: 2, files: 1, attempted: 1, closed: 1 }])
})

test('a fixer taken back for an existing test keeps its retry when the rest of its wave is then lost', async () => {
  const regress = ({ label }) => (label === 'regress:wave1' ? null : undefined) // the regression gate goes silent
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: only('testedits:wave1', ALPHA_EDIT), regress } })
  assert.deepEqual(labels.slice(9, 13), ['testedits:wave1', 'restore:wave1', 'regress:wave1', 'restore:wave1'])
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b2', 'regression gate did not report']])
  assert.deepEqual(names(result.fix.fixed), ['b1'], 'b1 was already out of the tree; it is tried again and closes')
})

test('if the taken-back fixer cannot be confirmed put back, the fix phase stops', async () => {
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: ALPHA_EDIT, restore: () => null } })
  assert.deepEqual(labels.slice(9), ['testedits:wave1', 'restore:wave1', 'regress:allfixes'])
  assert.equal(result.fix.halted, 'the restore after wave 1 was not confirmed')
  assert.deepEqual(result.fix.commits, [])
  assert.deepEqual(result.fix.fixed, [])
  assert.deepEqual(result.fix.unfixed.map(b => b.reason), Array(2).fill('the restore after wave 1 was not confirmed'))
})

test('the coupled attempt may not rewrite an existing test either: one more attempt, then a proposal', async () => {
  const stuck = [bug('b1', 'src/alpha.py')]
  const perBugRed = ({ label, nth }) => (label === 'gate:alpha.py' && nth === 1 ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const edit = printed('3\t2\tsrc/alpha.py', '1\t1\ttests/test_alpha.py')
  const coupledEdit = nths => ({ label, nth, prompt }) => (label === 'testedits:coupled' && nths.includes(nth) ? edit({ prompt }) : undefined)

  const once = await fixRun(SRC, { bugs: stuck, on: { gate: perBugRed, testedits: coupledEdit([1]) } })
  assert.deepEqual(once.labels.slice(once.labels.indexOf('testedits:coupled')), ['testedits:coupled', 'restore:coupled', 'snapshot:coupled', 'fix:coupled', 'gate:alpha.py', 'testedits:coupled', 'regress:coupled', 'commit:wave', 'regress:allfixes'])
  assert.ok(once.calls.filter(c => c.label === 'fix:coupled')[1].prompt.includes(H.takenBackNote(stuck, new Map([['b1', EDITED]]))))
  assert.deepEqual(names(once.result.fix.fixed), ['b1'])

  const twice = await fixRun(SRC, { bugs: stuck, on: { gate: perBugRed, testedits: coupledEdit([1, 2]) } })
  assert.deepEqual(twice.labels.slice(-5), ['gate:alpha.py', 'testedits:coupled', 'propose:coupled', 'restore:coupled', 'regress:allfixes'], 'no regression gate, no commit, no third attempt')
  assert.deepEqual(twice.result.fix.unfixed, [])
  assert.deepEqual(twice.result.fix.needsDecision.map(d => [d.wave, d.bugs, d.reason]), [['coupled', ['b1'], 'fix needs an existing test changed: tests/test_alpha.py']])
  assert.deepEqual(twice.result.fix.existingTestEdits.map(t => t.wave), ['coupled', 'coupled'])

  const silent = await fixRun(SRC, { bugs: stuck, on: { gate: perBugRed, testedits: ({ label }) => (label === 'testedits:coupled' ? null : undefined) } })
  assert.deepEqual(silent.result.fix.unfixed.map(b => b.reason), [H.TEST_CHECK_UNREPORTED])
  assert.deepEqual(silent.result.fix.commits, [])
  assert.equal(silent.labels.filter(l => l === 'fix:coupled').length, 1)
})

test('a coupled attempt that fails its own test is not kept, even for a bug already taken back once', async () => {
  // b1's own test stays red in wave 1, so it goes to the coupled attempt. The first one
  // passes its test but changed an existing test: taken back, one more attempt. The second
  // changes the test again and does NOT pass its own test — there is no working fix to keep.
  const gate = ({ label, nth }) => (label === 'gate:alpha.py' && nth !== 2 ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const edit = printed('3\t2\tsrc/alpha.py', '1\t1\ttests/test_alpha.py')
  const testedits = call => (call.label === 'testedits:coupled' ? edit(call) : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: [bug('b1', 'src/alpha.py')], on: { gate, testedits } })
  assert.deepEqual(labels.filter(l => l.startsWith('fix:')), ['fix:alpha.py', 'fix:coupled', 'fix:coupled'])
  assert.equal(labels.some(l => l.startsWith('propose:')), false)
  assert.deepEqual(result.fix.needsDecision, [])
  assert.deepEqual(result.fix.unfixed.map(b => b.reason), ['fix needs an existing test changed: tests/test_alpha.py'])
})

test('a coupled attempt that did not pass its own test is not kept as a proposal', async () => {
  const stuck = [bug('b1', 'src/alpha.py')]
  const allRed = ({ label }) => (label === 'gate:alpha.py' ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: stuck, on: { gate: allRed, testedits: ({ label, prompt }) => (label === 'testedits:coupled' ? printed('1\t1\ttests/test_alpha.py')({ prompt }) : undefined) } })
  assert.equal(labels.some(l => l.startsWith('propose:')), false)
  assert.equal(labels.filter(l => l === 'fix:coupled').length, 1)
  assert.deepEqual(result.fix.unfixed.map(b => b.reason), ['fix needs an existing test changed: tests/test_alpha.py'])
  assert.deepEqual(result.fix.needsDecision, [])
})

// ---- a retry keeps its reason ---------------------------------------------------------

const EXISTING = { id: 'tests/test_alpha.py::test_existing', output: 'AssertionError: 1 != 2' }
const BASE_CMD = 'pytest tests/test_alpha.py tests/test_bravo.py'
const failing = (...f) => ({ runs: [{ command: BASE_CMD, exitCode: f.length ? 1 : 0, passed: 40, failing: f }] })
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

test('a fixer taken back for changing a test, and not closed on its retry, is unfixed because of that test file', async () => {
  const fix = ({ label, nth }) => (label === 'fix:alpha.py' && nth === 2 ? { filesTouched: [], fixes: [{ bugId: 'b1', redObserved: false, greenObserved: false }] } : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { testedits: only('testedits:wave1', ALPHA_EDIT), fix } })
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', 'fix needs an existing test changed: tests/test_alpha.py']])
  assert.equal(labels.some(l => l.startsWith('propose:')), false, 'there is no working fix to keep')
  assert.deepEqual(result.fix.needsDecision, [])
})

test('a bug that was never taken back still says RED was not observed', async () => {
  const fix = ({ label }) => (label === 'fix:alpha.py' ? { filesTouched: [], fixes: [{ bugId: 'b1', redObserved: false, greenObserved: false }] } : undefined)
  const { result } = await fixRun(SRC, { bugs: TWO, on: { fix } })
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b1', 'RED not observed — not reproduced; source left untouched']])
})
