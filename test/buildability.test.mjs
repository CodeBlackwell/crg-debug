// Validates the buildability harness's control flow against the REAL crg-debug.js: the
// env-vs-code baseline split and the unfarmable early-return. The workflow can't be imported
// (the runtime evals it whole with injected globals), so — like helpers.test.mjs — we read the
// source and run its body with stubbed globals. Fast + deterministic: no Docker, LLM, or network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
  .replace(/^export\s+const\s+meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const runWorkflow = ({ args = {}, agent, parallel, log = () => {}, workflow, phase = () => {} }) =>
  new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC)(args, agent, parallel, log, workflow, phase)

const baseArgs = { repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md' }

// setup agent returning a canned SETUP_SCHEMA object with the given baseline failures.
// The Map agent returns null so the run stops there deterministically — the sentinel is
// the recorded label trace, NOT a thrown error: tryAgent contains throws by design, so a
// thrown sentinel would be swallowed and prove nothing.
const setupReturning = (failures, trace = []) => async (_p, opts = {}) => {
  trace.push(opts.label)
  if (opts.label === 'setup') return {
    graphStats: '10 files', resolvedScope: 'full repo',
    provisioned: 'built crg-env-tmp-crg-fixture', containerImage: 'crg-env-tmp-crg-fixture',
    toolchain: [{ package: 'app' }], baselineFailures: failures,
  }
  if (opts.label === 'map' || opts.label === 'map-retry') return null
  return {}
}
const NO_TARGETS = /Phase 1 \(Map\) produced no targets/

test('env=container + env-kind baseline failure → unfarmable, seeds nothing, calls setup once', async () => {
  let calls = 0
  const res = await runWorkflow({
    args: { ...baseArgs, env: 'container' },
    agent: async (p, opts = {}) => { calls++; return setupReturning([
      { command: 'uv build', error: 'not a distributable library', kind: 'env' },
    ])(p, opts) },
    parallel: async () => { throw new Error('should not reach parallel after unfarmable') },
  })
  assert.equal(res.status, 'unfarmable')
  assert.equal(res.confirmedBugs.length, 0)
  assert.equal(res.baselineFailures.length, 0)
  assert.equal(res.unresolvedEnv.length, 1)
  assert.match(res.reason, /uv build/)
  assert.equal(calls, 1, 'must bail right after the setup agent — no discovery/verify')
})

test('code-kind baseline failure does NOT trigger unfarmable — proceeds into Map', async () => {
  const trace = []
  await assert.rejects(
    runWorkflow({
      args: { ...baseArgs, env: 'container' },
      agent: setupReturning([{ command: 'tsc', error: 'src/x.ts:3 TS2322 type error', kind: 'code' }], trace),
      parallel: async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))),
    }),
    NO_TARGETS,
  )
  assert.ok(trace.includes('map'), 'a real source error must flow into discovery, not be discarded as env')
})

test('a failed Phase 0 recovers through the prose-free schema and keeps going', async () => {
  // The 2026-08-13 platform run died here: the setup agent leaked `toolchain` into
  // `resolvedScope`'s string and the run threw away a completed graph build. Now the full
  // submit failing is survivable — the lean retry re-reports the required fields.
  const trace = []
  await assert.rejects(
    runWorkflow({
      args: baseArgs,
      agent: async (_p, opts = {}) => {
        trace.push(opts.label)
        if (opts.label === 'setup') return null // the leak: full submit never validates
        if (opts.label === 'setup-retry') return {
          graphStats: '10 files', toolchain: [{ package: 'app' }], baselineFailures: [],
        }
        if (opts.label === 'map' || opts.label === 'map-retry') return null
        return {}
      },
      parallel: async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))),
    }),
    NO_TARGETS, // reached Phase 1 — so Phase 0 recovered rather than aborting
  )
  assert.deepEqual(trace.slice(0, 2), ['setup', 'setup-retry'])
})

test('both setup attempts failing still aborts with the Phase 0 message', async () => {
  const trace = []
  await assert.rejects(
    runWorkflow({
      args: baseArgs,
      agent: async (_p, opts = {}) => { trace.push(opts.label); return null },
      parallel: async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))),
    }),
    /Phase 0 \(Graph\) setup agent failed/,
  )
  assert.deepEqual(trace, ['setup', 'setup-retry'])
})

test('a failed Map falls back to the single-property retry before giving up', async () => {
  // The 2026-08-13 regression: a two-property StructuredOutput submit the model could not
  // serialize killed the whole run. Now the phase re-asks for targets alone, and only a
  // second empty result aborts — with a message about targets, not a raw harness error.
  const trace = []
  await assert.rejects(
    runWorkflow({
      args: baseArgs,
      agent: setupReturning([], trace),
      parallel: async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))),
    }),
    NO_TARGETS,
  )
  assert.deepEqual(trace.filter(l => l.startsWith('map')), ['map', 'map-retry'])
})

test('env=none (standalone default) still classifies — an env-kind failure is unfarmable, not a bug', async () => {
  const res = await runWorkflow({
    args: baseArgs, // env omitted -> 'none'
    agent: setupReturning([{ command: 'pytest', error: 'ModuleNotFoundError: numpy (not installed)', kind: 'env' }]),
    parallel: async () => { throw new Error('unreachable') },
  })
  assert.equal(res.status, 'unfarmable')
})

test('clean baseline (no failures) proceeds normally', async () => {
  const trace = []
  await assert.rejects(
    runWorkflow({
      args: { ...baseArgs, env: 'container' },
      agent: setupReturning([], trace),
      parallel: async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))),
    }),
    NO_TARGETS,
  )
  assert.ok(trace.includes('map'))
})
