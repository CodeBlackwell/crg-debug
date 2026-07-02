// Append-only JSONL record of all /crg-farm work, global across repos and runs.
// Durable memory the per-run .crg-debug/ledger.json is not: candidate dedup, PR
// outcomes, gate audit trail. One JSON object per line, type-tagged.
//   node farm-db.mjs append           < record.json          (stdout: the stored record)
//   node farm-db.mjs query '<filter>'                        (stdout: JSONL of matches, LIVE file)
//   node farm-db.mjs compact                                 (lossless: archive closed-run telemetry)
//   node farm-db.mjs reconcile                               (prove live ∪ archive lost nothing)
// Record types: run · candidate · gate-asked · gate · attempt · pr · advisory · run-end
// (see skills/crg-farm/methodology.md).
// Compaction keeps the LIVE file lean without ever deleting a log line: closed-run telemetry moves
// to an append-only history-archive.jsonl; pr + buildability (the only cross-run reads) stay live.
// Maintenance incantation when the live file grows: `backfill-run-ends && compact`.
// CRG_FARM_DB overrides the path (used by tests).

import { appendFileSync, mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const dbPath = () =>
  process.env.CRG_FARM_DB || join(homedir(), '.claude', 'crg-farm', 'history.jsonl')

export function append(record) {
  const row = { ts: new Date().toISOString(), ...record }
  const path = dbPath()
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, JSON.stringify(row) + '\n')
  return row
}

function readLines(path) {
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

// filter: a plain object; a record matches when every filter field strictly equals the record's.
// query() reads the LIVE file only — the hot path (pr dedup, buildability demotion, stage polling)
// never needs archived records. queryAll() unions the archive for rare cross-history audits.
export function query(filter = {}) {
  const keys = Object.keys(filter)
  return readLines(dbPath()).filter(r => keys.every(k => r[k] === filter[k]))
}

export function queryAll(filter = {}) {
  const keys = Object.keys(filter)
  return [...readLines(dbPath()), ...readLines(archivePath())].filter(r => keys.every(k => r[k] === filter[k]))
}

// --- Compaction: keep the hot file lean WITHOUT ever losing a log line --------------------------
// Only pr + buildability are read cross-run; those, plus every record of a still-OPEN run, stay
// live. A closed run's verbose telemetry (candidate/gate/stage/…, ~3/4 of the bytes, never read on
// the hot path) moves to an append-only archive. Nothing is deleted — a lossless split, reconciled
// before it commits, so live ∪ archive always equals every record ever appended.
const DURABLE_TYPES = new Set(['pr', 'buildability'])

export const archivePath = () => {
  const p = dbPath()
  return p.endsWith('.jsonl') ? p.slice(0, -6) + '-archive.jsonl' : p + '-archive.jsonl'
}

export function compact() {
  const path = dbPath()
  if (!existsSync(path)) return { archived: 0, kept: 0 }
  const buf = readFileSync(path)
  const sizeBefore = buf.length
  const records = buf.toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
  const closed = new Set(records.filter(r => r.type === 'run-end').map(r => r.farmRunId))
  // Keep live if: durable type, or no run to close against, or its run is still open.
  const keepLive = r => DURABLE_TYPES.has(r.type) || r.farmRunId == null || !closed.has(r.farmRunId)
  const survivors = records.filter(keepLive)
  const toArchive = records.filter(r => !keepLive(r))
  if (!toArchive.length) return { archived: 0, kept: survivors.length }
  // Lossless guard — every original record is kept or archived, never dropped. Abort before commit.
  if (survivors.length + toArchive.length !== records.length) throw new Error('compact: partition lost records')
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(archivePath(), toArchive.map(r => JSON.stringify(r)).join('\n') + '\n')
  const tmp = path + '.tmp'
  writeFileSync(tmp, survivors.map(r => JSON.stringify(r)).join('\n') + '\n')
  // Tail-capture: preserve any records appended to the live file while we were working.
  const tail = readFileSync(path).subarray(sizeBefore)
  if (tail.length) appendFileSync(tmp, tail)
  renameSync(tmp, path)
  return { archived: toArchive.length, kept: survivors.length, archive: archivePath() }
}

// Prove nothing was lost: live ∪ archive, counted by type.
export function reconcile() {
  const live = readLines(dbPath())
  const archive = readLines(archivePath())
  const byType = {}
  for (const r of [...live, ...archive]) byType[r.type] = (byType[r.type] || 0) + 1
  return { live: live.length, archive: archive.length, total: live.length + archive.length, byType }
}

// Appends a `run-end` record for a live run: startedAt from its `run` record,
// endedAt now, durationMs between them. Call once the loop finishes or aborts.
export function closeRun(farmRunId, endedAt = new Date().toISOString()) {
  const runRecord = query({ type: 'run', farmRunId })[0]
  if (!runRecord) throw new Error(`no run record found for farmRunId ${farmRunId}`)
  const startedAt = runRecord.ts
  const durationMs = new Date(endedAt) - new Date(startedAt)
  return append({ type: 'run-end', farmRunId, startedAt, endedAt, durationMs })
}

// Retroactively reconstructs run-end records for historical runs that predate
// closeRun: endedAt = the latest ts among that farmRunId's own records (the
// best available proxy for when the run actually finished).
export function backfillRunEnds() {
  const all = query()
  const closed = new Set(all.filter(r => r.type === 'run-end').map(r => r.farmRunId))
  const runs = all.filter(r => r.type === 'run' && !closed.has(r.farmRunId))
  return runs.map(runRecord => {
    const { farmRunId } = runRecord
    const startedAt = runRecord.ts
    const endedAt = all
      .filter(r => r.farmRunId === farmRunId)
      .reduce((max, r) => (r.ts > max ? r.ts : max), startedAt)
    const durationMs = new Date(endedAt) - new Date(startedAt)
    return append({ type: 'run-end', farmRunId, startedAt, endedAt, durationMs, backfilled: true })
  })
}

// Pairs each decided `gate` record with the `gate-asked` record logged right before
// AskUserQuestion was shown for it (same farmRunId+gate+repo, latest one at/before the
// decision), giving an exact human-wait duration instead of a gap inferred from
// neighboring records. Unmatched decisions (asked before this tracking existed) get
// waitMs: null.
export function gateWaits(filter = {}) {
  const decisions = queryAll({ type: 'gate', ...filter })
  const asks = queryAll({ type: 'gate-asked', ...filter })
  return decisions.map(d => {
    const asked = asks
      .filter(a => a.farmRunId === d.farmRunId && a.gate === d.gate && a.repo === d.repo && a.ts <= d.ts)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1))[0]
    const waitMs = asked ? new Date(d.ts) - new Date(asked.ts) : null
    return { farmRunId: d.farmRunId, gate: d.gate, repo: d.repo, decision: d.decision, askedAt: asked?.ts, decidedAt: d.ts, waitMs }
  })
}

// Deterministic, filesystem-safe report path for a security-advisory-track bug — always
// outside any cloned repo's working tree so PR-PREP can never sweep it into a commit.
export const advisoryRoot = () =>
  process.env.CRG_FARM_ADVISORIES || join(homedir(), '.claude', 'crg-farm', 'advisories')

const slugify = s => s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')

export function advisoryPath(repo, keyOf) {
  return join(advisoryRoot(), slugify(repo), `${slugify(keyOf)}.md`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2)
  const [arg] = rest
  if (cmd === 'append') process.stdout.write(JSON.stringify(append(JSON.parse(readFileSync(0, 'utf8')))))
  else if (cmd === 'query') process.stdout.write(query(arg ? JSON.parse(arg) : {}).map(r => JSON.stringify(r)).join('\n'))
  else if (cmd === 'close-run') process.stdout.write(JSON.stringify(closeRun(arg)))
  else if (cmd === 'backfill-run-ends') process.stdout.write(backfillRunEnds().map(r => JSON.stringify(r)).join('\n'))
  else if (cmd === 'gate-waits') process.stdout.write(gateWaits(arg ? JSON.parse(arg) : {}).map(r => JSON.stringify(r)).join('\n'))
  else if (cmd === 'compact') process.stdout.write(JSON.stringify(compact()))
  else if (cmd === 'reconcile') process.stdout.write(JSON.stringify(reconcile()))
  else if (cmd === 'advisory-path') process.stdout.write(advisoryPath(rest[0], rest[1]))
  else { process.stderr.write('usage: farm-db.mjs append|query|close-run <farmRunId>|backfill-run-ends|gate-waits [filter]|compact|reconcile|advisory-path <repo> <keyOf>\n'); process.exit(1) }
}
