// Protects the promise that a validated fix wave is either committed or loudly not: no
// file name can keep a wave out of git, and a commit that was refused, failed, or never
// reported is logged and returned with its bugs — never passed off as committed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()
const commitsOf = calls => calls.filter(c => c.label === 'commit:wave')

test('a wave whose only file is core.py commits', async () => {
  const { result, calls, logs } = await fixRun(SRC, { bugs: [bug('b1', 'src/click/core.py')] })
  assert.equal(commitsOf(calls).length, 1, 'the commit agent must be asked')
  assert.ok(commitsOf(calls)[0].prompt.includes('commit -m "Fix a bug in core.py"'))
  assert.deepEqual(result.fix.commits.map(c => [c.wave, c.message, c.bugs]), [['wave 1', 'Fix a bug in core.py', ['b1']]])
  assert.deepEqual(result.fix.uncommitted, [])
  assert.match(logs.at(-1), /1 fixed · 0 unfixed · 0 need a decision · 1 wave commit\(s\) on crg-debug\/fix-abc123 \(never pushed\) · final gate/)
})

test('a commit relay that dies is neither a failed commit nor a successful one, and nothing is built on it', async () => {
  // Five bugs in one file: wave 1 takes four, the fifth waits for a wave 2 that must not come.
  const five = [...Array(5)].map((_, i) => bug(`b${i + 1}`, 'src/core.py'))
  for (const commit of [() => null, () => { throw new Error('retry cap') }]) {
    const { result, labels, logs } = await fixRun(SRC, { bugs: five, on: { commit } })
    assert.deepEqual(labels.slice(-4), ['testedits:wave1', 'regress:wave1', 'commit:wave', 'regress:allfixes'], 'no wave 2 agent may be called')
    assert.equal(labels.filter(l => l.startsWith('fix:')).length, 1)
    assert.equal(result.fix.halted, 'the commit of wave 1 is unknown')
    assert.deepEqual(result.fix.commits, [], 'nothing unverified is reported as committed')
    assert.deepEqual(result.fix.uncommitted, [{
      wave: 'wave 1', bugs: ['b1', 'b2', 'b3', 'b4'], landed: 'unknown',
      reason: 'the commit relay did not report — a commit may have landed unverified on crg-debug/fix-abc123',
      branch: 'crg-debug/fix-abc123', files: ['src/core.py', 'tests/test_core.py'],
    }])
    assert.ok(logs.includes('Fix wave 1: the commit relay did not report — a commit may have landed unverified on crg-debug/fix-abc123. Inspect branch crg-debug/fix-abc123 (git log) and src/core.py, tests/test_core.py. No further fix is attempted.'))
    assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1', 'b2', 'b3', 'b4'], 'the wave\'s bugs passed their gates: not committed, and not failed either')
    assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b5', 'not attempted — the commit of wave 1 is unknown']])
    assert.match(logs.at(-1), /0 wave commit\(s\) on crg-debug\/fix-abc123 \(never pushed\) · 1 wave\(s\) NOT known to be committed/)
  }
})

test('a bug that failed its own gate is not retried on top of an unknown commit', async () => {
  const two = [bug('b1', 'src/core.py'), bug('b2', 'src/types.py')]
  const gate = ({ prompt }) => (prompt.includes('::test_b2') ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const { result, labels } = await fixRun(SRC, { bugs: two, on: { commit: () => null, gate } })
  assert.equal(labels.includes('snapshot:wave2'), false)
  assert.equal(labels.includes('fix:coupled'), false, 'and the coupled fallback does not run either')
  assert.deepEqual(result.fix.unfixed.map(b => [b.bugId, b.reason]), [['b2', 'not retried — the commit of wave 1 is unknown']])
})

test('a commit that reports no hash is a failed commit, and says so', async () => {
  const failed = () => ({ commitHash: '', committedFiles: [], results: [{ command: 'git commit', exitCode: 1 }] })
  const { result, logs } = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: failed } })
  assert.deepEqual(result.fix.commits, [])
  assert.deepEqual(result.fix.uncommitted, [{ wave: 'wave 1', bugs: ['b1'], landed: false, reason: 'commit failed — work stays in tree' }])
  assert.ok(logs.includes('Fix wave 1: commit failed — work stays in tree'))
})

test('a commit with stray files is undone and reported; an undo that never confirms leaves it in doubt', async () => {
  const stray = () => ({ commitHash: 'deadbeef12345', committedFiles: ['src/core.py', 'tests/test_core.py', 'notes.txt'], results: [{ command: 'git commit', exitCode: 0 }] })
  const undone = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: stray } })
  assert.deepEqual(undone.result.fix.commits, [])
  assert.deepEqual(undone.result.fix.uncommitted.map(u => [u.bugs, u.landed, u.reason]), [[['b1'], false, 'commit rejected (stray files vs allowlist) — un-committed, work stays in tree']])

  const stuck = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: stray, uncommit: () => null } })
  assert.deepEqual(stuck.result.fix.commits, [])
  assert.deepEqual(stuck.result.fix.uncommitted.map(u => [u.landed, u.reason]), [['unknown', 'commit rejected (stray files vs allowlist) AND the un-commit was not confirmed — deadbeef1 may still be on the run branch']])
  assert.equal(stuck.result.fix.halted, 'the commit of wave 1 is unknown', 'a commit nobody could undo is as unknown as one nobody saw')
  assert.equal(undone.result.fix.halted, undefined, 'a commit that was cleanly undone is a known state: the run goes on')
})

test('a commit whose message is not the one composed is undone: the live run appended an AI trailer', async () => {
  // What a live commit agent did to every commit, following its own instructions.
  const trailer = () => ({ commitHash: 'deadbeef12345', committedFiles: ['src/core.py', 'tests/test_core.py'], committedMessage: 'Fix a bug in core.py\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n', results: [{ command: 'git commit', exitCode: 0 }] })
  const { result, calls } = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: trailer } })
  assert.deepEqual(result.fix.commits, [], 'it is not reported as a commit')
  assert.deepEqual(result.fix.uncommitted.map(u => [u.bugs, u.landed, u.reason]), [[['b1'], false, 'commit rejected (the message that landed is not the one composed ("Fix a bug in core.py\\n\\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>")) twice — un-committed, work stays in tree']])
  assert.equal(commitsOf(calls).length, 2, 'an agent that adds the trailer every time gets one more try, not more')
  assert.ok(calls.some(c => c.label === 'uncommit:wave' || c.label.startsWith('uncommit')), 'and it is taken back')
  const brief = commitsOf(calls)[0].prompt
  assert.ok(brief.includes('add NO trailer: no Co-Authored-By') && brief.includes('log -1 --format=%B HEAD'), 'the agent is told, and asked for the message that landed')

  // A message reported as nothing is not the composed one either.
  const silent = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: () => ({ ...trailer(), committedMessage: undefined }) } })
  assert.deepEqual(silent.result.fix.commits, [])
})

test('a wave with nothing recorded to commit is refused out loud, not skipped', async () => {
  // A bug whose file is a line number and no path (a row with no file at all is not a
  // finding, and the ledger read refuses it), fixed by an agent that reports no test file
  // and no touched file.
  const nameless = bug('b1', '')
  const fix = () => ({ filesTouched: [], fixes: [{ bugId: 'b1', testCommand: 'pytest -k b1', redObserved: true, greenObserved: true }] })
  const { result, calls, logs } = await fixRun(SRC, { bugs: [nameless], on: { fix } })
  assert.equal(commitsOf(calls).length, 0)
  assert.deepEqual(result.fix.uncommitted, [{ wave: 'wave 1', bugs: ['b1'], landed: false, reason: 'not committed — no file was recorded for the closed bugs; work stays in tree' }])
  assert.ok(logs.some(l => l.startsWith('Fix wave 1: not committed — no file was recorded')))
})

test('commit:false is a choice, not a problem to report', async () => {
  const { result, calls } = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], args: { commit: false } })
  assert.equal(commitsOf(calls).length, 0)
  assert.deepEqual(result.fix.commits, [])
  assert.deepEqual(result.fix.uncommitted, [])
})

test('a commit undone for its message is tried once more, and lands when the second message is the composed one', async () => {
  // M9.1 on click: one commit agent added a Co-Authored-By trailer; the gated fix was left uncommitted.
  const landed = ({ prompt, nth }) => {
    const committedFiles = [...prompt.match(/add -- (.*?) {3}\(EXACTLY/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1])
    const composed = JSON.parse(/ commit -m ("(?:[^"\\]|\\.)*")/.exec(prompt)[1])
    const committedMessage = nth === 1 ? `${composed}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n` : `${composed}\n`
    return { commitHash: `c0ffee${nth}`, committedFiles, committedMessage, results: [{ command: 'git commit', exitCode: 0 }] }
  }
  const { result, calls, logs } = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: landed } })
  assert.deepEqual(result.fix.uncommitted, [])
  assert.deepEqual(result.fix.commits.map(c => [c.hash, c.bugs]), [['c0ffee2', ['b1']]])
  assert.equal(commitsOf(calls).length, 2)
  assert.ok(calls.some(c => c.label.startsWith('uncommit')), 'the first commit is undone before the second')
  assert.ok(logs.some(l => /un-committed; committing once more$/.test(l)))
  assert.ok(logs.some(l => / on a second try · graph re-ingested$/.test(l)))

  // Stray files are the fixer's doing: no second try.
  const stray = () => ({ commitHash: 'deadbeef12345', committedFiles: ['src/core.py', 'tests/test_core.py', 'notes.txt'], committedMessage: 'Fix a bug in core.py\n', results: [{ command: 'git commit', exitCode: 0 }] })
  const once = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit: stray } })
  assert.equal(commitsOf(once.calls).length, 1)
})
