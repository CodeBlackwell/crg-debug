// Narrow a crg-debug ledger to a subset of its confirmedBugs. Pure functions +
// a CLI so the /crg-farm skill can scope re-fix runs deterministically:
//   node ledger-slice.mjs <ledger.json>  < keep.json  >  narrowed.json
// keep.json is a JSON array of bug objects OR keyOf strings to retain.
//
// Two uses: GATE-TRIAGE (fix only the bugs the human picked) and escalation
// (re-fix ONLY the unfixed set, so the higher model never re-runs closed bugs —
// re-attempting a green bug can't fail RED and gets mislabeled "RED not observed").

import { readFileSync } from 'node:fs'

// Identity of a bug across ledger + Workflow return — MUST match crg-debug.js.
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const keyOf = f => `${norm(f && f.file)}::${norm(f && f.rootCause)}`

// keep: array/Set of keyOf strings, or array of bug objects (converted via keyOf).
export function sliceLedger(ledger, keep) {
  const arr = keep instanceof Set ? [...keep] : keep || []
  const keys = new Set(arr.map(k => (typeof k === 'string' ? k : keyOf(k))))
  const confirmedBugs = (ledger.confirmedBugs || []).filter(b => keys.has(keyOf(b)))
  return { ...ledger, confirmedBugs }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ledger = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const keep = JSON.parse(readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(sliceLedger(ledger, keep)))
}
