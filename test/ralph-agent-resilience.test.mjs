import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects the user-facing guarantee that a crg-ralph build which rejects its own commit
// still UNDOES it and returns the documented {status:'built', commitFailed} result — a
// failure inside the un-commit agent must never abort the run and strand an out-of-fence
// commit on the crg-ralph/build-* branch.
//
// `agent()` THROWS (it does not return null) when a schema-gated call exhausts its
// StructuredOutput retry cap, and every guard in this workflow was written for the null
// shape. So one serialization glitch in `uncommitAgent()` walked past the dirtyStop
// assignment, past commits.push({commitFailed:true}), and out of the whole workflow.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-ralph.js', import.meta.url)), 'utf8')
const debugSrc = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')

// The workflow is a top-level script run in a sandbox with `args`/`agent`/`log`/`parallel`
// injected; `export const meta` is the only ESM syntax, so it becomes a plain const here.
const runWorkflow = (args, agent, log = () => {}) =>
  new Function(
    'args', 'agent', 'log', 'parallel',
    `return (async () => {\n${src.replace('export const meta', 'const meta')}\n})()`,
  )(args, agent, log, thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))))

const ARGS = {
  repoRoot: '/repo',
  methodologyPath: '/skills/crg-ralph/SKILL.md',
  planToolPath: '/skills/crg-ralph/crg-ralph.plan.mjs',
  build: true,
  fromPlan: '/repo/.crg-ralph/plan.json',
  approvedStoryIds: ['s1'],
  model: 'opus',
  profile: { project: 'demo', toolchain: [{ package: '.', test: 'npm test' }] },
}

const STORY = {
  id: 's1',
  title: 'add the widget module',
  story: 'Add a widget module.',
  checklist: ['the widget module exists'],
  files: ['src/a.js'],
  claimedNew: [],
  fence: ['src/a.js'],
  dependsOn: [],
  acceptanceCriteria: [{ kind: 'command', check: 'npm test' }],
}

const row = (command, stdout = '') => ({ command, exitCode: 0, stdout, stderr: '' })

// A build that goes green all the way to the commit, whose commit then lands a file
// OUTSIDE the fence allowlist — the exact input that reaches `await uncommitAgent()`.
const RETRY_CAP = 'agent({schema}): StructuredOutput retry cap (5) exceeded — 5 failed calls with no valid output'

const makeAgent = ({
  porcelainAfterCommit = '', calls, throwOn = ['uncommit'],
  toolchain = [{ package: '.', test: 'npm test' }], waveGateRows,
  landedFiles = 'src/a.js\nsecrets/prod.env', committedMessage,
} = {}) => async (_prompt, opts) => {
  const label = (opts && opts.label) || ''
  calls.push(label)
  if (throwOn.includes(label)) throw new Error(RETRY_CAP)
  if (label === 'uncommit') return { results: [row('git -C /repo reset --mixed HEAD~1')] }
  if (label === 'gate:wave' && waveGateRows) return { results: waveGateRows }
  if (label === 'ingest-plan') {
    return { stories: [STORY], toolchain, invariants: '', offLimits: [], project: 'demo' }
  }
  if (label === 'build-branch') {
    return { results: [
      row('git -C /repo rev-parse --abbrev-ref HEAD', 'main'),
      row('git -C /repo checkout -b crg-ralph/build-x'),
      row('git -C /repo status --porcelain'),
    ] }
  }
  if (label === 'build:s1') {
    return {
      filesTouched: ['src/a.js'],
      stale: false,
      criteriaResults: [{ kind: 'command', check: 'npm test', redObserved: true, greenObserved: true }],
    }
  }
  if (label === 'gate:s1' || label === 'gate:wave') return { results: [row('npm test', 'ok')] }
  if (label === 'commit:wave') {
    return { results: [
      row('git -C /repo add -- "src/a.js"'),
      row('git -C /repo commit -m "demo: add the widget module"'),
      row('git -C /repo rev-parse HEAD', 'abc1234567890'),
      // The commit landed a file no story's fence allows — verification must reject it.
      row('git -C /repo diff-tree --no-commit-id --name-only -r HEAD', landedFiles),
      row('git -C /repo status --porcelain', porcelainAfterCommit),
    ], committedMessage }
  }
  return null
}

test('a thrown un-commit agent still yields the documented commit-failed result', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls }))
  assert.equal(result.status, 'built')
  assert.ok(calls.includes('uncommit'), 'the out-of-fence commit must be un-committed')
  assert.equal(result.commits.length, 1)
  assert.equal(result.commits[0].commitFailed, true)
  assert.equal(result.commits[0].hash, '')
  assert.equal(result.built[0].commit, '', 'the story stays recorded, uncommitted')
})

test('a thrown un-commit agent still records the dirty-tree stop', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls, porcelainAfterCommit: ' M other/stray.js' }))
  assert.equal(result.status, 'built')
  assert.match(String(result.dirtyStop), /unaccounted edits/)
})

// A dead un-commit agent is not evidence the commit was undone. Reporting only
// commitFailed makes it indistinguishable from "never committed", while the rejected
// commit is still sitting on the build branch for the human who was told it was not.
test('an un-commit that never reported is recorded as unconfirmed, not as undone', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls }))
  assert.equal(result.commits[0].uncommitFailed, true)
  assert.match(String(result.dirtyStop), /un-commit of abc123456 was never confirmed/)
  assert.match(String(result.dirtyStop), /crg-ralph\/build-/, 'the stop must name the branch to inspect')
})

test('a confirmed un-commit is recorded as such and raises no stop', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls, throwOn: [] }))
  assert.ok(calls.includes('uncommit'))
  assert.equal(result.commits[0].uncommitFailed, false)
  assert.equal(result.dirtyStop, undefined, 'a clean un-commit of a rejected commit is not a reason to stop')
})

// The commit agent runs add/commit/rev-parse BEFORE it reports, so a dead relay most
// likely means a commit LANDED that no script verdict — allowlist, porcelain, message —
// ever ran on. Reading that as "commit failed, nothing happened" lets later waves stack
// commits on top of an unverified one.
test('a thrown commit agent stops the build instead of continuing on an unverified tree', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls, throwOn: ['commit:wave'] }))
  assert.equal(result.status, 'built')
  assert.equal(result.commits[0].commitUnverified, true)
  assert.equal(result.commits[0].commitFailed, true)
  assert.ok(!calls.includes('uncommit'), 'nothing is known to un-commit — do not guess')
  assert.match(String(result.dirtyStop), /commit agent died before reporting/)
})

// `waveClean` falls back to "was anything in scope?" when the gate reports no rows. That
// is right for a gate with nothing to run and wrong for a gate that died — both are silent.
test('a thrown wave gate holds the wave instead of committing it', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls, throwOn: ['gate:wave'] }))
  assert.equal(result.status, 'built')
  assert.ok(!calls.includes('commit:wave'), 'a wave whose gate never reported must not commit')
  assert.equal(result.built[0].waveGateRed, true)
  assert.deepEqual(result.commits, [])
})

// Two independent guards keep a silent gate red, and the case above is held by either one
// alone. These pin them separately, so removing one cannot hide behind the other.
test('a thrown wave gate is red even when nothing touched is in a gate package', async () => {
  const calls = []
  const toolchain = [{ package: 'other', test: 'npm test' }] // src/a.js is NOT under it
  const result = await runWorkflow({ ...ARGS, profile: { ...ARGS.profile, toolchain } },
    makeAgent({ calls, throwOn: ['gate:wave'], toolchain }))
  assert.ok(!calls.includes('commit:wave'), 'out of scope explains an EMPTY gate, never a DEAD one')
  assert.equal(result.built[0].waveGateRed, true)
})

test('a live wave gate that runs nothing is red when the repo root is the gate package', async () => {
  const calls = []
  const result = await runWorkflow(ARGS, makeAgent({ calls, throwOn: [], waveGateRows: [] }))
  assert.ok(!calls.includes('commit:wave'),
    "package '.' covers every touched file, so zero rows means the gate did not run")
  assert.equal(result.built[0].waveGateRed, true)
})

// ---- every agent call in crg-ralph.js is contained -------------------------------
// The defect is not one missing guard: no call in the file had one, while the whole file
// is written as if agent() only ever returns null.

const declOf = (text, name) => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(text)
  if (!m) return null
  let depth = 0
  for (let i = m.index; i < text.length; i++) {
    const c = text[i]
    if ('{(['.includes(c)) depth++
    else if ('})]'.includes(c)) depth--
    else if (c === '\n' && depth === 0) return text.slice(m.index, i)
  }
  return text.slice(m.index)
}

test('crg-ralph.js calls agent() only through tryAgent', () => {
  const decl = declOf(src, 'tryAgent')
  assert.ok(decl, 'crg-ralph.js must declare tryAgent')
  const outside = src.replace(decl, '')
  assert.equal([...outside.matchAll(/\bagent\(\s*\n?\s*`/g)].length, 0, 'unguarded agent() call(s) — route them through tryAgent')
  assert.equal([...decl.matchAll(/await agent\(/g)].length, 1, 'tryAgent must wrap exactly one agent() call')
  assert.ok(src.indexOf('const tryAgent = ') < src.indexOf('await tryAgent('), 'tryAgent must be declared before its first call site')
})

test('tryAgent is byte-identical to the crg-debug.js original', () => {
  assert.equal(declOf(src, 'tryAgent'), declOf(debugSrc, 'tryAgent'))
})

// A live commit agent appended "Co-Authored-By: Claude" to every commit; the script read back
// the files and never the message. A commit whose message is not the composed one is undone.
test('a wave commit whose message is not the composed one is undone, like a stray-file commit', async () => {
  const composed = 'demo: add the widget module\n'
  const good = await runWorkflow(ARGS, makeAgent({ calls: [], throwOn: [], landedFiles: 'src/a.js', committedMessage: composed }))
  assert.equal(good.commits[0].commitFailed, undefined, 'the composed message lands as a commit')
  assert.equal(good.commits[0].hash, 'abc1234567890')

  const calls = []
  const logs = []
  const trailer = `${composed}\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>\n`
  const bad = await runWorkflow(ARGS, makeAgent({ calls, throwOn: [], landedFiles: 'src/a.js', committedMessage: trailer }), m => logs.push(m))
  assert.equal(bad.commits[0].commitFailed, true)
  assert.equal(bad.commits[0].hash, '')
  assert.ok(calls.includes('uncommit'), 'and it is taken back')
  assert.ok(logs.some(m => /the message that landed is not the one composed/.test(m)), 'the log names the message')

  const silent = await runWorkflow(ARGS, makeAgent({ calls: [], throwOn: [], landedFiles: 'src/a.js' }))
  assert.equal(silent.commits[0].commitFailed, true, 'a message reported as nothing is not the composed one')
})

test('the commit brief forbids a trailer and asks for the message that landed', () => {
  assert.ok(src.includes('add NO trailer: no Co-Authored-By') && src.includes('log -1 --format=%B HEAD'))
})
