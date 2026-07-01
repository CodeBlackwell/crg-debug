// Append-only JSONL record of all /crg-farm work, global across repos and runs.
// Durable memory the per-run .crg-debug/ledger.json is not: candidate dedup, PR
// outcomes, gate audit trail. One JSON object per line, type-tagged.
//   node farm-db.mjs append           < record.json          (stdout: the stored record)
//   node farm-db.mjs query '<filter>'                        (stdout: JSONL of matches)
// Record types: run · candidate · gate · attempt · pr  (see skills/crg-farm/methodology.md).
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'append') process.stdout.write(JSON.stringify(append(JSON.parse(readFileSync(0, 'utf8')))))
  else if (cmd === 'query') process.stdout.write(query(arg ? JSON.parse(arg) : {}).map(r => JSON.stringify(r)).join('\n'))
  else { process.stderr.write('usage: farm-db.mjs append|query [filter]\n'); process.exit(1) }
}
