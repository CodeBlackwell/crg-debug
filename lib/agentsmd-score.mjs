// Retrodictive holdout scorer for /crg-agentsmd: replays a repo's held-out review corrections against
// the mined rules and cuts the ones no correction credits. Pure scoring math (no model calls) plus the
// two CLI seams the Score phase drives:
//   node agentsmd-score.mjs holdout <repoRoot>   (writes .crg-agentsmd/holdout-comments.json, prints count)
//   node agentsmd-score.mjs score   <repoRoot>   (reads panel.json + ledger.json + corpus -> scores.json)
// The judged rule list = ledger.rules ++ the env-false-killed cut entries (rescued, flagged
// unverifiedCommand). Judge agents credit rules by their index in THAT list, so judgedRules() is the
// single source of truth both the workflow's prompt-builder and this scorer must agree on.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { corpusDir, readJsonl } from './corpus.mjs'

// A cut[] entry killed by a missing-tool/missing-file error is an environment false-kill, not a
// disproof of the rule — it rejoins scoring (unverified) and survives only on earned coverage.
export const RESCUE_RE = /command not found|not installed|No such file/

const isBot = login => !login || login.endsWith('[bot]')

// Held-out review corrections the panel judges against: comments on held-out PRs, minus bots (bot
// findings carry no tacit human correction). Reply-chatter stays in — a judge marks it
// applicable:false rather than a brittle heuristic risking the loss of a real correction.
export function holdoutComments(allComments, holdoutPRs) {
  const held = new Set(holdoutPRs)
  return allComments.filter(c => held.has(c.pr) && !isBot(c.author))
}

// The rule list judges credit against, by index: mined rules first, then rescued env-false-kills.
// A ledger rule may already carry unverifiedCommand:true (the Verify phase keeps env-failed
// command claims instead of cutting them) — preserve it so the zero-predictive exemption
// never treats an unverified command as durable enforcement.
export function judgedRules(ledger) {
  const rules = (ledger.rules || []).map(r => ({ ...r, unverifiedCommand: !!r.unverifiedCommand }))
  const rescued = (ledger.cut || [])
    .filter(c => RESCUE_RE.test(String(c.cutReason || '')))
    .map(c => ({ ...c, unverifiedCommand: true }))
  return [...rules, ...rescued]
}

// Fold the judge panel into per-rule coverage. A comment is "covered" when >=1 valid rule is
// credited; only applicable comments (real corrections) count. Out-of-range indices are ignored.
export function scorePanel(panel, ruleCount) {
  const perRule = Array.from({ length: ruleCount }, (_, rule) => ({ rule, covered: 0 }))
  let applicable = 0
  let coveredApplicable = 0
  for (const row of panel) {
    if (!row || !row.applicable) continue
    applicable++
    const credited = [...new Set((row.creditedRules || []).filter(i => Number.isInteger(i) && i >= 0 && i < ruleCount))]
    if (credited.length) coveredApplicable++
    for (const i of credited) perRule[i].covered++
  }
  return {
    perRule,
    fileCoverage: applicable ? coveredApplicable / applicable : 0,
    applicable,
    totalComments: panel.length,
  }
}

// Cut a rule no held-out correction credits, UNLESS it is a mechanical rule with a verified command
// (its executable check is durable enforcement regardless of retrodictive coverage). A rescued
// env-false-kill has no verified command, so it must earn coverage>0 to survive. Kept rules get
// their coverage stamped for synthesis ordering.
export function cutZeroPredictive(rules, perRule) {
  const covByRule = new Map(perRule.map(p => [p.rule, p.covered]))
  const kept = []
  const cutRules = []
  rules.forEach((r, i) => {
    const covered = covByRule.get(i) || 0
    const exempt = r.category === 'mechanical' && !!r.commandClaim && !r.unverifiedCommand
    if (covered === 0 && !exempt) cutRules.push({ ...r, cutReason: 'zero-predictive: no held-out review correction credited this rule' })
    else kept.push({ ...r, coverage: covered })
  })
  return { kept, cutRules }
}

// --- CLI -----------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, repoRoot] = process.argv.slice(2)
  if (!repoRoot) { process.stderr.write('usage: agentsmd-score.mjs holdout|score <repoRoot>\n'); process.exit(1) }
  const dir = corpusDir(repoRoot)
  const base = join(repoRoot, '.crg-agentsmd')
  if (cmd === 'holdout') {
    const comments = readJsonl(join(dir, 'review-comments.jsonl'))
    const holdout = JSON.parse(readFileSync(join(dir, 'holdout', 'prs.json'), 'utf8')).holdout
    const held = holdoutComments(comments, holdout).map(c => ({ ...c, commentId: c.url }))
    writeFileSync(join(base, 'holdout-comments.json'), JSON.stringify(held, null, 2))
    process.stdout.write(JSON.stringify({ holdoutComments: held.length, holdoutPRs: holdout.length }) + '\n')
  } else if (cmd === 'score') {
    const panel = JSON.parse(readFileSync(join(base, 'panel.json'), 'utf8'))
    const ledger = JSON.parse(readFileSync(join(base, 'ledger.json'), 'utf8'))
    const judged = judgedRules(ledger)
    const scored = scorePanel(panel, judged.length)
    const { kept, cutRules } = cutZeroPredictive(judged, scored.perRule)
    const held = existsSync(join(base, 'holdout-comments.json'))
      ? JSON.parse(readFileSync(join(base, 'holdout-comments.json'), 'utf8')) : []
    const judgedIds = new Set(panel.map(r => r && r.commentId))
    const scores = {
      fileCoverage: scored.fileCoverage,
      applicable: scored.applicable,
      totalComments: scored.totalComments,
      holdoutTotal: held.length,
      unjudged: held.filter(c => !judgedIds.has(c.commentId)).length,
      perRule: scored.perRule,
      kept,
      cutZeroPredictive: cutRules,
      rescued: kept.filter(r => r.unverifiedCommand).map(r => r.rule),
    }
    writeFileSync(join(base, 'scores.json'), JSON.stringify(scores, null, 2))
    process.stdout.write(JSON.stringify(scores, null, 2) + '\n')
  } else { process.stderr.write('usage: agentsmd-score.mjs holdout|score <repoRoot>\n'); process.exit(1) }
}
