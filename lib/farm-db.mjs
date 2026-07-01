// Append-only JSONL record of all /crg-farm work, global across repos and runs.
// Durable memory the per-run .crg-debug/ledger.json is not: candidate dedup, PR
// outcomes, gate audit trail. One JSON object per line, type-tagged.
//   node farm-db.mjs append           < record.json          (stdout: the stored record)
//   node farm-db.mjs query '<filter>'                        (stdout: JSONL of matches)
// Record types: run · candidate · gate-asked · gate · attempt · pr · advisory · run-end
// (see skills/crg-farm/methodology.md).
// CRG_FARM_DB overrides the path (used by tests).

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
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

// filter: a plain object; a record matches when every filter field strictly equals the record's.
export function query(filter = {}) {
  const path = dbPath()
  if (!existsSync(path)) return []
  const keys = Object.keys(filter)
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .filter(r => keys.every(k => r[k] === filter[k]))
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
  const decisions = query({ type: 'gate', ...filter })
  const asks = query({ type: 'gate-asked', ...filter })
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
  else if (cmd === 'advisory-path') process.stdout.write(advisoryPath(rest[0], rest[1]))
  else { process.stderr.write('usage: farm-db.mjs append|query|close-run <farmRunId>|backfill-run-ends|gate-waits [filter]|advisory-path <repo> <keyOf>\n'); process.exit(1) }
}
