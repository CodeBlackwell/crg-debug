import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects the user-facing outcome of a crg-integrations REPAIR run whose regression
// gate agent dies: the run still finishes and still writes the repair ledger, so the
// human is never left with fixes merged onto an orphaned run branch and no record of
// which clusters landed there.
//
// `agent()` returns null for some failures but THROWS for others (a schema-gated call
// that exhausts its StructuredOutput retry cap). Every guard in this workflow is
// written for the null shape (`if (!x)`, `.filter(Boolean)`), so a throw at any of the
// 11 top-level `await agent(` sites walks past all of them and discards work that has
// already happened — worst at Phase 9, after the worktree diffs are on the branch and
// the graph has been re-ingested, but before Phase 10 records any of it.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-integrations.js', import.meta.url)), 'utf8')

// A declaration's full text, from `const NAME` to where its brackets balance.
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

// ---- run the REAL workflow body with the sandbox globals faked -------------------
// The workflow is evaled whole by the runtime (top-level await + top-level return),
// not imported, so the test re-creates that shape instead of importing it.

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
// The runtime resolves a failed parallel() thunk to null — hence the `.filter(Boolean)`
// idiom at every call site. Mirror that, so this test isolates the top-level sites.
const parallel = thunks => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)))
const runWorkflow = (args, agent, log = () => {}) =>
  new AsyncFunction('args', 'agent', 'log', 'parallel', src.replace('export const meta', 'const meta'))(
    args, agent, log, parallel,
  )

const CLUSTER = {
  clusterId: 'cl-001',
  class: 'regression',
  testName: 'mounts',
  signature: 'toBeAttached failed',
  hosts: ['astro'],
  cells: [{ host: 'astro', test: 'mounts', testName: 'mounts', scenario: 'basic', error: 'toBeAttached failed', count: 1 }],
}

const repairArgs = {
  repoRoot: '/repo',
  methodologyPath: '/skills/crg-integrations.methodology.md',
  approvedClusters: [CLUSTER],
  maxAttempts: 1,
  profile: {
    project: 'demo',
    oracleHost: 'oracle',
    grepTemplate: '{test}',
    commands: { singleCell: 'npx test --host {host} --grep {grep}', fullRun: 'npx test --workers {workers}' },
    fences: { allow: ['adapters/{host}/**'], forbid: [], sharedNeedsGate: [] },
    concurrency: { serializeVerify: false },
  },
}

// A repair run that reaches Phase 9 with one green fix; `gate` decides what the
// regression-gate agent does. Returns the run's result plus the labels seen.
const repairRun = async gate => {
  const calls = []
  const agent = async (prompt, opts) => {
    const label = (opts && opts.label) || ''
    calls.push(label)
    if (label.startsWith('diagnose:')) {
      return { rootCause: 'adapter drops the mount hook', evidence: ['x'], allowedEdits: ['adapters/astro/mount.ts'], successCriterion: 'cell green', sharedFilesNeeded: [] }
    }
    if (label.startsWith('fix:')) return { worktree: '/repo/.crg-integrations/worktrees/cl-001', filesTouched: ['adapters/astro/mount.ts'], failureSignature: 'toBeAttached failed' }
    if (label.startsWith('verify:')) return { result: { command: 'npx test', exitCode: 0, stdout: '1 passed', stderr: '' } }
    if (label === 'regression-gate') return gate()
    return {}
  }
  const result = await runWorkflow(repairArgs, agent)
  return { result, calls }
}

test('a repair run whose regression gate agent THROWS still finishes and records the fix', async () => {
  const { result, calls } = await repairRun(() => {
    throw new Error('agent({schema}): StructuredOutput retry cap (5) exceeded — 5 failed calls with no valid output')
  })
  assert.equal(result.status, 'ok')
  assert.equal(result.mode, 'repair')
  // Phase 10 must run: the ledger write is the ONLY record of what landed on the branch.
  assert.ok(calls.includes('persist-repair'), 'Phase 10 never wrote the repair ledger')
  // The verified-green cluster must appear in the record, not vanish with the throw.
  const recorded = [...result.fixed, ...result.unfixed].filter(x => x.clusterId === 'cl-001')
  assert.equal(recorded.length, 1, 'the green cluster is missing from both fixed[] and unfixed[]')
  // And it must say the GATE failed — not the misleading "diff did not merge".
  if (result.unfixed.length) assert.match(result.unfixed[0].reason, /gate/i)
})

test('a green regression gate is unaffected — the fix is reported fixed on its branch', async () => {
  const { result } = await repairRun(() => ({ branch: 'crg-integrations/fix-0813', merged: ['cl-001'], results: [], newlyRed: [], crgUpdated: true }))
  assert.deepEqual(result.fixed.map(f => f.clusterId), ['cl-001'])
  assert.equal(result.fixed[0].branch, 'crg-integrations/fix-0813')
  assert.deepEqual(result.unfixed, [])
})

// ---- containment is file-wide, not one patched call site -------------------------

test('crg-integrations.js calls agent() only through tryAgent', () => {
  const decl = declOf(src, 'tryAgent')
  assert.ok(decl, 'tryAgent is missing — every top-level agent() call is unguarded')
  const outside = src.replace(decl, '')
  // Matches the call, not the await: `const diagnose = cl => agent(` is just as unguarded
  // as `await agent(`, and an /await agent\(/ probe cannot see it.
  const bare = [...outside.matchAll(/\bagent\(\s*\n?\s*`/g)]
  assert.equal(bare.length, 0, `${bare.length} unguarded agent( call(s) — route them through tryAgent`)
  assert.equal([...decl.matchAll(/await agent\(/g)].length, 1, 'tryAgent must wrap exactly one agent() call')
})

test('tryAgent is defined before the first call site', () => {
  assert.ok(src.indexOf('const tryAgent = ') < src.indexOf('await tryAgent('), 'tryAgent used before definition')
})

test('tryAgent turns both failure shapes into null and logs the label', async () => {
  const build = (agent, log = () => {}) =>
    new AsyncFunction('agent', 'log', 'capText', `${declOf(src, 'tryAgent')}\nreturn tryAgent`)(
      agent, log, (s, n) => String(s == null ? '' : s).trim().slice(0, n),
    )
  assert.deepEqual(await (await build(async () => ({ ok: 1 })))('p', { label: 'graph' }), { ok: 1 })
  assert.equal(await (await build(async () => null))('p', { label: 'graph' }), null)
  const lines = []
  const tryAgent = await build(async () => { throw new Error('retry cap (5) exceeded') }, m => lines.push(m))
  assert.equal(await tryAgent('p', { label: 'regression-gate' }), null)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /regression-gate/)
  assert.match(lines[0], /retry cap/)
})
