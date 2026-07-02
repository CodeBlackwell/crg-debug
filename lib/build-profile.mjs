// App-profile validation + the /crg-build --auto-bypass decisions, in real code.
//   node build-profile.mjs validate <profile.json>            (exit 0 ok / 1 with errors on stderr)
//   node build-profile.mjs auto-approve <ledger.json> [cap]   (stdout: JSON array of approved gapIds)
// scoreUx is import-only — the skill's UX-REVIEW stage merges two scorers with it.

import { readFileSync } from 'node:fs'

const AUTH_KINDS = ['localStorage', 'url-token']

export function validateProfile(p) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(p && typeof p === 'object', 'profile must be an object')
  if (!p || typeof p !== 'object') return { ok: false, errors }
  need(typeof p.app === 'string' && p.app.length > 0, 'app: non-empty string required')
  need(Array.isArray(p.subrepos) && p.subrepos.length > 0, 'subrepos: non-empty array required')
  for (const [i, r] of (p.subrepos || []).entries()) {
    need(r && typeof r.name === 'string' && r.name && typeof r.path === 'string' && r.path, `subrepos[${i}]: {name, path} required`)
  }
  need(p.boot && typeof p.boot.up === 'string' && p.boot.up.length > 0, 'boot.up: non-empty command required')
  need(Array.isArray(p.health) && p.health.length > 0, 'health: non-empty array required')
  for (const [i, h] of (p.health || []).entries()) {
    need(h && typeof h.name === 'string' && typeof h.url === 'string' && Number.isInteger(h.expect), `health[${i}]: {name, url, expect:int} required`)
  }
  need(Array.isArray(p.frontends) && p.frontends.length > 0, 'frontends: non-empty array required')
  const ports = new Map()
  for (const [i, f] of (p.frontends || []).entries()) {
    const at = `frontends[${i}]`
    need(f && typeof f.name === 'string' && f.name, `${at}: name required`)
    need(f && typeof f.url === 'string' && /^https?:\/\//.test(f.url || ''), `${at}: http(s) url required`)
    const auth = (f && f.auth) || {}
    need(AUTH_KINDS.includes(auth.kind), `${at}.auth.kind: one of ${AUTH_KINDS.join('|')} required`)
    need(typeof auth.tokenCmd === 'string' && auth.tokenCmd.length > 0, `${at}.auth.tokenCmd: required (tokens are minted, never stored)`)
    if (auth.kind === 'localStorage') need(typeof auth.key === 'string' && auth.key.length > 0, `${at}.auth.key: required for localStorage auth`)
    if (auth.kind === 'url-token') need(typeof auth.routeTemplate === 'string' && auth.routeTemplate.includes('{token}'), `${at}.auth.routeTemplate: required for url-token auth and must contain {token}`)
    need(Array.isArray(f && f.identities) && f.identities.length > 0, `${at}.identities: non-empty array required`)
    try {
      const port = new URL(f.url).port || (f.url.startsWith('https') ? '443' : '80')
      if (ports.has(port)) errors.push(`${at}: port ${port} collides with frontends[${ports.get(port)}] — dev servers cannot share a port`)
      ports.set(port, i)
    } catch { /* url error already reported */ }
  }
  return { ok: errors.length === 0, errors }
}

// The --auto-bypass replacement for GATE-SPEC, deliberately asymmetric-conservative:
// only High|Medium impact, only S|M effort, NEVER the launch-blockers dimension
// (removing waitlist gates / alpha banners / feature flags is a product decision no
// harness should make), capped. gaps arrive pre-ranked; order is preserved.
export function autoApprove(gaps, { cap = 12 } = {}) {
  return (gaps || [])
    .filter(g => (g.impact === 'High' || g.impact === 'Medium') &&
      (g.effort === 'S' || g.effort === 'M') &&
      g.dimension !== 'launch-blockers')
    .slice(0, cap)
}

// Merge two independent rubric scorers. Agreement -> mean; disagreement beyond
// maxDisagreement -> the MIN (conservative). A criterion scored by only one
// scorer keeps that score. Returns merged scores + the criteria below threshold.
export function scoreUx(scoresA, scoresB, { threshold = 4, maxDisagreement = 2 } = {}) {
  const byCrit = new Map()
  for (const s of scoresA || []) byCrit.set(s.criterion, [s.score])
  for (const s of scoresB || []) byCrit.set(s.criterion, [...(byCrit.get(s.criterion) || []), s.score])
  const scores = [...byCrit.entries()].map(([criterion, vals]) => ({
    criterion,
    score: vals.length === 1 ? vals[0]
      : Math.abs(vals[0] - vals[1]) > maxDisagreement ? Math.min(vals[0], vals[1])
      : (vals[0] + vals[1]) / 2,
  }))
  return { scores, below: scores.filter(s => s.score < threshold).map(s => s.criterion) }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg, capArg] = process.argv.slice(2)
  if (cmd === 'validate') {
    const res = validateProfile(JSON.parse(readFileSync(arg, 'utf8')))
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    process.stdout.write('ok\n')
  } else if (cmd === 'auto-approve') {
    const ledger = JSON.parse(readFileSync(arg, 'utf8'))
    const approved = autoApprove(ledger.gaps || [], capArg ? { cap: Number(capArg) } : {})
    process.stdout.write(JSON.stringify(approved.map(g => g.gapId)) + '\n')
  } else {
    process.stderr.write('usage: build-profile.mjs validate <profile.json> | auto-approve <ledger.json> [cap]\n')
    process.exit(1)
  }
}
