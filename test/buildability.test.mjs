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
const setupReturning = failures => async (_p, opts = {}) => {
  if (opts.label === 'setup') return {
    graphStats: '10 files', resolvedScope: 'full repo',
    provisioned: 'built crg-env-tmp-crg-fixture', containerImage: 'crg-env-tmp-crg-fixture',
    toolchain: [{ package: 'app' }], baselineFailures: failures,
  }
  if (opts.label === 'map') throw new Error('REACHED_MAP') // sentinel: proves we passed the early-return
  return {}
}

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
  await assert.rejects(
    runWorkflow({
      args: { ...baseArgs, env: 'container' },
      agent: setupReturning([{ command: 'tsc', error: 'src/x.ts:3 TS2322 type error', kind: 'code' }]),
      parallel: async thunks => Promise.all(thunks.map(t => t())),
    }),
    /REACHED_MAP/,
    'a real source error must flow into discovery, not be discarded as env',
  )
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
  await assert.rejects(
    runWorkflow({
      args: { ...baseArgs, env: 'container' },
      agent: setupReturning([]),
      parallel: async thunks => Promise.all(thunks.map(t => t())),
    }),
    /REACHED_MAP/,
  )
})
