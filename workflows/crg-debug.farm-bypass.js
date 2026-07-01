export const meta = {
  name: 'crg-farm-bypass',
  description:
    'The harness-held option for /crg-farm --auto-bypass: RECON + two-pass dedup + impact x review-likelihood rank, capped in real code to the top 5 -> per-repo TRIAGE (security-sensitive bugs are classified and auto-routed to the advisory track — PoC-verify + exploit-path trace + calibrated report compiled to disk, never auto-PR-ed, never transmitted) -> FIX with escalation (a regression climbs to the next, strictly higher tier — never a retry of the tier that just failed; every tier gets exactly one shot) -> auto commit/push/open a draft PR. GATE-SUBMIT is never crossed by this script or any flag — every PR stops at draft. Every cap, retry limit, security exclusion, and gate this script crosses is enforced in JS, not trusted to a model following a prompt.',
  whenToUse:
    'Requires args {direction: "themed"|"wildcard"|"scoped", query?, repo?, issueRef?, maxTier?, methodologyPath, crgDebugPath, farmDbPath, reposRoot, farmRunId}. Invoke ONLY when the user has explicitly passed --auto-bypass to /crg-farm and this file is installed (the crg-deterministic enabler copies it alongside crg-debug.js). Never invoke for the default, gated /crg-farm flow — that one needs AskUserQuestion and stays in the main loop.',
  phases: [
    { title: 'Recon', detail: 'gh search/issue-list + two-pass dedup + rank, capped to top 5' },
    { title: 'Triage', detail: 'clone/sync + provision a dedicated cached container env + crg-debug --detect-only per candidate repo (unbuildable envs hand off as unfarmable), then a security classification pass that excludes any security-sensitive bug from FIX/PR and auto-routes it to the advisory track' },
    { title: 'Advisory', detail: 'security-sensitive candidates auto-routed here: PoC-verify + trace exploit path + calibrate severity + compile a report to disk. Never a fix, never a commit, never a PR, never transmitted — stops at save-only' },
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

Then rank the FRESH candidates only, per methodology.md's §Ranking: per distinct repo pull \`stargazerCount\` (\`gh repo view\`) and the last 5 merged-PR timestamps (\`gh pr list -R <owner>/<repo> --state merged -L 5 --json mergedAt,number\`) for review-cadence signals (tight spacing = active review; a stale gap since the last merge demotes a repo even if historical cadence looked fast). Score impact from the issue body itself — data-loss/security/safety bugs outrank plain functional breakage, which outranks cosmetic issues; a small low-star repo with a severe bug can outrank a huge repo with a cosmetic one. Sort fresh[] impact-first, review-likelihood as tiebreaker/demotion — index 0 is the top pick.

Return the ranked fresh[] array and the dropped[] (in-flight/already-fixed) array with competingPr URLs where applicable.`,
  { phase: 'Recon', schema: RECON_SCHEMA, label: 'recon' }
)

const rankedFresh = (recon && recon.fresh) || []
const dropped = (recon && recon.dropped) || []
const capped = rankedFresh.slice(0, CANDIDATE_CAP)
const droppedByCap = rankedFresh.slice(CANDIDATE_CAP)

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

const ADVISORY_SCHEMA = {
  type: 'object',
  required: ['reportPath', 'severity', 'pocVerdict'],
  properties: {
    reportPath: { type: 'string' },
    severity: { type: 'string' },
    pocVerdict: { type: 'string', enum: ['confirmed-exploitable', 'confirmed-not-exploitable', 'inconclusive-could-not-execute'] },
    reachability: { type: 'string' },
  },
}

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
      return { candidate, repoRoot: clone.repoRoot, outcome: 'unfarmable', reason: triage.reason || `environment not buildable (env=${env})` }
    }
    if (!triage || !(triage.confirmedBugs || []).length) {
      return { candidate, repoRoot: clone.repoRoot, outcome: 'no-bugs-confirmed' }
    }

    // Security exclusion: classify against the fixed checklist in methodology.md's §Security
    // classification. Conservative by design — if ANY confirmed bug in this batch is flagged, the
    // whole candidate is excluded from FIX/PR-prep rather than partially proceeding. The harness
    // never attempts PoC-VERIFY/TRACE-EXPLOIT-PATH/COMPILE-REPORT itself; that judgment-heavy work
    // stays in the prose path, where a human reviews the compiled report at GATE-ADVISORY-REVIEW.
    const secCheck = await agent(
      `Classify each of these confirmed bugs against the fixed security checklist in methodology.md's §Security classification & the advisory track (${methodologyPath}) — injection, auth/authz bypass, secrets exposure, SSRF/path-traversal, insecure deserialization, crypto misuse, memory-safety reachable from attacker input. Conservative on purpose: flag anything that plausibly fits even if reachability is unclear.\n\nconfirmedBugs: ${JSON.stringify(triage.confirmedBugs)}`,
      {
        phase: 'Triage',
        schema: { type: 'object', required: ['securitySensitive'], properties: { securitySensitive: { type: 'boolean' }, vulnClasses: { type: 'array', items: { type: 'string' } } } },
        label: `sec-classify:${candidate.repo}`,
      }
    )
    if (secCheck && secCheck.securitySensitive) {
      // Auto-route to the advisory track (handled in Stage 2). It never turns into a fix/commit/PR
      // and never transmits — it compiles a report to disk and stops at save-only.
      return {
        candidate,
        repoRoot: clone.repoRoot,
        ledgerPath: triage.ledgerPath,
        confirmedBugs: triage.confirmedBugs,
        vulnClasses: secCheck.vulnClasses || [],
        outcome: 'security-advisory',
      }
    }

    return { candidate, repoRoot: clone.repoRoot, ledgerPath: triage.ledgerPath, confirmedBugs: triage.confirmedBugs }
  },

  // Stage 2 — FIX with escalation. A regression climbs to the next, strictly
  // higher tier — never a retry of the tier that just failed; every tier gets
  // exactly one shot. Regression at maxTier itself hands off immediately.
  // unfixed-but-clean escalates freely up the ladder, same rule.
  async (triaged, candidate) => {
    // Security-sensitive → advisory track, auto-routed. Runs PoC-VERIFY -> TRACE-EXPLOIT-PATH ->
    // SEVERITY-CALIBRATE -> COMPILE-REPORT and stops at save-only (GATE-ADVISORY-REVIEW auto-passed).
    // The report is written to disk for the human; it is NEVER fixed, committed, PR-ed, filed,
    // emailed, or otherwise transmitted on the human's behalf under any flag.
    if (triaged.outcome === 'security-advisory') {
      const adv = await agent(
        `A confirmed security-sensitive bug in ${triaged.repoRoot} (${candidate.repo} ${candidate.issueRef}, vuln class(es): ${(triaged.vulnClasses || []).join(', ') || 'unspecified'}) is routed to the advisory track. Run the full track from methodology.md §"Security classification & the advisory track" (${methodologyPath}) against the REAL cloned code, in order:
1. PoC-VERIFY: write and ACTUALLY RUN a minimal, non-destructive PoC (a crafted input through the real function/class, a harmless side effect as proof — never a destructive payload). Record the PoC code, the exact command, the full output, and a verdict: confirmed-exploitable / confirmed-not-exploitable / inconclusive-could-not-execute. If you cannot build/run the code, say so honestly and use inconclusive — never fabricate a passing PoC.
2. TRACE-EXPLOIT-PATH: grep every call site of the vulnerable sink and follow the taint hop by hop from an attacker-reachable input to the vulnerable line. Produce a reachability verdict (remote-unauthenticated / remote-authenticated / local-only / operator-only-not-exploitable) backed by evidence.
3. SEVERITY-CALIBRATE: recompute severity from steps 1-2 (reachability x impact x PoC verdict), independent of any upstream label. Cap at "potential" when the PoC is inconclusive.
4. COMPILE-REPORT: get the report path with \`node ${farmDbPath} advisory-path '${candidate.repo}' '${candidate.repo}::${candidate.issueRef}'\` (always OUTSIDE the cloned repo tree) and write the report there — summary, affected file(s)/line(s), vuln class, root cause, the taint trace, the PoC (code/command/output), calibrated severity + rationale, a suggested fix in prose/diff form (NOT applied), and a blank "## Disclosure timeline" section. Then append one advisory record: \`node ${farmDbPath} append\` with {"type":"advisory","farmRunId":"${farmRunId}","repo":"${candidate.repo}","issueRef":"${candidate.issueRef}","keyOf":"${candidate.repo}::${candidate.issueRef}","vulnClass":${JSON.stringify((triaged.vulnClasses || []).join(', ') || 'unspecified')},"severity":"<calibrated>","pocVerdict":"<verdict>","reportPath":"<path>","decision":"save-only"} on stdin.

GATE-ADVISORY-REVIEW is auto-passed to save-only under --auto-bypass: DO NOT file, email, open an issue/PR, or otherwise transmit the report anywhere. DO NOT modify, stage, or commit any file in the repo working tree. Save the report to disk only. Return the report path, calibrated severity, PoC verdict, and reachability verdict.

confirmedBugs: ${JSON.stringify(triaged.confirmedBugs)}`,
        { phase: 'Advisory', schema: ADVISORY_SCHEMA, label: `advisory:${candidate.repo}` }
      )
      return {
        candidate,
        repoRoot: triaged.repoRoot,
        outcome: 'advisory-compiled',
        reportPath: adv && adv.reportPath,
        severity: adv && adv.severity,
        pocVerdict: adv && adv.pocVerdict,
        reachability: adv && adv.reachability,
        vulnClasses: triaged.vulnClasses || [],
      }
    }
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

    return { candidate, repoRoot: triaged.repoRoot, tier, outcome: outcome || 'handed-to-human', reason, fixRet }
  },

  // Stage 3 — GATE-DIFF auto-approved (commit + push + open draft PR), GATE-SUBMIT
  // always logged as keep-draft (never bypassed by any flag) — or a hand-off report.
  async (fixed, candidate) => {
    // Advisory-track candidates already compiled + logged their report in the Advisory stage; they
    // never touch GATE-DIFF/PR-PREP/GATE-SUBMIT. Pass straight through.
    if (fixed.outcome === 'advisory-compiled') return fixed
    if (fixed.outcome !== 'fixed') {
      await agent(
        `Append one farm-DB "gate" record via \`node ${farmDbPath} append\`: {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-ESCALATE","decision":"hand-to-human","bypass":true,"repo":"${candidate.repo}","reason":${JSON.stringify(fixed.reason || fixed.outcome)}} on stdin. Return {"logged":true}.`,
        { phase: 'PR', schema: { type: 'object', required: ['logged'], properties: { logged: { type: 'boolean' } } }, label: `log-handoff:${candidate.repo}` }
      )
      return { candidate, outcome: fixed.outcome, reason: fixed.reason, prUrl: null }
    }

    const branch = `crg-farm/${slug(candidate.issueRef) || slug(candidate.title).slice(0, 40)}`
    const pr = await agent(
      `The fix at ${fixed.repoRoot} closed clean (final gate green). Ship it per methodology.md's §PR-prep (${methodologyPath}), with GATE-DIFF auto-approved (this is an --auto-bypass harness run — no human will review this diff before it commits). GATE-SUBMIT is NOT bypassed by any flag: the PR stops at draft, always — never run \`gh pr ready\` or otherwise flip it to ready-for-review.
1. \`git -C ${fixed.repoRoot} remote get-url origin\` -> {owner,repo}. If push access is missing, \`gh repo fork --clone=false\` and retarget origin at the fork.
2. \`git -C ${fixed.repoRoot} checkout -b ${branch}\` off the default branch.
3. Stage ONLY the files crg-debug actually changed — enumerate with \`git -C ${fixed.repoRoot} diff --name-only\` against the default branch and \`git add\` those explicit paths. NEVER \`git add -A\`.
4. Commit with trailer \`Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>\`. Push the branch to the fork/origin.
5. \`gh pr create --draft\` targeting upstream's default branch; body: root cause per bug, before/after behavior, tests added, final-gate status, "Fixes ${candidate.issueRef}". Stop here — do not touch its ready/draft status.
6. Append farm-DB records via \`node ${farmDbPath} append\` (one call per record): a "gate" record for GATE-DIFF {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-DIFF","decision":"approve-for-PR","bypass":true,"repo":"${candidate.repo}"}; a "pr" record {"type":"pr","farmRunId":"${farmRunId}","repo":"${candidate.repo}","issueRef":"${candidate.issueRef}","url":"<prUrl>","state":"draft"}; a "gate" record for GATE-SUBMIT {"type":"gate","farmRunId":"${farmRunId}","gate":"GATE-SUBMIT","decision":"keep-draft","bypass":true,"repo":"${candidate.repo}"} — GATE-SUBMIT is logged for audit parity even though it always resolves to keep-draft under this flag.

Return the PR URL and the branch name.`,
      {
        phase: 'PR',
        schema: { type: 'object', required: ['prUrl', 'branch'], properties: { prUrl: { type: 'string' }, branch: { type: 'string' } } },
        label: `pr:${candidate.repo}`,
      }
    )
    return { candidate, outcome: 'shipped', tier: fixed.tier, prUrl: pr && pr.prUrl, state: 'draft', branch: pr && pr.branch }
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

log(
  `Auto-bypass complete: ${shipped.length} PR(s) opened, ${advisories.length} security advisory report(s) compiled, ${handedOff.length} handed off` +
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
