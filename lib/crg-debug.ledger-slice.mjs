// Narrow a crg-debug ledger to a subset of its confirmedBugs. Pure functions +
// a CLI so the /crg-farm skill can scope re-fix runs deterministically:
//   node crg-debug.ledger-slice.mjs <ledger.json>  < keep.json  >  narrowed.json
// keep.json is a JSON array of bug objects OR bugKeyOf strings to retain.
//
// Two uses: GATE-TRIAGE (fix only the bugs the human picked) and escalation
// (re-fix ONLY the unfixed set, so the higher model never re-runs closed bugs —
// re-attempting a green bug can't fail RED and gets mislabeled "RED not observed").
//
// The narrowed ledger holds no unreviewed rows: a fix run from it has nothing to review,
// so it fixes the kept bugs and nothing else.

import { readFileSync } from 'node:fs'

// Identity of a bug across ledger + Workflow return — MUST match crg-debug.js.
const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const bugKeyOf = f => `${norm(f && f.file)}::${norm(f && f.rootCause)}`

// keep: array/Set of bugKeyOf strings, or array of bug objects (converted via bugKeyOf).
export function sliceLedger(ledger, keep) {
  const arr = keep instanceof Set ? [...keep] : keep || []
  const keys = new Set(arr.map(k => (typeof k === 'string' ? k : bugKeyOf(k))))
  const confirmedBugs = (ledger.confirmedBugs || []).filter(b => keys.has(bugKeyOf(b)))
  // A slice is somebody's choice of what to fix, and a fix run from a ledger reviews the
  // ledger's unreviewed rows first and fixes what it confirms. So a slice carries none:
  // nothing the chooser never saw can reach the fix phase. The ledger it was cut from
  // keeps them.
  const unreviewed = 'unreviewed' in ledger ? { unreviewed: [] } : null
  // A ledger carries its own row counts and crg-debug refuses one that does not hold what
  // they say, so a slice says what it kept.
  const counts = ledger.counts ? { counts: { ...ledger.counts, confirmedBugs: confirmedBugs.length, unreviewed: 0 } } : null
  return { ...ledger, ...counts, confirmedBugs, ...unreviewed }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ledger = JSON.parse(readFileSync(process.argv[2], 'utf8'))
  const keep = JSON.parse(readFileSync(0, 'utf8'))
  process.stdout.write(JSON.stringify(sliceLedger(ledger, keep)))
}
