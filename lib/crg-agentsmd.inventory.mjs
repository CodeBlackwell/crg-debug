// Pure corpus statistics for /crg-agentsmd: the holdout split the miners never see, the era
// buckets it stratifies on, and the inventory that decides whether the fossil record is rich
// enough to mine at all. No network, no disk — crg-agentsmd.corpus.mjs owns that half and drives these from
// its CLI (`crg-agentsmd.corpus.mjs split|inventory`). Also home to the shared bot-author predicate, which
// every consumer of the comment corpus needs.
// Holdout stratification: reviewed PRs grouped by (top reviewer, era); every Nth PR of each
// stratum is held out — deterministic, no RNG, reproducible across runs.

// Bot review comments carry no tacit human knowledge; a missing login is treated as a bot so
// every caller filters it out the same way.
export const isBot = login => !login || login.endsWith('[bot]')

// ~4 chars per token is close enough for slice sizing.
export const estTokens = s => Math.ceil(String(s || '').length / 4)

// --- split -----------------------------------------------------------------------------------

// Reviewed PRs only (unreviewed ones carry no correction signal). Deterministic stratified pick:
// within each (top reviewer, era) stratum, PRs sorted by number, every ⌈1/fraction⌉th held out.
export function splitHoldout(prs, fraction = 0.2) {
  const reviewed = prs.filter(p => p.state === 'merged' && p.reviewers.length > 0)
  const eras = detectEras(reviewed)
  const strata = new Map()
  for (const p of reviewed) {
    const key = `${p.reviewers[0]}::${eraOf(p, eras)}`
    if (!strata.has(key)) strata.set(key, [])
    strata.get(key).push(p)
  }
  const step = Math.max(2, Math.round(1 / fraction))
  const holdout = []
  for (const group of strata.values()) {
    group.sort((a, b) => a.number - b.number)
    group.forEach((p, i) => { if (i % step === step - 1) holdout.push(p.number) })
  }
  return { holdout: holdout.sort((a, b) => a - b), reviewed: reviewed.length, eras }
}

// Three equal-population eras across the merged timeline: enough to spot dead rules
// (heavily enforced early, absent recently) without pretending to detect refactors.
export function detectEras(prs) {
  const dates = prs.map(p => p.mergedAt || p.createdAt).sort()
  if (dates.length < 3) return [dates[0] || '', dates[dates.length - 1] || '']
  return [dates[Math.floor(dates.length / 3)], dates[Math.floor((2 * dates.length) / 3)]]
}

export const eraOf = (p, eras) => {
  const d = p.mergedAt || p.createdAt
  return d < eras[0] ? 'early' : d < eras[1] ? 'middle' : 'recent'
}

// --- inventory -------------------------------------------------------------------------------

export function buildInventory({ prs, comments, gitRows, holdout, minReviewedPRs = 30 }) {
  const reviewed = prs.filter(p => p.state === 'merged' && p.reviewers.length > 0)
  const held = new Set(holdout)
  const trainComments = comments.filter(c => !held.has(c.pr))
  const byReviewer = {}
  for (const c of trainComments) {
    if (isBot(c.author)) continue
    byReviewer[c.author] = (byReviewer[c.author] || 0) + 1
  }
  const roster = Object.entries(byReviewer).sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([login, count]) => ({ login, comments: count }))
  return {
    prs: prs.length,
    merged: prs.filter(p => p.state === 'merged').length,
    closedUnmerged: prs.filter(p => p.state === 'closed-unmerged').length,
    reviewedPRs: reviewed.length,
    holdoutPRs: holdout.length,
    trainPRs: reviewed.length - holdout.length,
    reviewComments: comments.length,
    trainReviewComments: trainComments.length,
    holdoutReviewComments: comments.length - trainComments.length,
    trainCommentTokens: trainComments.reduce((n, c) => n + estTokens(c.body), 0),
    archaeologyCommits: gitRows.length,
    maintainerRoster: roster,
    thinCorpus: reviewed.length < minReviewedPRs,
  }
}
