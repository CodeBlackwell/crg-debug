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
  assert.match(logs.at(-1), /1 fixed · 0 unfixed · 1 wave commit\(s\) on crg-debug\/fix-abc123 \(never pushed\) · final gate/)
})

test('a commit relay that dies is neither a failed commit nor a successful one', async () => {
  for (const commit of [() => null, () => { throw new Error('retry cap') }]) {
    const { result, logs } = await fixRun(SRC, { bugs: [bug('b1', 'src/core.py')], on: { commit } })
    assert.deepEqual(result.fix.commits, [], 'nothing unverified is reported as committed')
    assert.deepEqual(result.fix.uncommitted, [{
      wave: 'wave 1', bugs: ['b1'], landed: 'unknown',
      reason: 'the commit relay did not report — a commit may have landed unverified on crg-debug/fix-abc123; check git log before trusting the branch',
    }])
    assert.ok(logs.includes(`Fix wave 1: ${result.fix.uncommitted[0].reason}`))
    assert.match(logs.at(-1), /0 wave commit\(s\) on crg-debug\/fix-abc123 \(never pushed\) · 1 wave\(s\) NOT known to be committed/)
    assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b1'], 'the fix itself is still gated and reported')
  }
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
})

test('a wave with nothing recorded to commit is refused out loud, not skipped', async () => {
  // A bug with no file, fixed by an agent that reports no test file and no touched file.
  const nameless = { ...bug('b1', ''), file: '' }
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
