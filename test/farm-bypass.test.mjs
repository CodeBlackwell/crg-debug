// Control-flow tests for the REAL workflows/crg-debug.farm-bypass.js. The workflow can't be
// imported (the runtime evals it whole with injected globals), so — like buildability.test.mjs —
// we read the source and run its body with stubbed globals. No LLM, network, or git.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.farm-bypass.js', import.meta.url)), 'utf8')
  .replace(/^export\s+const\s+meta/m, 'const meta')
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const runWorkflow = ({ args, agent, workflow, parallel = async thunks => Promise.all(thunks.map(t => t())), log = () => {}, phase = () => {} }) =>
  new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC)(args, agent, parallel, log, workflow, phase)

const REPO = 'acme/widget'
const baseArgs = {
  direction: 'scoped',
  repo: REPO,
  methodologyPath: '/tmp/METHODOLOGY.md',
  crgDebugPath: '/tmp/crg-debug.js',
  farmDbPath: '/tmp/farm-db.mjs',
  reposRoot: '/tmp/repos',
  farmRunId: 'test-run',
}
const BUG = { bugId: 'b1', file: 'src/auth.js:10', rootCause: 'auth bypass' }

// One agent stub driven by label, with per-test overrides. Every label the run touches has a
// schema-valid default so a test only states the thing it is actually about.
const makeAgent = (overrides = {}, labels = []) => async (_prompt, opts = {}) => {
  const label = opts.label || ''
  labels.push(label)
  if (Object.prototype.hasOwnProperty.call(overrides, label)) {
    const v = overrides[label]
    return typeof v === 'function' ? v() : v
  }
  const kind = label.split(':')[0]
  if (kind === 'recon') return { fresh: [{ repo: REPO, issueRef: '#1', title: 'bug title', url: 'https://x' }], dropped: [] }
  if (kind === 'clone') return { repoRoot: '/tmp/repos/acme/widget' }
  if (kind === 'sec-classify') return { securitySensitive: false }
  if (kind === 'tier') return { tier: 'haiku' }
  if (kind === 'slice') return { ledgerPath: '/tmp/repos/acme/widget/.crg-debug/retry.json' }
  if (kind === 'advisory') return { reportPath: '/tmp/advisories/report.md' }
  if (kind === 'pr') return { prUrl: 'https://github.com/acme/widget/pull/9', branch: 'crg-farm/-1' }
  return { logged: true }
}

// workflow(): first call is the --detect-only triage, later calls are the fix passes.
const makeWorkflow = (fixResult, calls = []) => async (_spec, wargs) => {
  calls.push(wargs)
  if (!wargs.fix) return { ledgerPath: '/tmp/repos/acme/widget/.crg-debug/ledger.json', confirmedBugs: [BUG] }
  return typeof fixResult === 'function' ? fixResult(calls.length) : fixResult
}

// b0 — a security classification that never came back must NOT be read as "not security":
// an unclassified bug stays off the unattended commit/push/public-draft-PR pipeline.
test('b0: an absent security classification falls back to the advisory track, never a PR', async () => {
  const labels = []
  const res = await runWorkflow({
    args: baseArgs,
    agent: makeAgent(
      {
        [`sec-classify:${REPO}`]: null, // transient failure / no structured output
        [`sec-assess:${REPO}`]: {
          pocVerdict: 'inconclusive-could-not-execute',
          reachability: 'remote-unauthenticated',
          marginalRiskSmall: false,
          fixMechanical: false,
          contribPolicyForbidsDirectPR: false,
        },
      },
      labels,
    ),
    workflow: makeWorkflow({ fix: { fixed: [BUG], unfixed: [], finalGate: { clean: true } } }),
  })

  assert.equal(res.shipped.length, 0, 'an unclassified bug must never reach the PR pipeline')
  assert.ok(!labels.some(l => l.startsWith('pr:')), 'no branch may be pushed or draft PR opened')
  assert.ok(labels.includes(`sec-assess:${REPO}`), 'must run the advisory track PoC/exploit-path assessment')
  assert.equal(res.advisories.length, 1)
  assert.equal(res.advisories[0].outcome, 'advisory-compiled')
})

// b2 — the user's --maxTier cap is absolute: no fix pass may run above it, and a capped run
// never falls through to the uncapped session model.
test('b2: the recommended start tier is clamped to maxTier and the cap ends escalation', async () => {
  const calls = []
  const res = await runWorkflow({
    args: { ...baseArgs, maxTier: 'sonnet' },
    agent: makeAgent({ [`tier:${REPO}`]: { tier: 'opus' } }),
    // Gate clean but one bug unfixed — the unfixed-escalation path.
    workflow: makeWorkflow({ fix: { fixed: [], unfixed: [BUG], finalGate: { clean: true } } }, calls),
  })

  const fixPasses = calls.filter(c => c.fix)
  assert.ok(fixPasses.length >= 1, 'expected at least one fix pass')
  for (const c of fixPasses) {
    assert.ok(['haiku', 'sonnet'].includes(c.model), `fix pass ran at "${c.model}" — above the sonnet cap or unset`)
  }
  assert.equal(fixPasses.length, 1, 'a run already at the cap must hand off, not escalate again')
  assert.equal(res.handedOff.length, 1)
  assert.match(res.handedOff[0].reason, /tier cap/)
})

// b7 — a best-effort telemetry close must never annihilate the run's only report of what shipped.
test('b7: a failing run-close log does not discard the run result', async () => {
  const res = await runWorkflow({
    args: baseArgs,
    agent: makeAgent({
      'run:close': () => { throw new Error('agent({schema}): StructuredOutput retry cap (5) exceeded') },
    }),
    workflow: makeWorkflow({ fix: { fixed: [BUG], unfixed: [], finalGate: { clean: true } } }),
  })

  assert.equal(res.shipped.length, 1, 'the shipped draft PR must still be reported')
  assert.equal(res.shipped[0].prUrl, 'https://github.com/acme/widget/pull/9')
  assert.deepEqual(res.errored, [])
})

// b7 — same containment for the top-level recon bookkeeping, which sits on the same path.
test('b7: a failing recon bookkeeping log does not abort the run', async () => {
  const res = await runWorkflow({
    args: baseArgs,
    agent: makeAgent({
      'recon:log': () => { throw new Error('agent({schema}): StructuredOutput retry cap (5) exceeded') },
      'stage:run:recon-done': () => { throw new Error('agent({schema}): StructuredOutput retry cap (5) exceeded') },
    }),
    workflow: makeWorkflow({ fix: { fixed: [BUG], unfixed: [], finalGate: { clean: true } } }),
  })

  assert.equal(res.shipped.length, 1)
})
