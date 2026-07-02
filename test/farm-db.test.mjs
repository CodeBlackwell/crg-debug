import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'farm-db-'))
  process.env.CRG_FARM_DB = join(dir, 'nested', 'history.jsonl') // nested → tests mkdir
})
after(() => rmSync(dir, { recursive: true, force: true }))

// Imported AFTER the env var is set so dbPath() resolves to the temp file.
const { append, query, queryAll, dbPath, closeRun, backfillRunEnds, gateWaits, compact, reconcile, advisoryPath, advisoryRoot } =
  await import('../lib/farm-db.mjs')

test('append round-trips and stamps ts', () => {
  const r = append({ type: 'run', repo: 'numpy', farmRunId: 'f1' })
  assert.equal(r.type, 'run')
  assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(query({ type: 'run' }).length, 1)
})

test('query filters by type/repo/keyOf', () => {
  append({ type: 'candidate', repo: 'numpy', keyOf: 'a.py::bug', farmRunId: 'f1' })
  append({ type: 'candidate', repo: 'sqlalchemy', keyOf: 'b.py::bug', farmRunId: 'f1' })
  assert.equal(query({ type: 'candidate' }).length, 2)
  assert.equal(query({ type: 'candidate', repo: 'numpy' }).length, 1)
  assert.equal(query({ keyOf: 'b.py::bug' })[0].repo, 'sqlalchemy')
})

test('cross-run dedup: a keyOf already shipped to a pr is detectable', () => {
  append({ type: 'pr', repo: 'numpy', keyOf: 'a.py::bug', url: 'http://pr/1', state: 'draft' })
  const shipped = new Set(query({ type: 'pr' }).map(r => r.keyOf))
  assert.ok(shipped.has('a.py::bug'))
  assert.ok(!shipped.has('b.py::bug'))
})

test('many appends stay one-line-per-record (no corruption)', () => {
  for (let i = 0; i < 50; i++) append({ type: 'gate', gate: 'GATE-DIFF', n: i })
  const lines = readFileSync(dbPath(), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) JSON.parse(line) // every line must parse
  assert.equal(query({ type: 'gate' }).length, 50)
})

test('query on a missing db returns []', () => {
  process.env.CRG_FARM_DB = join(dir, 'does-not-exist.jsonl')
  assert.deepEqual(query({ type: 'run' }), [])
})

test('closeRun stamps durationMs from the matching run record', () => {
  process.env.CRG_FARM_DB = join(dir, 'close-run.jsonl')
  const run = append({ type: 'run', farmRunId: 'f2' })
  const end = closeRun('f2', new Date(new Date(run.ts).getTime() + 1000).toISOString())
  assert.equal(end.type, 'run-end')
  assert.equal(end.startedAt, run.ts)
  assert.equal(end.durationMs, 1000)
})

test('closeRun throws when no run record exists for the farmRunId', () => {
  process.env.CRG_FARM_DB = join(dir, 'close-run-missing.jsonl')
  assert.throws(() => closeRun('no-such-run'))
})

test('backfillRunEnds reconstructs endedAt from the latest ts per farmRunId, skipping already-closed runs', () => {
  process.env.CRG_FARM_DB = join(dir, 'backfill.jsonl')
  append({ type: 'run', farmRunId: 'old-1' })
  append({ type: 'candidate', farmRunId: 'old-1' })
  const lastGate = append({ type: 'gate', farmRunId: 'old-1' })
  const run2 = append({ type: 'run', farmRunId: 'old-2' })
  closeRun('old-2') // already closed — must not be re-backfilled

  const results = backfillRunEnds()
  assert.equal(results.length, 1)
  assert.equal(results[0].farmRunId, 'old-1')
  assert.equal(results[0].endedAt, lastGate.ts)
  assert.equal(results[0].backfilled, true)
  assert.equal(query({ type: 'run-end', farmRunId: 'old-2' }).length, 1)
})

test('gateWaits pairs a decision with the gate-asked logged right before it, per repo', () => {
  process.env.CRG_FARM_DB = join(dir, 'gate-waits.jsonl')
  const askedA = append({ type: 'gate-asked', farmRunId: 'f3', gate: 'GATE-DIFF', repo: 'a' })
  const askedB = append({ type: 'gate-asked', farmRunId: 'f3', gate: 'GATE-DIFF', repo: 'b' })
  const decidedB = append({ type: 'gate', farmRunId: 'f3', gate: 'GATE-DIFF', repo: 'b', decision: 'approve-for-PR' })
  const decidedA = append({ type: 'gate', farmRunId: 'f3', gate: 'GATE-DIFF', repo: 'a', decision: 'approve-for-PR' })

  const waits = gateWaits({ farmRunId: 'f3' })
  const waitFor = repo => waits.find(w => w.repo === repo)
  assert.equal(waitFor('a').askedAt, askedA.ts)
  assert.equal(waitFor('a').decidedAt, decidedA.ts)
  assert.equal(waitFor('b').askedAt, askedB.ts)
  assert.equal(waitFor('b').decidedAt, decidedB.ts)
  assert.ok(waitFor('a').waitMs >= 0)
})

test('gateWaits leaves waitMs null when no matching gate-asked was logged', () => {
  process.env.CRG_FARM_DB = join(dir, 'gate-waits-unmatched.jsonl')
  append({ type: 'gate', farmRunId: 'f4', gate: 'GATE-RECON', decision: 'approve-all' })
  const [w] = gateWaits({ farmRunId: 'f4' })
  assert.equal(w.askedAt, undefined)
  assert.equal(w.waitMs, null)
})

test('compact archives closed-run telemetry, keeps durable + open-run records live', () => {
  process.env.CRG_FARM_DB = join(dir, 'compact-basic.jsonl')
  // closed run c1: telemetry + durable records
  append({ type: 'run', farmRunId: 'c1' })
  append({ type: 'candidate', farmRunId: 'c1', repo: 'r', keyOf: 'k1' })
  append({ type: 'gate', farmRunId: 'c1', gate: 'GATE-DIFF' })
  append({ type: 'pr', farmRunId: 'c1', repo: 'r', keyOf: 'k1', url: 'u', state: 'draft' })
  append({ type: 'buildability', farmRunId: 'c1', repo: 'r', env: 'container', verdict: 'unfarmable' })
  closeRun('c1')
  // open run o1: never a run-end
  append({ type: 'run', farmRunId: 'o1' })
  append({ type: 'candidate', farmRunId: 'o1', repo: 'r2', keyOf: 'k2' })

  const res = compact()
  // durable stays live
  assert.equal(query({ type: 'pr' }).length, 1)
  assert.equal(query({ type: 'buildability' }).length, 1)
  // open run untouched
  assert.equal(query({ type: 'candidate', farmRunId: 'o1' }).length, 1)
  assert.equal(query({ type: 'run', farmRunId: 'o1' }).length, 1)
  // closed-run telemetry left the live file
  assert.equal(query({ type: 'candidate', farmRunId: 'c1' }).length, 0)
  assert.equal(query({ type: 'gate', farmRunId: 'c1' }).length, 0)
  assert.equal(query({ type: 'run', farmRunId: 'c1' }).length, 0)
  // but is preserved in the archive
  assert.equal(queryAll({ type: 'candidate', farmRunId: 'c1' }).length, 1)
  assert.equal(queryAll({ type: 'gate', farmRunId: 'c1' }).length, 1)
  assert.ok(res.archived >= 3)
})

test('compact is lossless: live ∪ archive equals every record ever appended', () => {
  process.env.CRG_FARM_DB = join(dir, 'compact-lossless.jsonl')
  const N = 20
  for (let i = 0; i < N; i++) append({ type: 'run', farmRunId: 'L' + i })
  for (let i = 0; i < N; i++) append({ type: 'candidate', farmRunId: 'L' + i, keyOf: 'k' + i })
  for (let i = 0; i < N; i++) closeRun('L' + i)
  const before = reconcile().total
  compact()
  const r = reconcile()
  assert.equal(r.total, before) // nothing lost
  assert.ok(r.archive > 0) // something moved
  assert.equal(r.byType.candidate, N) // all candidates still counted (now in archive)
})

test('compact keeps dedup working: a shipped pr keyOf stays queryable live', () => {
  process.env.CRG_FARM_DB = join(dir, 'compact-dedup.jsonl')
  append({ type: 'run', farmRunId: 'd1' })
  append({ type: 'pr', farmRunId: 'd1', repo: 'numpy', keyOf: 'a.py::bug', url: 'u', state: 'draft' })
  closeRun('d1')
  compact()
  const shipped = new Set(query({ type: 'pr' }).map(r => r.keyOf))
  assert.ok(shipped.has('a.py::bug'))
})

test('compact on a missing db is a no-op', () => {
  process.env.CRG_FARM_DB = join(dir, 'compact-missing.jsonl')
  assert.deepEqual(compact(), { archived: 0, kept: 0 })
})

test('gateWaits still pairs decisions after their gate records were archived', () => {
  process.env.CRG_FARM_DB = join(dir, 'compact-gatewaits.jsonl')
  append({ type: 'run', farmRunId: 'g1' })
  const asked = append({ type: 'gate-asked', farmRunId: 'g1', gate: 'GATE-DIFF', repo: 'a' })
  const decided = append({ type: 'gate', farmRunId: 'g1', gate: 'GATE-DIFF', repo: 'a', decision: 'approve-for-PR' })
  closeRun('g1')
  compact()
  assert.equal(query({ type: 'gate', farmRunId: 'g1' }).length, 0) // archived out of live
  const [w] = gateWaits({ farmRunId: 'g1' })
  assert.equal(w.askedAt, asked.ts)
  assert.equal(w.decidedAt, decided.ts)
  assert.ok(w.waitMs >= 0)
})

test('advisoryPath is deterministic and stays under CRG_FARM_ADVISORIES', () => {
  const root = join(dir, 'advisories')
  process.env.CRG_FARM_ADVISORIES = root
  const p1 = advisoryPath('NixOS/nix-security-tracker', 'src/shared/git.py::shell injection via object_sha1')
  const p2 = advisoryPath('NixOS/nix-security-tracker', 'src/shared/git.py::shell injection via object_sha1')
  assert.equal(p1, p2)
  assert.ok(p1.startsWith(root))
  assert.ok(p1.endsWith('.md'))
  assert.ok(!p1.includes('..'))
  assert.notEqual(p1, advisoryPath('NixOS/nix-security-tracker', 'other-bug'))
  delete process.env.CRG_FARM_ADVISORIES
})

test('advisoryRoot defaults under ~/.claude/crg-farm/advisories when CRG_FARM_ADVISORIES is unset', () => {
  delete process.env.CRG_FARM_ADVISORIES
  assert.ok(advisoryRoot().endsWith(join('.claude', 'crg-farm', 'advisories')))
})
