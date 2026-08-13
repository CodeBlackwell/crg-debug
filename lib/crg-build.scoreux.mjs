// The /crg-build UX-REVIEW rubric merge — import-only, no CLI. Lives apart from
// crg-build.profile.mjs because merging two scorers' rubrics has nothing to do with
// validating an app profile.

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
