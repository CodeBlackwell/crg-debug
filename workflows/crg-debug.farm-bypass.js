export const meta = {
  name: 'crg-farm-bypass',
  description:
    'The harness-held option for /crg-farm --auto-bypass: RECON + two-pass dedup + impact x review-likelihood rank, capped in real code to the top 5 -> per-repo TRIAGE (security-sensitive bugs get a quick PoC + exploit-path check + a repo contribution/security-policy check, then a computed, conservative channel decision: a mechanical low-marginal-risk fix a repo policy does not forbid rejoins the normal fix/PR pipeline with a 1-3-sentence PR; anything ambiguous falls back to a short, conservative report that never leaves local disk) -> FIX with escalation (a regression climbs to the next, strictly higher tier — never a retry of the tier that just failed; every tier gets exactly one shot) -> auto commit/push/open a draft PR. GATE-SUBMIT is never crossed by this script or any flag — every PR stops at draft. Every cap, retry limit, security decision, and gate this script crosses is enforced in JS, not trusted to a model following a prompt.',
  whenToUse:
    'Requires args {direction: "themed"|"wildcard"|"scoped", query?, repo?, issueRef?, maxTier?, methodologyPath, crgDebugPath, farmDbPath, reposRoot, farmRunId}. Invoke ONLY when the user has explicitly passed --auto-bypass to /crg-farm and this file is installed (the crg-deterministic enabler copies it alongside crg-debug.js). Never invoke for the default, gated /crg-farm flow — that one needs AskUserQuestion and stays in the main loop.',
  phases: [
    { title: 'Recon', detail: 'gh search/issue-list + two-pass dedup + rank, capped to top 5' },
    { title: 'Triage', detail: 'clone/sync + provision a dedicated cached container env + crg-debug --detect-only per candidate repo (unbuildable envs hand off as unfarmable)' },
    { title: 'Advisory', detail: 'security-sensitive bugs: quick PoC + exploit-path + contribution-policy check, then a JS-computed conservative channel decision (mechanical + low-marginal-risk + no policy objection -> rejoin the normal pipeline; anything ambiguous -> a short report, disk-only, never transmitted)' },
    { title: 'Fix', detail: 'crg-debug --from-ledger with escalation; a regression climbs one tier, never a same-tier retry' },
    { title: 'PR', detail: 'auto commit, push, open as draft — stops there, GATE-SUBMIT stays human' },
  ],
}

// >>> pure-helpers — dependency-free (no args/agent/log)
const capText = (s, n) => String(s == null ? '' : s).trim().slice(0, n)
const isAbsSafe = p => typeof p === 'string' && /^\/[^\0]*$/.test(p) && !/\.\.(\/|$)/.test(p)
const TIERS = ['haiku', 'sonnet', 'opus']
// Strictly climbs — never returns the same tier. null means already at maxTier:
// every tier gets exactly one shot, no retries, ever.
const nextTier = (tier, maxTier) => {
  const cap = Math.max(0, TIERS.indexOf(maxTier))
  const idx = TIERS.indexOf(tier)
  return idx < cap ? TIERS[idx + 1] : null
}
const slug = s => String(s || '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '')
// <<< pure-helpers

// ---- args ---------------------------------------------------------------------
const a = typeof args === 'string' ? JSON.parse(args) : args
const direction = a && a.direction
const query = capText(a && a.query, 300)
const repoArg = capText(a && a.repo, 200)
const issueRefArg = capText(a && a.issueRef, 200)
const maxTier = TIERS.includes(a && a.maxTier) ? a.maxTier : 'opus'
const methodologyPath = capText(a && a.methodologyPath, 1000)
const crgDebugPath = capText(a && a.crgDebugPath, 1000)
const farmDbPath = capText(a && a.farmDbPath, 1000)
const reposRoot = capText(a && a.reposRoot, 1000)
const farmRunId = capText(a && a.farmRunId, 200) || 'auto-bypass-run'
// The farm's clone cache is disposable, so it always provisions a dedicated, cached per-repo
// container env (hand-installed system deps, language deps in a named volume, reused across runs).
const env = ['none', 'container'].includes(a && a.env) ? a.env : 'container'

if (!['themed', 'wildcard', 'scoped'].includes(direction)) {
  throw new Error('crg-farm-bypass requires args.direction: "themed" | "wildcard" | "scoped"')
}
if (direction === 'scoped' && !repoArg) {
  throw new Error('crg-farm-bypass scoped mode requires args.repo ("owner/repo")')
}
for (const [k, v] of Object.entries({ methodologyPath, crgDebugPath, farmDbPath, reposRoot })) {
  if (!isAbsSafe(v)) throw new Error(`crg-farm-bypass requires args.${k} as an absolute path with no '..' segments`)
}

const CANDIDATE_CAP = 5

log(`crg-farm --auto-bypass (harness): direction=${direction} maxTier=${maxTier} env=${env} farmRunId=${farmRunId}`)

// ---- Phase 1: RECON + dedup + rank ---------------------------------------------
phase('Recon')

const RECON_SCHEMA = {
  type: 'object',
  required: ['fresh', 'dropped'],
  properties: {
    fresh: {
      type: 'array',
      description: 'Sorted impact-first, review-likelihood as tiebreaker — index 0 is the top pick.',
      items: {
        type: 'object',
        required: ['repo', 'issueRef', 'title', 'url'],
        properties: {
          repo: { type: 'string', description: 'owner/repo' },
          issueRef: { type: 'string', description: 'e.g. "#123"' },
          title: { type: 'string' },
          url: { type: 'string' },
          severity: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
          impactRationale: { type: 'string', description: 'one line: why this ranks where it does' },
          stars: { type: 'number' },
          recentMergeSpanDays: { type: 'number' },
          daysSinceLastMerge: { type: 'number' },
          farmabilityPrior: { type: 'string', enum: ['high', 'medium', 'low'], description: 'cheap-metadata guess at whether the env is buildable in the current --env mode (no clone)' },
          farmabilitySignals: { type: 'string', description: 'one line: language, build manifests, size, and any prior verdict behind the prior' },
          priorUnfarmable: { type: 'boolean', description: 'true if the farm DB already recorded this repo unfarmable in this env mode' },
        },
      },
    },
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        required: ['repo', 'issueRef', 'status'],
        properties: {
          repo: { type: 'string' },
          issueRef: { type: 'string' },
          status: { type: 'string', enum: ['in-flight', 'already-fixed'] },
          competingPr: { type: 'string' },
        },
      },
    },
  },
}

const reconPrompt =
  direction === 'scoped'
    ? `Source open, PR-able bugs for the repo "${repoArg}"${issueRefArg ? ` (seed issue ${issueRefArg})` : ''} via \`gh issue list -R ${repoArg} --state open --label bug\` (drop --label bug and retry if too few hits). This harness run cannot use /xplore (main-loop-only) — gh only, same limitation themed/wildcard mode always had.`
    : direction === 'themed'
      ? `Cross-repo GitHub search for open, PR-able bugs matching "${query}": \`gh search issues "${query}" --state open --label bug --sort updated --json repository,number,title,url -L 30\` (drop --label bug and retry if too few hits).`
      : `Unthemed cross-repo GitHub search for open, PR-able bugs: \`gh search issues --state open --label bug --sort updated -L 30\`. Quality-filter: drop any repo that is archived or has had no push in the last 12 months (\`gh repo view <owner>/<repo> --json isArchived,pushedAt\`).`

const recon = await agent(
  `${reconPrompt}

For each hit, run the two-pass duplicate-fix check from crg-farm's methodology — read ${methodologyPath}, section "RECON — sourcing + duplicate-fix check", for the exact judgment rules:
1. Farm-DB dedup: \`node ${farmDbPath} query '{"type":"pr"}'\` — drop any candidate whose repo+issue we already shipped or exhausted.
2. Upstream duplicate-fix check per surviving candidate: confirm the issue is still open (\`gh issue view <n> -R <owner>/<repo> --json state,title,body\`) and search for a PR that already addresses it (\`gh search prs "repo:<owner>/<repo> <n>" --state all\`, \`gh pr list -R <owner>/<repo> --state open --search "<n> in:body,title"\`). Classify fresh / in-flight / already-fixed.

Before ranking, score each fresh candidate's FARMABILITY prior — a cheap, no-clone guess at whether env=${env} can build it, so slots don't get spent on predictably unbuildable repos (per methodology.md §Farmability prior):
- Prior verdicts (#1.5): \`node ${farmDbPath} query '{"type":"buildability"}'\` — for any fresh candidate whose repo has a record with verdict "unfarmable" AND env "${env}", set priorUnfarmable=true. That env already failed to build it.
- Cheap metadata (#1, no clone): \`gh repo view <owner>/<repo> --json stargazerCount,primaryLanguage,diskUsage\` (language + size), plus one root listing \`gh api repos/<owner>/<repo>/contents --jq '.[].name'\` to spot build manifests. Classify farmabilityPrior:
  - high — a mainstream containerable stack (JS/TS, Python, Go, Rust) WITH a lockfile or a Dockerfile/.devcontainer/CI workflow, and not a giant monorepo.
  - low — a heavy native/platform toolchain (C/C++/Obj-C, Swift/Kotlin/Android+Gradle, C#/.sln, an Xcode project, premake) OR a very large monorepo whose install won't finish in a slim container.
  - medium — anything else (recognized ecosystem but missing lockfile, or unclear).
  Put the one-line justification (language, manifests, size, prior verdict) in farmabilitySignals. This is a soft PRIOR, never a filter — a low-prior repo still runs if there aren't enough farmable ones.

Then rank the FRESH candidates, per methodology.md's §Ranking: per distinct repo use the \`stargazerCount\` from above and the last 5 merged-PR timestamps (\`gh pr list -R <owner>/<repo> --state merged -L 5 --json mergedAt,number\`) for review-cadence signals (tight spacing = active review; a stale gap since the last merge demotes a repo even if historical cadence looked fast). Score impact from the issue body itself — data-loss/security/safety bugs outrank plain functional breakage, which outranks cosmetic issues; a small low-star repo with a severe bug can outrank a huge repo with a cosmetic one. Sort fresh[] impact-first, review-likelihood as tiebreaker/demotion, farmability prior as a further demotion (a low-prior or priorUnfarmable repo should not outrank a comparable-impact farmable one) — index 0 is the top pick. The final farmability demotion is re-applied deterministically in JS after you return, so set farmabilityPrior/priorUnfarmable honestly.

Return the ranked fresh[] array and the dropped[] (in-flight/already-fixed) array with competingPr URLs where applicable.`,
  { phase: 'Recon', schema: RECON_SCHEMA, label: 'recon' }
)

const rankedFresh = (recon && recon.fresh) || []
const dropped = (recon && recon.dropped) || []
// Farmability demotion, enforced in JS before the cap (recon's rank is model-produced; the cap that
// decides which repos actually run is not). A prior unfarmable verdict sinks hardest, then a low
// farmability prior — each preserving recon's impact order within its tier. Soft, not a filter: a
// demoted repo still runs if fewer than CANDIDATE_CAP farmable ones exist.
const farmDemotion = c => (c && c.priorUnfarmable ? 2 : c && c.farmabilityPrior === 'low' ? 1 : 0)
const orderedFresh = rankedFresh
  .map((c, i) => ({ c, i }))
  .sort((a, b) => farmDemotion(a.c) - farmDemotion(b.c) || a.i - b.i)
  .map(x => x.c)
const capped = orderedFresh.slice(0, CANDIDATE_CAP)
const droppedByCap = orderedFresh.slice(CANDIDATE_CAP)

log(
  `Recon: ${rankedFresh.length} fresh candidate(s), ${dropped.length} dropped (in-flight/already-fixed). ` +
    `Auto-bypass cap: running the top ${capped.length}` +
    (droppedByCap.length ? `; ${droppedByCap.length} ranked candidate(s) NOT run this pass (past the top-${CANDIDATE_CAP} cap).` : '.')
)

await agent(
  `Append farm-DB records via \`node ${farmDbPath} append\` (one JSON object on stdin per call — call it once per record below):
- One "run" record: {"type":"run","farmRunId":"${farmRunId}","direction":"${direction}","mode":"auto-bypass-harness"}.
- One "candidate" record per entry in fresh[] and dropped[] below: {"type":"candidate","farmRunId":"${farmRunId}","repo":<repo>,"issueRef":<issueRef>,"keyOf":"<repo>::<issueRef>","status":<"fresh" for fresh[] entries, else the dropped[] entry's status>,"competingPr":<if present>}.
- One "gate" record: {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-RECON","decision":"approve-all","bypass":true,"cappedTo":${CANDIDATE_CAP},"rankedFreshCount":${rankedFresh.length}}.

fresh: ${JSON.stringify(rankedFresh)}
dropped: ${JSON.stringify(dropped)}

Return {"logged":true} once every record above has been appended.`,
  { phase: 'Recon', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: 'recon:log' }
)

if (!capped.length) {
  log('Recon found no fresh, unclaimed candidates — nothing to fix or ship this run.')
  return { farmRunId, direction, candidatesConsidered: rankedFresh.length, candidatesRun: 0, droppedByCap: [], shipped: [], handedOff: [] }
}

// SECURITY_ASSESS returns raw signals only — the channel decision itself is computed in JS below
// (isDispatchSafe), never left to the model. Keeps the one place that decides "does this touch a
// third party's repo unattended" auditable and impossible for a prompt to talk itself past.
const SECURITY_ASSESS_SCHEMA = {
  type: 'object',
  required: ['pocVerdict', 'reachability', 'marginalRiskSmall', 'fixMechanical', 'contribPolicyForbidsDirectPR'],
  properties: {
    pocVerdict: { type: 'string', enum: ['confirmed-exploitable', 'confirmed-not-exploitable', 'inconclusive-could-not-execute'] },
    pocCode: { type: 'string' },
    pocCommand: { type: 'string' },
    pocOutput: { type: 'string' },
    reachability: { type: 'string', description: 'remote-unauthenticated / remote-authenticated / local-only / operator-only-not-exploitable' },
    marginalRiskSmall: { type: 'boolean', description: 'true only if exploiting this needs a precondition that already implies far more compromise than this bug itself grants' },
    marginalRiskRationale: { type: 'string' },
    fixMechanical: { type: 'boolean', description: 'true only for a small, obviously-safe diff — no design decisions, no new API surface' },
    fixRationale: { type: 'string' },
    contribPolicyForbidsDirectPR: { type: 'boolean', description: 'true if CONTRIBUTING.md/SECURITY.md says to report security issues privately rather than via a public PR' },
    contribRequirements: { type: 'string', description: 'any PR requirements found (signed commits/DCO, template, issue-first) — empty if none' },
    severity: { type: 'string', description: 'conservative — pair with marginalRiskRationale, do not overstate' },
  },
}

// Isolated so the channel logic is one auditable expression, not scattered through the pipeline.
// Deliberately asymmetric: any doubt on any signal falls back to the disk-only branch.
const isDispatchSafe = a =>
  !!a && a.pocVerdict === 'confirmed-exploitable' && a.fixMechanical === true && a.marginalRiskSmall === true && a.contribPolicyForbidsDirectPR !== true

// ---- Phase 2/3/4: per-candidate pipeline (TRIAGE -> FIX/escalate -> PR) --------
// pipeline() gives each candidate its own stage chain with no barrier between
// stages — repo A can be at PR while repo B is still triaging. Concurrency is
// capped at 5 in-flight by construction: `capped` never holds more than 5 items.
const settled = await pipeline(
  capped,

  // Stage 1 — clone/sync the farm's clone cache, then crg-debug --detect-only.
  async candidate => {
    const clone = await agent(
      `Resolve the working tree for ${candidate.repo} in the crg-farm clone cache at ${reposRoot}/${candidate.repo}. ` +
        `If missing: \`gh repo clone ${candidate.repo} ${reposRoot}/${candidate.repo}\`. ` +
        `If present: fetch + hard-sync to the default branch (\`git fetch origin && git checkout <default-branch> && git reset --hard origin/<default-branch> && git clean -fd\`) — ` +
        `this is the farm's own cache, not a human's working copy, so a hard reset is safe and guarantees a clean tree. Return the absolute repoRoot.`,
      { phase: 'Triage', schema: { type: 'object', required: ['repoRoot'], properties: { repoRoot: { type: 'string' } } }, label: `clone:${candidate.repo}` }
    )
    if (!clone || !isAbsSafe(clone.repoRoot)) {
      return { candidate, outcome: 'handed-to-human', reason: 'clone-cache resolution failed or returned an unsafe path' }
    }
    const triage = await workflow(
      { scriptPath: crgDebugPath },
      { repoRoot: clone.repoRoot, issueContext: candidate.title, issueRef: candidate.issueRef, model: 'haiku', fix: false, methodologyPath, env }
    )
    // Env couldn't be built at this rung — crg-debug bailed rather than manufacture false bugs.
    // Clean hand-off, NOT an escalation: no tier climb closes an unbuildable environment.
    if (triage && triage.status === 'unfarmable') {
      const unfarmReason = triage.reason || `environment not buildable (env=${env})`
      // Record the verdict so future recons demote this repo before the cap (#1.5) instead of
      // re-learning it the expensive way. Keyed by repo+env — a repo unbuildable in `container`
      // may still be farmable in `none`.
      await agent(
        `Append one farm-DB "buildability" record via \`node ${farmDbPath} append\`: {"type":"buildability","farmRunId":"${farmRunId}","repo":"${candidate.repo}","env":"${env}","verdict":"unfarmable","keyOf":"${candidate.repo}::${env}","reason":${JSON.stringify(unfarmReason)}} on stdin. Return {"logged":true}.`,
        { phase: 'Triage', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: `log-unfarmable:${candidate.repo}` }
      )
      return { candidate, repoRoot: clone.repoRoot, outcome: 'unfarmable', reason: unfarmReason }
    }
    if (!triage || !(triage.confirmedBugs || []).length) {
      return { candidate, repoRoot: clone.repoRoot, outcome: 'no-bugs-confirmed' }
    }

    // Security classification against the fixed checklist in methodology.md's §Security
    // classification. Conservative by design — if ANY confirmed bug in this batch is flagged, the
    // whole candidate goes through the advisory track below rather than partially proceeding.
    const secCheck = await agent(
      `Classify each of these confirmed bugs against the fixed security checklist in methodology.md's §Security classification & the advisory track (${methodologyPath}) — injection, auth/authz bypass, secrets exposure, SSRF/path-traversal, insecure deserialization, crypto misuse, memory-safety reachable from attacker input. Conservative on purpose: flag anything that plausibly fits even if reachability is unclear.\n\nconfirmedBugs: ${JSON.stringify(triage.confirmedBugs)}`,
      {
        phase: 'Triage',
        schema: { type: 'object', required: ['securitySensitive'], properties: { securitySensitive: { type: 'boolean' }, vulnClasses: { type: 'array', items: { type: 'string' } } } },
        label: `sec-classify:${candidate.repo}`,
      }
    )
    if (!secCheck || !secCheck.securitySensitive) {
      return { candidate, repoRoot: clone.repoRoot, ledgerPath: triage.ledgerPath, confirmedBugs: triage.confirmedBugs }
    }

    const vulnClasses = secCheck.vulnClasses || []
    // §Security classification, advisory track steps 1-3, run as one concise pass: a quick PoC (the
    // smallest input/script that proves the point, not an exploit demo), a quick hop-by-hop trace
    // ending in a reachability + marginal-risk verdict, and a check of the target repo's own
    // CONTRIBUTING.md/SECURITY.md. All three feed isDispatchSafe() above, which — not this prompt —
    // makes the actual channel call.
    const secAssess = await agent(
      `A confirmed security-sensitive bug in ${clone.repoRoot} (${candidate.repo} ${candidate.issueRef}, vuln class(es): ${vulnClasses.join(', ') || 'unspecified'}). Run steps 1-3 of the advisory track from methodology.md §"Security classification & the advisory track" (${methodologyPath}) against the REAL cloned code — keep every part of this QUICK, no extra fluff:
1. PoC-VERIFY (quick): write and ACTUALLY RUN the smallest possible non-destructive PoC (a crafted input through the real function/class, a harmless side effect as proof). If you cannot build/run it, say so honestly and return pocVerdict "inconclusive-could-not-execute" — never fabricate a passing PoC.
2. TRACE-EXPLOIT-PATH (quick): grep every call site of the vulnerable sink, follow the taint from an attacker-reachable input to it — one line per hop, not a paragraph. Return a reachability verdict AND marginalRiskSmall: true ONLY if reaching the sink requires the attacker to already hold a precondition (e.g. already compromising the target's own core trusted infrastructure) that dwarfs what this bug itself grants.
3. CHECK-CONTRIB-POLICY (quick): fetch CONTRIBUTING.md and SECURITY.md from the repo root (\`gh api repos/${candidate.repo}/contents/SECURITY.md\`, \`gh api repos/${candidate.repo}/contents/CONTRIBUTING.md\` — a 404 just means no stated policy). Set contribPolicyForbidsDirectPR: true ONLY if either explicitly says to report security issues privately rather than via a public PR. Note any other PR requirements found (signed commits/DCO, template, issue-first) in contribRequirements.

Also set fixMechanical: true ONLY if the fix is a small, obviously-safe diff with no design decisions and no new API surface (e.g. swap a shell-interpolated subprocess call for an arg-list one, add a format check) — false for anything needing maintainer judgment. Estimate severity conservatively: pair it with marginalRiskRationale, never inflate past what the PoC and trace actually showed.

confirmedBugs: ${JSON.stringify(triage.confirmedBugs)}`,
      { phase: 'Advisory', schema: SECURITY_ASSESS_SCHEMA, label: `sec-assess:${candidate.repo}` }
    )

    // A false positive at PoC time isn't actually security-sensitive — rejoin the normal pipeline.
    if (secAssess && secAssess.pocVerdict === 'confirmed-not-exploitable') {
      return { candidate, repoRoot: clone.repoRoot, ledgerPath: triage.ledgerPath, confirmedBugs: triage.confirmedBugs }
    }

    if (isDispatchSafe(secAssess)) {
      // GATE-DISPATCH-CHANNEL computed pr-with-motivation: rejoin the SAME shape a normal bug
      // returns from this stage, so Stage 2/3's existing fix+PR code runs unchanged. securityPr
      // carries the PR-body constraint and any contribution requirements through to Stage 3.
      await agent(
        `Append one farm-DB "gate" record via \`node ${farmDbPath} append\`: {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-DISPATCH-CHANNEL","decision":"pr-with-motivation","bypass":true,"repo":"${candidate.repo}","reason":${JSON.stringify(secAssess.fixRationale || secAssess.marginalRiskRationale || 'mechanical fix, small marginal risk, no policy objection')}} on stdin. Return {"logged":true}.`,
        { phase: 'Advisory', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: `log-dispatch:${candidate.repo}` }
      )
      return {
        candidate,
        repoRoot: clone.repoRoot,
        ledgerPath: triage.ledgerPath,
        confirmedBugs: triage.confirmedBugs,
        securityPr: { vulnClasses, contribRequirements: secAssess.contribRequirements || '' },
      }
    }

    // Fallback: advisory-report, disk-only, never transmitted. Any one unfavorable signal lands
    // here — the asymmetry is deliberate.
    const advisoryPath = await agent(
      `Get the report path: \`node ${farmDbPath} advisory-path '${candidate.repo}' '${candidate.repo}::${candidate.issueRef}'\`. Write a SHORT Markdown report there — quick PoC, one-paragraph summary, the fix, the conservative severity line, full stop. Not a forensic writeup; skip anything that doesn't change what the reader should do. Sections: summary (2-4 sentences: what's wrong, where, why it matters), affected file(s)/line(s), vuln class, the PoC (kept minimal — code/command/output from step 1 above), reachability + marginal-risk verdict (one line each), the conservative severity, a one-to-two-sentence suggested fix (prose/diff form, NOT applied, NOT committed — do not modify, stage, or commit any file in the repo working tree), and a blank "## Disclosure timeline" section. Then append one advisory record: \`node ${farmDbPath} append\` with {"type":"advisory","farmRunId":"${farmRunId}","repo":"${candidate.repo}","issueRef":"${candidate.issueRef}","keyOf":"${candidate.repo}::${candidate.issueRef}","vulnClass":${JSON.stringify(vulnClasses.join(', ') || 'unspecified')},"severity":${JSON.stringify(secAssess && secAssess.severity || 'unknown')},"pocVerdict":${JSON.stringify(secAssess && secAssess.pocVerdict || 'inconclusive-could-not-execute')},"reportPath":"<path>","decision":"save-only"} on stdin.

GATE-ADVISORY-REVIEW is auto-passed to save-only under --auto-bypass: DO NOT file, email, open an issue/PR, or otherwise transmit the report anywhere. Return the report path.

Why this fell back to a report instead of a PR: ${JSON.stringify({
        pocVerdict: secAssess && secAssess.pocVerdict,
        fixMechanical: secAssess && secAssess.fixMechanical,
        marginalRiskSmall: secAssess && secAssess.marginalRiskSmall,
        contribPolicyForbidsDirectPR: secAssess && secAssess.contribPolicyForbidsDirectPR,
      })}`,
      { phase: 'Advisory', schema: { type: 'object', required: ['reportPath'], properties: { reportPath: { type: 'string' } } }, label: `advisory:${candidate.repo}` }
    )
    return {
      candidate,
      repoRoot: clone.repoRoot,
      outcome: 'advisory-compiled',
      reportPath: advisoryPath && advisoryPath.reportPath,
      severity: secAssess && secAssess.severity,
      pocVerdict: secAssess && secAssess.pocVerdict,
      reachability: secAssess && secAssess.reachability,
      vulnClasses,
    }
  },

  // Stage 2 — FIX with escalation. A regression climbs to the next, strictly
  // higher tier — never a retry of the tier that just failed; every tier gets
  // exactly one shot. Regression at maxTier itself hands off immediately.
  // unfixed-but-clean escalates freely up the ladder, same rule.
  async (triaged, candidate) => {
    // Candidates that already settled in Stage 1 (advisory-compiled, unfarmable, no-bugs-confirmed)
    // carry a pre-set outcome and just fall through untouched.
    if (triaged.outcome) return triaged

    const tierPick = await agent(
      `For each unique file among these confirmed bugs, call mcp__code-review-graph__get_impact_radius_tool against the repo at ${triaged.repoRoot} and combine blast radius + severity + language penalty per methodology.md's §Complexity scoring (${methodologyPath}) to recommend ONE starting fix tier for this whole batch: haiku, sonnet, or opus.\n\nconfirmedBugs: ${JSON.stringify(triaged.confirmedBugs)}`,
      { phase: 'Fix', schema: { type: 'object', required: ['tier'], properties: { tier: { type: 'string', enum: TIERS } } }, label: `tier:${candidate.repo}` }
    )
    let tier = (tierPick && tierPick.tier) || 'haiku'
    let ledgerPath = triaged.ledgerPath
    let regressionEscalations = 0
    let fixRet = null
    let outcome = null
    let reason = null

    // Hard backstop against a pathological infinite loop; every real exit path
    // above (clean+fixed, regression cap, tier cap) fires well before this.
    for (let attempt = 0; attempt < 6 && !outcome; attempt++) {
      fixRet = await workflow({ scriptPath: crgDebugPath }, { repoRoot: triaged.repoRoot, fromLedger: ledgerPath, fix: true, model: tier, methodologyPath })
      const fx = (fixRet && fixRet.fix) || { fixed: [], unfixed: [], finalGate: { clean: false } }
      const clean = !!(fx.finalGate && fx.finalGate.clean)
      const unfixed = fx.unfixed || []

      if (!clean) {
        regressionEscalations++
        const nt = nextTier(tier, maxTier)
        if (!nt) {
          outcome = 'handed-to-human'
          reason = `regression at the top tier (${tier}) — one shot per tier, no retry, no higher tier left`
          break
        }
        await agent(
          `A crg-debug fix pass on ${triaged.repoRoot} regressed the final gate. Revert every file the working tree currently has dirty so the next tier starts from a clean RED, not a broken fix: run \`git -C ${triaged.repoRoot} diff --name-only\` then \`git -C ${triaged.repoRoot} checkout -- <those files>\`. Do not touch anything else.`,
          { phase: 'Fix', schema: { type: 'object', required: ['reverted'], properties: { reverted: { type: 'array', items: { type: 'string' } } } }, label: `revert:${candidate.repo}` }
        )
        tier = nt // always a strictly higher tier — never a retry of the one that just regressed
        continue
      }

      if (unfixed.length === 0) {
        outcome = 'fixed'
        break
      }

      if (tier === maxTier) {
        outcome = 'handed-to-human'
        reason = `${unfixed.length} bug(s) still unfixed at the tier cap (${maxTier})`
        break
      }

      const sliced = await agent(
        `Write a JSON file to ${triaged.repoRoot}/.crg-debug/ledger-retry-${attempt}.json containing exactly {"confirmedBugs": <the array below, unchanged>} and nothing else — do not reformat, wrap in markdown, or add fields. Then return that absolute path.\n\nunfixed bugs to retry: ${JSON.stringify(unfixed)}`,
        { phase: 'Fix', schema: { type: 'object', required: ['ledgerPath'], properties: { ledgerPath: { type: 'string' } } }, label: `slice:${candidate.repo}` }
      )
      if (!sliced || !isAbsSafe(sliced.ledgerPath)) {
        outcome = 'handed-to-human'
        reason = 'could not write sliced retry ledger'
        break
      }
      ledgerPath = sliced.ledgerPath
      tier = nextTier(tier, maxTier)
    }

    await agent(
      `Append one farm-DB "attempt" record via \`node ${farmDbPath} append\`: {"type":"attempt","farmRunId":"${farmRunId}","repo":"${candidate.repo}","issueRef":"${candidate.issueRef}","tier":"${tier}","outcome":"${outcome || 'handed-to-human'}","regressionEscalations":${regressionEscalations}} on stdin. Return {"logged":true}.`,
      { phase: 'Fix', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: `log-attempt:${candidate.repo}` }
    )

    return { candidate, repoRoot: triaged.repoRoot, tier, outcome: outcome || 'handed-to-human', reason, fixRet, securityPr: triaged.securityPr }
  },

  // Stage 3 — GATE-DIFF auto-approved (commit + push + open draft PR), GATE-SUBMIT
  // always logged as keep-draft (never bypassed by any flag) — or a hand-off report.
  async (fixed, candidate) => {
    // advisory-compiled candidates already wrote their report and logged it in Stage 1; they never
    // touch GATE-DIFF/PR-PREP/GATE-SUBMIT.
    if (fixed.outcome === 'advisory-compiled') return fixed
    if (fixed.outcome !== 'fixed') {
      await agent(
        `Append one farm-DB "gate" record via \`node ${farmDbPath} append\`: {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-ESCALATE","decision":"hand-to-human","bypass":true,"repo":"${candidate.repo}","reason":${JSON.stringify(fixed.reason || fixed.outcome)}} on stdin. Return {"logged":true}.`,
        { phase: 'PR', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: `log-handoff:${candidate.repo}` }
      )
      return { candidate, outcome: fixed.outcome, reason: fixed.reason, prUrl: null }
    }

    const branch = `crg-farm/${slug(candidate.issueRef) || slug(candidate.title).slice(0, 40)}`
    const securityPr = fixed.securityPr
    const bodyInstruction = securityPr
      ? `This started as a security-sensitive finding (${(securityPr.vulnClasses || []).join(', ') || 'unspecified class'}) that GATE-DISPATCH-CHANNEL routed to a direct PR because the fix was mechanical and low marginal risk. The PR body and commit message MUST be capped at 1-3 sentences, written as one contributor to another — what was wrong, why the fix is safe. NO CVSS, NO reachability breakdown, NO report-style prose — the diff carries the technical content.${securityPr.contribRequirements ? ` Honor this repo's own contribution requirements: ${securityPr.contribRequirements}` : ''}`
      : `PR body: root cause per bug, before/after behavior, tests added, final-gate status, "Fixes ${candidate.issueRef}" — written as ordinary contributor prose, not a labeled template.`
    const pr = await agent(
      `The fix at ${fixed.repoRoot} closed clean (final gate green). Ship it per methodology.md's §PR-prep (${methodologyPath}), with GATE-DIFF auto-approved (this is an --auto-bypass harness run — no human will review this diff before it commits). GATE-SUBMIT is NOT bypassed by any flag: the PR stops at draft, always — never run \`gh pr ready\` or otherwise flip it to ready-for-review.
1. \`git -C ${fixed.repoRoot} remote get-url origin\` -> {owner,repo}. If push access is missing, \`gh repo fork --clone=false\` and retarget origin at the fork.
2. \`git -C ${fixed.repoRoot} checkout -b ${branch}\` off the default branch.
3. Stage ONLY the files crg-debug actually changed — enumerate with \`git -C ${fixed.repoRoot} diff --name-only\` against the default branch and \`git add\` those explicit paths. NEVER \`git add -A\`.
4. Commit with a plain, human-sounding message — no AI/Claude/Anthropic attribution anywhere (no co-author trailer, no tool credit, no session link, no emoji). Write it the way a contributor fixing this bug themselves would. Push the branch to the fork/origin.
5. \`gh pr create --draft\` targeting upstream's default branch. ${bodyInstruction} The PR body gets the same treatment: no AI/tool mention, ordinary contributor voice and cadence. Stop here — do not touch its ready/draft status.
6. Append farm-DB records via \`node ${farmDbPath} append\` (one call per record): a "gate" record for GATE-DIFF {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-DIFF","decision":"approve-for-PR","bypass":true,"repo":"${candidate.repo}"}; a "pr" record {"type":"pr","farmRunId":"${farmRunId}","repo":"${candidate.repo}","issueRef":"${candidate.issueRef}","url":"<prUrl>","state":"draft"}; a "gate" record for GATE-SUBMIT {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-SUBMIT","decision":"keep-draft","bypass":true,"repo":"${candidate.repo}"} — GATE-SUBMIT is logged for audit parity even though it always resolves to keep-draft under this flag.

Return the PR URL and the branch name.`,
      {
        phase: 'PR',
        schema: { type: 'object', required: ['prUrl', 'branch'], properties: { prUrl: { type: 'string' }, branch: { type: 'string' } } },
        label: `pr:${candidate.repo}`,
      }
    )
    return { candidate, outcome: 'shipped', tier: fixed.tier, prUrl: pr && pr.prUrl, state: 'draft', branch: pr && pr.branch, securitySensitive: !!securityPr }
  }
)

// settled is index-aligned with capped: a stage that throws (e.g. a subagent completes without
// structured output) drops that candidate's slot to null. Recover those slots as `errored` with the
// candidate's original identity instead of filtering them away — every capped candidate must appear
// in the run's outcome; a silent drop reads as "never ran" and loses the candidate entirely.
const results = capped.map((candidate, i) => settled[i] || {
  candidate,
  outcome: 'errored',
  reason: 'pipeline dropped this candidate — a stage subagent threw or completed without structured output (see the run failures log for the failing stage)',
})
const shipped = results.filter(r => r.outcome === 'shipped')
const advisories = results.filter(r => r.outcome === 'advisory-compiled')
const errored = results.filter(r => r.outcome === 'errored')
const handedOff = results.filter(r => !['shipped', 'advisory-compiled', 'errored'].includes(r.outcome))
const unfarmable = results.filter(r => r.outcome === 'unfarmable')
const securityPrs = shipped.filter(r => r.securitySensitive)

log(
  `Auto-bypass complete: ${shipped.length} PR(s) opened (${securityPrs.length} of them security fixes routed via GATE-DISPATCH-CHANNEL), ` +
    `${advisories.length} security advisory report(s) compiled (disk-only, never transmitted), ${handedOff.length} handed off` +
    (unfarmable.length ? ` (${unfarmable.length} unfarmable — env not buildable)` : '') +
    (errored.length ? `, ${errored.length} errored (pipeline drop — see failures log)` : '') +
    `, ${droppedByCap.length} candidate(s) ranked but past the top-${CANDIDATE_CAP} cap.`
)

return {
  farmRunId,
  direction,
  candidatesConsidered: rankedFresh.length,
  candidatesRun: capped.length,
  droppedByCap: droppedByCap.map(c => ({ repo: c.repo, issueRef: c.issueRef })),
  shipped,
  advisories,
  errored,
  handedOff,
}
