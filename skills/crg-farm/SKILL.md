---
name: crg-farm
description: Bug-farming loop over crg-debug — source real open bugs (via /xplore), triage cheaply, escalate model only where repair struggles, and ship draft PRs, with human approval at every consequential boundary. Use for /crg-farm, "farm bugs in this repo", "find and PR real bugs".
argument-hint: "[repo path] [focus/issue] [--issue <ref>] [--auto] [--model <start-tier>] [--max-tier <haiku|sonnet|opus>]"
user_invocable: true
---

# CRG Farm

A main-loop orchestrator that turns crg-debug into a repeatable bug-farming loop:

```
RECON (/xplore) → GATE-RECON → dedup → TRIAGE (--detect-only) → GATE-TRIAGE
  → FIX (--from-ledger, escalating) → GATE-ESCALATE → GATE-DIFF → PR-PREP → GATE-SUBMIT → TRACK
```

It **calls `crg-debug` as a primitive** (changing zero lines of the Workflow) and runs entirely in
the main loop, because `/xplore` and `AskUserQuestion` are both main-loop-only. Read
`methodology.md` in this skill's directory first — it is the contract (Named-Gate Protocol,
complexity formula, escalation ladder, PR-prep, farm-DB record shapes). Execute it exactly.

**Prerequisite:** the deterministic crg-debug Workflow must be installed at
`$HOME/.claude/workflows/crg-debug.js` (the farm reads the Workflow's structured return to steer
escalation — prose mode can't provide that). If it's absent, tell the user to run
`/crg-deterministic` once, then stop.

## Parse `$ARGUMENTS`

- **repoRoot**: explicit path or `--repo <path>`; else `git rev-parse --show-toplevel`. Not a git
  repo and no path → STOP and ask.
- **scope / issue**: non-flag text is the focus; `--issue <ref>` (or an auto-detected GitHub ref)
  seeds symptom-directed recon. Resolve it exactly as `/crg-debug` does (bundled issue-ref parser
  → `issueContext` / `issueRef`).
- **startTier**: `--model <haiku|sonnet|opus>` sets the FIRST fix tier (default: the complexity
  score's recommendation at GATE-TRIAGE, falling back to `haiku`).
- **maxTier**: `--max-tier` caps escalation (default `opus`).
- **auto**: `--auto` auto-passes SOFT gates with their recommended default (logged `auto:true`).
  `GATE-DIFF` and `GATE-SUBMIT` still block — always.

Generate a `farmRunId` (a short slug, e.g. from repo + issueRef) and append a `run` record to the
farm DB at the start.

## The farm DB (call at every stage)

`node $HOME/.claude/workflows/crg-debug.farm-db.mjs append` (record on stdin) and
`… query '<filter>'`. Record types + fields are in `methodology.md` (§Farm database). The
cross-run identity is `keyOf = norm(file)::norm(rootCause)`.

## Step 1 — RECON (`/xplore`) → GATE-RECON

Run `/xplore` to source candidates. Frame the topic from the args: with an issue, "reproduce and
localize <issueRef> in <repo>, plus adjacent open defects"; without, "open, PR-able bugs in
<repo>." `/xplore` fans out `Explore` agents and synthesizes a candidate list.

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

**GATE-RECON** (soft): show the **fresh** candidates to farm AND the dropped in-flight/already-fixed
ones with their competing PR URLs (so the human can override a stale/abandoned PR via add-context);
options approve-all *(Recommended)* / select-subset / add-context / abort. Log the `gate` decision.

## Step 2 — TRIAGE (`crg-debug --detect-only`) → GATE-TRIAGE

For the approved candidates, run detection ONLY (no edits) via the Workflow directly — use
`scriptPath` (NOT `name`: the name registry is cached at session start and can be stale):

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-debug.js',
  args: { repoRoot, scope, issueContext, issueRef, model: 'haiku', fix: false,
          methodologyPath: '$HOME/.claude/workflows/crg-debug.methodology.md' } })
```

Await the return; it persists `.crg-debug/ledger.json` and returns `confirmedBugs`, `deferred`,
`rejected`. **Complexity score** each confirmed bug per `methodology.md` (§Complexity scoring):
call `mcp__code-review-graph__get_impact_radius_tool` per unique file, combine with severity +
language penalty + `conflicted`. Derive a recommended start tier per bug.

**GATE-TRIAGE** (soft, the steering gate): show confirmedBugs by severity with per-bug complexity
and recommended tier, plus deferred/rejected counts; options select-bugs *(Recommended: the
confirmed non-conflicted set)* / choose-tier / set-escalation-cap / abort. Log the decision.

If the human narrows to a subset, slice the ledger to that subset before fixing:
`node $HOME/.claude/workflows/crg-debug.ledger-slice.mjs <ledger.json> < keep.json > <scoped.json>`
(keep.json = the chosen bugs or their `keyOf`s).

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
- `unfixed[]` present → **GATE-ESCALATE (soft)**; on `escalate`, slice the ledger to the unfixed
  `keyOf`s and re-invoke `--from-ledger` at the next tier (haiku→sonnet→opus, capped at `maxTier`).
- `finalGate.clean === false` (regression) → **GATE-ESCALATE promoted to HARD**, show the
  regressing diff; escalate at most once, then require a human.
- Tier cap reached with `unfixed[]` still open → **GATE-ESCALATE hard**, `hand-to-human`: keep the
  fixed bugs + RED repro tests, stop.

Never re-invoke over the full ledger — always slice to the unfixed set so a higher model never
re-runs already-green bugs (they'd fail RED and be mislabeled). Log each pass as an `attempt`.

## Step 4 — GATE-DIFF (HARD) → PR-PREP → GATE-SUBMIT (HARD) → TRACK

**GATE-DIFF** (HARD — ignores `--auto`): show `git -C <repo> diff`, the touched files, and the
final-gate status; options approve-for-PR *(Recommended if gate green)* / revert-files /
commit-local-only / abort. Nothing is committed before this returns approval.

On approve-for-PR, run **PR-PREP** per `methodology.md` (fork if needed via `gh repo fork`, branch
`crg-farm/<issue-or-slug>`, stage only the changed files by name, commit with the co-author
trailer, push to the fork, `gh pr create --draft`, body from the ledger with `Fixes <issueRef>`).
Append a `pr` record (`state:'draft'`).

**GATE-SUBMIT** (HARD — never auto-passes): show the draft PR URL, branch, upstream target, PR
body, and diff summary; options submit-upstream / keep-draft *(Recommended)* / keep-local / abort.
Only on `submit-upstream` do you flip the draft to ready (`gh pr ready`). Append a `pr` record with
the new `state`.

**TRACK:** the farm DB now holds the full audit trail for this `farmRunId` — run, candidates, gate
decisions, fix attempts, and PR outcomes.

## After it returns

Summarize: candidates sourced, bugs confirmed/fixed/handed-to-human, the tier each bug closed at,
and any draft/submitted PR URLs. Nothing crossed GATE-DIFF or GATE-SUBMIT without an explicit human
"yes". Point the user at `~/.claude/crg-farm/history.jsonl` for the durable record.
