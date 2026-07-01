---
name: crg-farm
description: Bug-farming loop over crg-debug — sources real open bugs (scoped /xplore over a named repo, or a themed/wildcard GitHub search when unscoped), triages cheaply, escalates model only where repair struggles, and ships draft PRs, with human approval at every consequential boundary (or, under --auto-bypass, fully unattended through commit and an opened draft PR — never past draft). Security-sensitive findings are routed to a private, human-reviewed advisory track (PoC + exploit-path verification, never a public PR) instead, and are always excluded from --auto-bypass. Use for /crg-farm, "farm bugs", "find and PR real bugs on GitHub".
argument-hint: "[repo|topic|nothing=wildcard] [--repo <owner/repo|path>] [--issue <ref>] [--auto] [--auto-bypass] [--prose] [--model <start-tier>] [--max-tier <haiku|sonnet|opus>]"
user_invocable: true
---

# CRG Farm

A main-loop orchestrator that turns crg-debug into a repeatable bug-farming loop:

```
RECON (/xplore | gh search) → dedup → rank → GATE-RECON → TRIAGE (--detect-only) → GATE-TRIAGE
  security-sensitive bugs: → GATE-SECURITY-ROUTE → PoC-VERIFY → TRACE-EXPLOIT-PATH
    → SEVERITY-CALIBRATE → COMPILE-REPORT → GATE-ADVISORY-REVIEW → TRACK  (never reaches PR-PREP;
    the --auto-bypass harness excludes and hands these off instead of attempting the track)
  everything else: → FIX (--from-ledger, escalating) → GATE-ESCALATE
    → GATE-DIFF → PR-PREP → GATE-SUBMIT → TRACK
```

`--auto-bypass` is a **separate, standalone flag** from `--auto` (never implied by it, never
inferred from prior approvals): it auto-passes every gate through `GATE-DIFF` (commit), caps the
run at the top 5 ranked candidates run concurrently, and ends with a report of every draft PR
opened. It never touches `GATE-SUBMIT` — PRs always stop at draft, no matter what. See
`methodology.md` §Auto-bypass mode — read it before honoring this flag.

It **calls `crg-debug` as a primitive** (changing zero lines of the Workflow) and, in prose mode,
runs entirely in the main loop, because `/xplore` and `AskUserQuestion` are both main-loop-only.
Read `methodology.md` in this skill's directory first — it is the contract (Named-Gate Protocol,
complexity formula, escalation ladder, PR-prep, farm-DB record shapes). Execute it exactly.

**Prerequisite:** the deterministic crg-debug Workflow must be installed at
`$HOME/.claude/workflows/crg-debug.js` (the farm reads the Workflow's structured return to steer
escalation — prose mode can't provide that). If it's absent, tell the user to run
`/crg-deterministic` once, then stop.

## Prose vs. harness — which one runs

Default to **prose** (Steps 1-4 below), same as always. The exception is `--auto-bypass`: check
whether `$HOME/.claude/workflows/crg-debug.farm-bypass.js` is installed (the same
`crg-deterministic` enabler installs it) — if so, prefer it automatically, unless `--prose` was
also passed. When the harness runs, it replaces Steps 1-4 entirely with one call:

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-debug.farm-bypass.js',
  args: { direction, query, repo, issueRef, maxTier,
          methodologyPath: '$HOME/.claude/workflows/crg-debug.farm-methodology.md',
          crgDebugPath: '$HOME/.claude/workflows/crg-debug.js',
          farmDbPath: '$HOME/.claude/workflows/crg-debug.farm-db.mjs',
          reposRoot: '$HOME/.claude/crg-farm/repos', farmRunId } })
```

Await the return (`shipped[]`, `handedOff[]`, `droppedByCap[]`, `candidatesConsidered`) and go
straight to **After it returns** — the harness owns RECON/rank/cap, TRIAGE, FIX/escalation, and
PR-prep itself; nothing left to do in the main loop for that run. The harness sources scoped-mode
candidates via `gh issue list` only (no `/xplore` — Workflow agents can't call skills); if the
user needs a full code-level `/xplore` sweep of one repo under `--auto-bypass`, that requires
`--prose` too. `--auto-bypass` without the harness installed just runs Steps 1-4 in prose with
every gate below marked "Under `--auto-bypass`" honored the same way.

## Parse `$ARGUMENTS`

- **direction**: everything after the flags, resolved to a RECON mode
  (`methodology.md` §Sourcing candidates). **Never default to the current-directory repo** —
  that's a different tool (`/crg-debug` does that). Classify:
  - names a repo (`owner/repo`, a URL, a local path, or `--repo <ref>`) → **scoped**: RECON looks
    only at that repo.
  - other non-empty free text (a topic, symptom, or language) → **themed**: RECON runs a cross-repo
    `gh search` filtered by that text.
  - nothing at all → **wildcard**: RECON runs a fully open cross-repo `gh search`.
  `repoRoot` is **not** resolved here — each candidate's repo is cloned/synced lazily via the clone
  cache (`methodology.md` §Clone cache) once it survives GATE-RECON.
- **issue**: `--issue <ref>` (or an auto-detected GitHub ref) forces **scoped** mode against that
  ref's repo and seeds symptom-directed recon. Resolve it exactly as `/crg-debug` does (bundled
  issue-ref parser → `issueContext` / `issueRef`).
- **startTier**: `--model <haiku|sonnet|opus>` sets the FIRST fix tier (default: the complexity
  score's recommendation at GATE-TRIAGE, falling back to `haiku`).
- **maxTier**: `--max-tier` caps escalation (default `opus`).
- **auto**: `--auto` auto-passes SOFT gates with their recommended default (logged `auto:true`).
  `GATE-DIFF` and `GATE-SUBMIT` still block — always.
- **autoBypass**: `--auto-bypass` is a **separate flag from `--auto`** — never set implicitly, never
  inferred because `--auto` was also passed. When present, it auto-passes every gate through
  `GATE-DIFF` (commit) — including a HARD-promoted `GATE-ESCALATE`, which climbs to the next,
  strictly higher tier on a regression (never a retry of the tier that just failed — every tier
  gets exactly one shot, always) — logged `bypass:true` (never `auto:true`), truncates ranked
  candidates to the top 5, and runs their pipelines concurrently capped at 5 in-flight. It never
  resolves `GATE-SUBMIT` to `submit-upstream` — every PR it opens stops at draft. Full contract in
  `methodology.md` §Auto-bypass mode.
- **prose**: `--prose` forces the prose path below even if the harness Workflow
  (`crg-debug.farm-bypass.js`) is installed — same convention as `/crg-debug --prose`.

Generate a `farmRunId` (a short slug, e.g. from repo + issueRef) and append a `run` record to the
farm DB at the start.

## The farm DB (call at every stage)

`node $HOME/.claude/workflows/crg-debug.farm-db.mjs append` (record on stdin) and
`… query '<filter>'`. Record types + fields are in `methodology.md` (§Farm database). The
cross-run identity is `keyOf = norm(file)::norm(rootCause)`.

## Step 1 — RECON (mode-dependent sourcing) → GATE-RECON

Source candidates per the resolved mode (`methodology.md` §Sourcing candidates):

- **scoped** (a repo was named, or `--issue` given): clone/sync that repo via the clone cache, then
  run `/xplore` — framed as "open, PR-able bugs in `<repo>`", or with an issue, "reproduce and
  localize `<issueRef>` in `<repo>`, plus adjacent open defects" — alongside `gh issue list` for
  that repo, so code-level and filed-issue candidates both surface.
- **themed** (free-text direction, no repo): `gh search issues` filtered by the direction text,
  across all of GitHub. No `/xplore` here — `Explore` agents can't reach remote repos.
- **wildcard** (no direction at all): `gh search issues`, unthemed, quality-filtered to skip
  archived/stagnant repos.

Then run the **two-pass duplicate-fix check** (`methodology.md` §RECON) — the point is to farm only
bugs that are genuinely open AND not already being fixed:

1. **Farm-DB dedup:** drop any candidate whose `keyOf` already appears in a `pr` record (we shipped
   it) or was exhausted at the tier cap — `query '{"type":"pr"}'`.
2. **Upstream duplicate-fix check** (per surviving candidate): confirm the issue is still open and
   search the upstream repo for a PR/fix already addressing it —
   `gh issue view <n> -R <owner>/<repo> --json state,title,body`,
   `gh search prs "repo:<owner>/<repo> <n>" --state all --json number,title,state,url`,
   `gh pr list -R <owner>/<repo> --state open --search "<n> in:body,title"`, plus a keyword search
   on the bug's area for a PR that doesn't cite the number. Classify **fresh** (proceed) /
   **in-flight** (open PR — drop) / **already-fixed** (merged or on default branch, even unreleased
   — drop).

Append one `candidate` record per candidate with `status` and, when dropped, `competingPr` (the
duplicate PR's URL).

Then **rank the fresh candidates** (`methodology.md` §Ranking) before showing anything — an
unordered dump of 15-30 candidates isn't triageable. Per distinct repo, pull `stargazerCount` and
the last 5 merged-PR timestamps (`gh pr list -R <owner>/<repo> --state merged -L 5 --json
mergedAt,number`) to score **impact** (repo reach, weighted up for severe issue content — data
loss/corruption/security/safety — down for cosmetic) and **review-likelihood** (tight merge
spacing = fast; a stale gap since the last merge demotes a repo even if its historical cadence
looked fast). Sort impact-first, review-likelihood as tiebreaker/demotion. Record
`rankSignals: {stars, recentMergeSpanDays, daysSinceLastMerge}` on each candidate's farm-DB row.

**GATE-RECON** (soft): append a `gate-asked` record (`gate:'GATE-RECON'`, `farmRunId`), then show
the **fresh** candidates, ranked, to farm AND the dropped in-flight/already-fixed ones with their
competing PR URLs (so the human can override a stale/abandoned PR via add-context); options
approve-all *(Recommended)* / select-subset / add-context / abort. When the ranked list is too
long for a 4-option gate, execute `select-subset` as two steps: post the ranked list as plain text
(repo, issue, one-line impact/cadence rationale), then ask a compact follow-up `AskUserQuestion`
with cut points sized to the list (e.g. Top-5 *(Recommended)* / Top-10 / Top-N / Custom). Log the
`gate` decision. Under `--auto`, skip `gate-asked` — nothing is shown.

Under `--auto-bypass`: skip the ask — truncate the ranked list to the **top 5** and log
`approve-all` with `bypass:true`. This is the run's only candidate-selection point, so the cap
applies here regardless of how many candidates survived dedup.

## Step 2 — TRIAGE (`crg-debug --detect-only`) → GATE-TRIAGE

Group the approved candidates by repo. For each distinct repo, resolve `repoRoot` via the clone
cache (`methodology.md` §Clone cache — clone if missing, hard-sync to the default branch if
present), then run detection ONLY (no edits) via the Workflow directly — use `scriptPath` (NOT
`name`: the name registry is cached at session start and can be stale):

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-debug.js',
  args: { repoRoot, scope, issueContext, issueRef, model: 'haiku', fix: false,
          methodologyPath: '$HOME/.claude/workflows/crg-debug.methodology.md' } })
```

Await the return; it persists `.crg-debug/ledger.json` and returns `confirmedBugs`, `deferred`,
`rejected`. **Complexity score** each confirmed bug per `methodology.md` (§Complexity scoring):
call `mcp__code-review-graph__get_impact_radius_tool` per unique file, combine with severity +
language penalty + `conflicted`. Derive a recommended start tier per bug.

**GATE-TRIAGE** (soft, the steering gate): append a `gate-asked` record (`gate:'GATE-TRIAGE'`,
`farmRunId`, `repo`), then show confirmedBugs by severity with per-bug complexity and recommended
tier, plus deferred/rejected counts; options select-bugs *(Recommended: the confirmed
non-conflicted set)* / choose-tier / set-escalation-cap / abort. Log the decision. Under `--auto`,
skip `gate-asked` — nothing is shown.

Under `--auto-bypass`: skip the ask — take `select-bugs` (confirmed non-conflicted set) at the
complexity-recommended tier, logged with `bypass:true`.

If the human narrows to a subset, slice the ledger to that subset before fixing:
`node $HOME/.claude/workflows/crg-debug.ledger-slice.mjs <ledger.json> < keep.json > <scoped.json>`
(keep.json = the chosen bugs or their `keyOf`s).

## Step 2a — Security classification → GATE-SECURITY-ROUTE

Classify each `confirmedBugs[]` entry against the fixed checklist in `methodology.md` §Security
classification (same pass as complexity scoring) — `securitySensitive: true/false` + `vulnClass`.
Show security-sensitive bugs separately at GATE-TRIAGE, excluded from `select-bugs`'s default set.

If ≥1 of a repo's bugs is flagged, **GATE-SECURITY-ROUTE** (soft) fires once for that repo, right
after its GATE-TRIAGE: append a `gate-asked` record (`gate:'GATE-SECURITY-ROUTE'`, `farmRunId`,
`repo`), then show the flagged bugs + `vulnClass` + rationale; options advisory-track
*(Recommended)* / treat-as-normal-bug / drop / abort. Log the decision. `advisory-track` bugs go
to the **Security advisory track** below instead of Step 3; `treat-as-normal-bug` rejoins the
normal confirmedBugs set and proceeds through Step 3 like anything else. Under `--auto`, skip
`gate-asked` — the recommended default (`advisory-track`) is auto-passed, nothing is shown.

**Under the `--auto-bypass` harness, this gate is never reached.** The harness classifies the same
way inside its own Triage stage, but instead of running the advisory track it excludes the whole
candidate from FIX/PR and hands it off with the flagged `vulnClass`es in the reason — see
`workflows/crg-debug.farm-bypass.js`. Only the prose path (a plain `/crg-farm` run, or
`--auto-bypass --prose`) ever runs the track below.

## Security advisory track (bugs routed by GATE-SECURITY-ROUTE, prose path only)

Never reaches GATE-DIFF, PR-PREP, or GATE-SUBMIT — no code is committed or pushed. Per bug (or
tightly-coupled cluster sharing one root cause), per `methodology.md` §Security classification &
the advisory track:

1. **PoC-VERIFY**: write and actually run a minimal, non-destructive PoC against the real cloned
   code (§Clone cache) — a crafted malicious input through the real function/class, a harmless
   side effect as proof (never a destructive payload). Record the PoC code, exact command, full
   output, and a verdict: `confirmed-exploitable` / `confirmed-not-exploitable` /
   `inconclusive-could-not-execute`.
2. **TRACE-EXPLOIT-PATH**: grep every call site of the vulnerable function/sink and follow the
   taint hop by hop from an attacker-reachable input to the vulnerable line. Produces a
   reachability verdict (remote/unauthenticated, remote/authenticated, local-only,
   operator-only-not-exploitable) backed by evidence, not a guess.
3. **SEVERITY-CALIBRATE**: recompute severity from steps 1–2 (reachability × impact × PoC verdict)
   — independent of any severity label a discovery/fix agent attached upstream. Cap at "potential"
   when the PoC is inconclusive.
4. **COMPILE-REPORT**: write the report to `node $HOME/.claude/workflows/crg-debug.farm-db.mjs
   advisory-path '<owner/repo>' '<keyOf>'` (always outside the cloned repo's working tree) —
   summary, affected file(s)/line(s), `vulnClass`, root cause, the taint trace, the PoC
   (code/command/output), calibrated severity + rationale, a suggested fix in prose/diff form (not
   applied), and a blank disclosure-timeline section. Append an `advisory` record (`repo`, `keyOf`,
   `vulnClass`, `severity`, `pocVerdict`, `reportPath`).
5. **GATE-ADVISORY-REVIEW** (HARD by default — auto-passable under `--auto-bypass`, prose path
   only): append a `gate-asked` record (`gate:'GATE-ADVISORY-REVIEW'`, `farmRunId`, `repo`), then
   show the compiled report; options save-only *(Recommended)* / revise / discard / abort. Under
   `--auto-bypass`, skip `gate-asked` — `save-only` is auto-passed, nothing is shown. **Never
   file, email, or otherwise transmit the report on the human's behalf under any option, auto-passed
   or not** — disclosure channel and timing stay the human's call. Append a second `advisory`
   record with the final `decision`.

`close-run <farmRunId>` at TRACK here too (§Farm database) — the advisory track still closes out
its run participation even though it never reaches PR-PREP.

## Step 3 — FIX + escalation → GATE-ESCALATE

Fix from the (possibly sliced) ledger at the chosen `startTier`:

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-debug.js',
  args: { repoRoot, fromLedger: '<abs ledger path>', fix: true, model: '<tier>',
          methodologyPath: '$HOME/.claude/workflows/crg-debug.methodology.md' } })
```

Read `ret.fix = { fixed, unfixed, finalGate:{clean} }`; append an `attempt` record. Then follow
`methodology.md` (§Escalation) exactly:

- `unfixed` empty AND `finalGate.clean` → proceed to GATE-DIFF.
- `unfixed[]` present → **GATE-ESCALATE (soft)**; append a `gate-asked` record
  (`gate:'GATE-ESCALATE'`, `farmRunId`, `repo`) before asking; options `escalate-tier`
  *(Recommended)* / `stop-keep-fixed` / `hand-to-human` / `abort`. On `escalate-tier`, slice the
  ledger to the unfixed `keyOf`s and re-invoke `--from-ledger` at the next tier
  (haiku→sonnet→opus, capped at `maxTier`). Under `--auto`, skip `gate-asked` — `escalate-tier` is
  auto-passed, nothing is shown.
- `finalGate.clean === false` (regression) → **GATE-ESCALATE promoted to HARD**, show the
  regressing diff; escalate at most once, then require a human.
- Tier cap reached with `unfixed[]` still open → **GATE-ESCALATE hard**, `hand-to-human`: keep the
  fixed bugs + RED repro tests, stop.

Never re-invoke over the full ledger — always slice to the unfixed set so a higher model never
re-runs already-green bugs (they'd fail RED and be mislabeled). Log each pass as an `attempt`.

Under `--auto-bypass`: every branch above auto-passes (`escalate-tier` up to `maxTier`, logged
`bypass:true`) **except** the terminal ones. A HARD-promoted regression climbs to the next,
strictly higher tier — never a retry of the tier that just failed; every tier gets exactly one
shot, always. That means a `haiku` start can climb through two regressions (to `sonnet`, then
`opus`) before running out of ladder. If the regression is still unclean once `maxTier` itself has
regressed, or the tier cap is reached with `unfixed[]` open, that candidate is dropped from
GATE-DIFF/PR-prep and recorded as `handed-to-human` for the final report — the run continues with
the other candidates rather than stopping. Launch each repo's
pipeline as soon as its ledger is ready rather than waiting for sibling repos to finish
RECON/TRIAGE — concurrency is capped at 5 in-flight `Workflow` invocations, satisfied by
construction since GATE-RECON already capped candidates at 5.

## Step 4 — GATE-DIFF (HARD) → PR-PREP → GATE-SUBMIT (HARD) → TRACK

**GATE-DIFF** (HARD — ignores `--auto`; only `--auto-bypass` crosses it unattended): append a
`gate-asked` record (`gate:'GATE-DIFF'`, `farmRunId`, `repo`), then show `git -C <repo> diff`, the
touched files, and the final-gate status; options approve-for-PR *(Recommended if gate green)* /
revert-files / commit-local-only / abort. Nothing is committed before this returns approval.

On approve-for-PR, run **PR-PREP** per `methodology.md` (fork if needed via `gh repo fork`, branch
`crg-farm/<issue-or-slug>`, stage only the changed files by name, commit with the co-author
trailer, push to the fork, `gh pr create --draft`, body from the ledger with `Fixes <issueRef>`).
Append a `pr` record (`state:'draft'`).

**GATE-SUBMIT** (HARD — never auto-passes under `--auto`, and never resolved to `submit-upstream`
by `--auto-bypass` either): append a `gate-asked` record (`gate:'GATE-SUBMIT'`, `farmRunId`,
`repo`), then show the draft PR URL, branch, upstream target, PR body, and diff summary; options
submit-upstream / keep-draft *(Recommended)* / keep-local / abort. Only on `submit-upstream` do you
flip the draft to ready (`gh pr ready`). Append a `pr` record with the new `state`.

Under `--auto-bypass`: for any candidate whose final gate is clean, take `approve-for-PR` at
GATE-DIFF (logged `bypass:true`), run PR-PREP as above, then log GATE-SUBMIT as `keep-draft`
(logged `bypass:true` too, for audit parity) and **stop there** — do not run `gh pr ready` or
otherwise touch the PR's ready state. Candidates that were handed-to-human at the escalation step
(§Step 3) skip GATE-DIFF/PR-PREP/GATE-SUBMIT entirely — nothing is ever committed or pushed for an
unclean diff, bypass or not.

**TRACK:** `node $HOME/.claude/workflows/crg-debug.farm-db.mjs close-run <farmRunId>` to append the
`run-end` record — do this here on the happy path, or right after logging an `abort` gate decision
at any earlier step. The farm DB now holds the full audit trail for this `farmRunId` — run,
candidates, gate decisions (each pairable to its `gate-asked` via `gate-waits <farmRunId>` for
exact human-wait time), fix attempts, PR outcomes, advisory reports, and duration.

## After it returns

Summarize: candidates sourced, bugs confirmed/fixed/handed-to-human, the tier each bug closed at,
any draft/submitted PR URLs, and any security advisories compiled (path + severity + decision).
Nothing crossed GATE-DIFF or GATE-SUBMIT without an explicit human "yes" — or, under
`--auto-bypass`, without that flag having been passed by name for this run. No security-sensitive
bug entered the normal PR pipeline, bypass or not. Point the user at
`~/.claude/crg-farm/history.jsonl` for the durable record, and at `~/.claude/crg-farm/advisories/`
for any compiled reports.

**Under `--auto-bypass`**, this summary is mandatory and is the deliverable of the run (the human
saw no gates): for each of the ≤5 candidates, report repo + issue, the tier it closed at, and
either the **draft** PR URL (still awaiting a human `submit-upstream` before any maintainer sees
it) or the hand-off reason + clone-cache path to its RED repro tests — including a security
exclusion, called out explicitly so the human knows to re-run that candidate through the prose
advisory track. Every `bypass:true` gate decision for this `farmRunId` is queryable in the farm DB
for audit.
