// Protects the user-facing behavior that a single agent throwing anywhere in Phase 4
// (fix waves) never destroys the whole fix run: already-committed waves stay visible in
// the return value and every documented failure-degradation branch actually runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
  .replace(/^export\s+const\s+meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const runWorkflow = ({ args = {}, agent, parallel, log = () => {}, workflow, phase = () => {} }) =>
  new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC)(args, agent, parallel, log, workflow, phase)

const REPO = '/tmp/crg-fixture'
const fixArgs = { repoRoot: REPO, methodologyPath: '/tmp/METHODOLOGY.md', fix: true, fromLedger: '/tmp/ledger.json' }
const parallel = async thunks => Promise.all(thunks.map(t => t()))
const RETRY_CAP = 'agent({schema}): StructuredOutput retry cap (5) exceeded — 5 failed calls with no valid output'

// A fix-from-ledger run with exactly one bug that fixes, gates green and commits.
// `throwOn` names the label whose agent blows up with the retry-cap throw.
const stubAgent = (throwOn, trace = []) => async (_p, opts = {}) => {
  const label = opts.label || ''
  const throws = typeof throwOn === 'function' ? throwOn : l => l === throwOn
  trace.push(label)
  if (throws(label)) throw new Error(RETRY_CAP)
  if (label === 'ingest-ledger') return {
    confirmedBugs: [{ bugId: 'b1', file: 'src/alpha-widget.ts', rootCause: 'off-by-one bound', symptom: 's', whyRepro: 'w', severity: 'High' }],
    deferred: [], rejected: [],
    toolchain: [{ package: 'app', test: 'npm test', runner: 'node:test' }],
    baselineFailures: [],
  }
  if (label === 'fix-branch') return {
    branch: 'crg-debug/fix-abc123',
    results: [{ command: `git -C ${REPO} checkout -b crg-debug/fix-abc123`, exitCode: 0, stdout: '', stderr: '' }],
  }
  if (label.startsWith('fix:')) return {
    filesTouched: ['src/alpha-widget.ts'],
    fixes: [{ bugId: 'b1', testFile: 'src/alpha-widget.test.ts', testCommand: 'npm test -- alpha-widget', redObserved: true, greenObserved: true }],
  }
  if (label === 'commit:wave') return {
    commitHash: 'deadbeef123',
    committedFiles: ['src/alpha-widget.ts', 'src/alpha-widget.test.ts'],
    results: [{ command: 'git commit', exitCode: 0, stdout: '', stderr: '' }],
  }
  // Every gate (per-bug `gate:*`, the final `gate`, and `uncommit`) reports green.
  return { results: [{ command: 'npm test -- alpha-widget', exitCode: 0, stdout: '', stderr: '' }] }
}

test('a throwing FINAL gate still returns the run — committed waves are not lost', async () => {
  const res = await runWorkflow({ args: fixArgs, agent: stubAgent('gate'), parallel })
  assert.equal(res.fix.fixed.length, 1, 'the closed bug must survive the final gate failing')
  assert.equal(res.fix.commits.length, 1, 'the already-committed wave must be reported to the caller')
  assert.equal(res.fix.commits[0].hash, 'deadbeef123')
  assert.equal(res.fix.finalGate.clean, false, 'a gate that never produced results is not green')
  assert.deepEqual(res.fix.finalGate.results, [], 'the null-shape guard on the final gate must run')
})

test('a throwing branch agent degrades to working-tree-only instead of killing the run', async () => {
  const lines = []
  const res = await runWorkflow({ args: fixArgs, agent: stubAgent('fix-branch'), parallel, log: m => lines.push(m) })
  assert.equal(res.fix.fixed.length, 1, 'fixes still land when branch setup fails')
  assert.deepEqual(res.fix.commits, [], 'no commits without a fix branch')
  assert.ok(lines.some(l => /branch setup failed/.test(l)), 'the documented degradation branch must be reachable')
})

test('a throwing commit agent leaves the work in the tree instead of killing the run', async () => {
  const lines = []
  const res = await runWorkflow({ args: fixArgs, agent: stubAgent('commit:wave'), parallel, log: m => lines.push(m) })
  assert.equal(res.fix.fixed.length, 1)
  assert.deepEqual(res.fix.commits, [], 'a failed commit records nothing')
  assert.ok(lines.some(l => /commit failed — work stays in tree/.test(l)), 'the documented commit-failure branch must be reachable')
  assert.equal(res.fix.finalGate.clean, true, 'the run continues to the final gate')
})

test('a throwing per-bug gate requeues the bug rather than aborting the run', async () => {
  const res = await runWorkflow({ args: fixArgs, agent: stubAgent('gate:alpha-widget.ts'), parallel })
  assert.equal(res.fix.fixed.length, 0, 'a bug whose gate never answered must not be reported fixed')
  assert.equal(res.fix.unfixed.length, 1, 'it falls through to the coupled fallback and is reported unfixed')
})

test('a throwing fix agent leaves its bugs unfixed rather than aborting the run', async () => {
  const res = await runWorkflow({ args: fixArgs, agent: stubAgent(l => l.startsWith('fix:')), parallel })
  assert.deepEqual(res.fix.waves, [{ wave: 1, files: 1, attempted: 1, closed: 0 }], 'the wave closes nothing and is still recorded')
  assert.deepEqual(res.fix.commits, [], 'nothing an agent never reported may be committed')
})

// The textual half of the invariant: the wrappers hid bare agent() calls from the
// `await agent(` check, so the guard tests the invocation itself, not the await.
test('tryAgent is the only thing in the workflow that invokes agent()', () => {
  const code = SRC.replace(/^\s*\/\/.*$/gm, '') // comments name agent() constantly
  const start = code.indexOf('const tryAgent = ')
  const outside = code.slice(0, start) + code.slice(code.indexOf('\n}', start))
  assert.deepEqual([...outside.matchAll(/\bagent\(/g)].map(m => m.index), [])
})
