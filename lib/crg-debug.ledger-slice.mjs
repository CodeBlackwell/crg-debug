// Narrow a crg-debug ledger to a subset of its confirmedBugs. Pure functions +
// a CLI so the /crg-farm skill can scope re-fix runs deterministically:
//   node crg-debug.ledger-slice.mjs <ledger.json>  < keep.json  >  narrowed.json
// keep.json is a JSON array of bug objects OR bugKeyOf strings to retain.
//
// Two uses: GATE-TRIAGE (fix only the bugs the human picked) and escalation
// (re-fix ONLY the unfixed set, so the higher model never re-runs closed bugs —
// re-attempting a green bug can't fail RED and gets mislabeled "RED not observed").

import { readFileSync } from 'node:fs'

// Identity of a bug across ledger + Workflow return — MUST match crg-debug.js.
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const bugKeyOf = f => `${norm(f && f.file)}::${norm(f && f.rootCause)}`

// keep: array/Set of bugKeyOf strings, or array of bug objects (converted via bugKeyOf).
export function sliceLedger(ledger, keep) {
  const arr = keep instanceof Set ? [...keep] : keep || []
  const keys = new Set(arr.map(k => (typeof k === 'string' ? k : bugKeyOf(k))))
  const confirmedBugs = (ledger.confirmedBugs || []).filter(b => keys.has(bugKeyOf(b)))
  // A ledger carries its own row counts and crg-debug refuses one that does not hold what
  // they say, so a slice says how many confirmed rows it kept.
  const counts = ledger.counts ? { counts: { ...ledger.counts, confirmedBugs: confirmedBugs.length } } : null
  return { ...ledger, ...counts, confirmedBugs }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ledger = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const keep = JSON.parse(readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(sliceLedger(ledger, keep)))
}
