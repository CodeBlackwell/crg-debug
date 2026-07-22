---
name: crg-ralph
description: Graph-compiled Army construction — decompose a feature request (or ingest an existing Army PRD dir) into stories, verify every predicted touch set against the code-review-graph, pack verified-disjoint waves with computed fences, gate the plan with the human, then build approved stories in parallel lanes enforced by JS fences and blind exit-code gates, committing each green wave on a crg-ralph/build-* branch (never pushed) and sweeping the diff with crg-debug. Use for /crg-ralph, "build this feature with the graph", "run this Army PRD through crg", "graph-verify my PRD".
argument-hint: "[feature request | path/to/army-prd-dir] [--plan-only] [--from-plan <path> --stories <ids>] [--model <name>] [--max-tier <tier>] [--max-waves <n>] [--prose]"
user_invocable: true
---

# CRG Ralph

The constructive sibling of `/crg-debug` and the graph-compiled successor to hand-authored Army
PRDs: the graph plans the army (stories → critic-checked predictions → deterministic wave packer →
lanes + fences), a Workflow runs the army (exit-code gates, JS-enforced prefix-aware fences, model
ladder, commit per green wave + graph re-ingest), and a scoped crg-debug sweep closes the loop.

```
PROFILE (first run, GATE-PROFILE) → PLAN (workflow, read-only → plan.json + Army PRD dir)
  → GATE-PLAN (HARD) → BUILD (workflow: parallel lanes, fences, ladder, wave commits)
  → SWEEP (crg-debug detect-only over the run's diff) → GATE-SWEEP → fix (crg-debug fromLedger)
  → report
```

Read `methodology.md` in this skill's directory first — it is the judgment contract for every
stage; the Workflow's JS owns the enforcement.

**Prerequisite (deterministic mode):** `~/.claude/workflows/crg-ralph.js` +
`~/.claude/workflows/crg-ralph.plan.mjs` installed by the bundled `crg-deterministic` enabler.
Absent, or `--prose` passed → execute `methodology.md` directly in the main loop (its *Execution
mode* section), honoring every rule verbatim.

## Parse `$ARGUMENTS`

- **repoRoot**: `--repo <path>` wins; else the current `git rev-parse --show-toplevel`; else STOP
  and ask.
- **input**: the non-flag text. If it resolves to an existing directory containing `PRD.md` →
  **prdDir** (absolute path; ingest mode). Otherwise → **feature** (the request to decompose).
  Empty → STOP and ask what to build.
- **planOnly**: `--plan-only` stops after GATE-PLAN, handing over the emitted PRD dir for the
  `ralph` CLI.
- **fromPlan / stories**: `--from-plan <path> --stories s1,s2` skips PLAN and GATE-PLAN's survey
  (cross-session build entry): show the named stories from that plan.json, confirm them as the
  approved set at GATE-PLAN, then BUILD.
- **model**: defaults to `haiku` (the ladder's start). `--model <name>` overrides; `--model
  session` inherits. **maxTier**: `--max-tier sonnet` caps the escalation ladder (default: the
  profile's, else `opus`). **maxWaves**: `--max-waves <n>` (default 8).

Generate a `ralphRunId` slug (repo + feature/prd name). **Campaign DB** = the farm-db machinery
pointed at this repo: every `node ~/.claude/workflows/crg-debug.farm-db.mjs` call runs with
`CRG_FARM_DB=<repoRoot>/.crg-ralph/campaign.jsonl`. Append a `run` record (`farmRunId: ralphRunId`)
at start; `close-run` at every exit. Record types: `run`, `story` (status:
planned|approved|pruned|built|committed|unbuilt|blocked), `gate-asked`/`gate`, `wave`, `run-end`.

## Stage 0 — PROFILE (first run) → GATE-PROFILE (HARD)

Load `<repoRoot>/.crg-ralph/profile.json`; validate with
`node ~/.claude/workflows/crg-ralph.plan.mjs validate-profile <path>` — fix-or-stop on errors.

If absent: dispatch ONE profiler agent to draft it — `{project, offLimits: [paths no story may
touch], maxTier?, toolchain?: [{package, build, typecheck, test}], runtime?: {devUrl}}` (runtime
ONLY if a dev server exists and browser criteria are wanted — features without UI skip it). Then
**GATE-PROFILE**: show the draft — approve / edit / abort. Only on approval write the file. Never
auto-passed. Re-runs never re-ask.

## Stage 1 — PLAN

```
Workflow({ scriptPath: '~/.claude/workflows/crg-ralph.js',
  args: { repoRoot, feature?, prdDir?, profile, model, maxTier, maxWaves,
          methodologyPath: '~/.claude/workflows/crg-ralph.methodology.md',
          planToolPath:    '~/.claude/workflows/crg-ralph.plan.mjs' } })
```

(Exactly one of `feature`/`prdDir`; absolute `$HOME` paths.) Await
`{status:'planned', planPath, prdDir, stories, waves, blocked, deferredByCap, cycleBroken,
baselineFailures}`. Append one `story` record per story (`status:'planned'`).

## Stage 2 — GATE-PLAN (HARD — never auto-passed)

Append `gate-asked`. Show the plan as the human's spec decision:

- waves × lanes table (story, lane, wave, effort, criteria count, prediction confidence);
- which stories the packer SERIALIZED versus the declared/naive plan, and why (fence overlap);
- `cycleBroken` edges, `blocked` stories with reasons, `deferredByCap`;
- **baseline `kind:code` failures prominently** — recommend stabilizing via `/crg-debug` first;
- low-confidence predictions flagged.

Options: approve-all / select-subset / edit-stories *(then re-invoke PLAN with the edits as
feature text or a corrected PRD — a changed plan is re-packed and re-gated)* / abort. Log the
`gate` decision; update story records to `approved`/`pruned`. **`--plan-only`: stop here** — report
`planPath` + the emitted `prdDir` (runnable by the `ralph` CLI unchanged).

## Stage 3 — BUILD

```
Workflow({ scriptPath: '~/.claude/workflows/crg-ralph.js',
  args: { repoRoot, profile, model, maxTier, maxWaves, build: true,
          fromPlan: '<planPath>', approvedStoryIds: [...],
          baselineFailures: <plan.json's baselineFailures array — read it yourself>,
          methodologyPath, planToolPath } })
```

Await `{status:'built', branch, built, unbuilt, commits, waves, finalGate, dirtyStop?}`. Append a
`wave` record per wave; update story records (`built`→`committed` when its wave's commit verified;
`unbuilt` with the stall reason). Verify nothing was pushed (`git log @{push}..` non-empty or no
upstream). A `dirtyStop` is a hard stop — report it verbatim and go to the report.

## Stage 4 — SWEEP → GATE-SWEEP

Skip only if no wave committed. Compose the existing engine — never rebuild it:

```
Workflow({ scriptPath: '~/.claude/workflows/crg-debug.js',
  args: { repoRoot, fix: false, model,
          scope: 'regression sweep over these just-built files: <the union of commit file lists>',
          methodologyPath: '~/.claude/workflows/crg-debug.methodology.md' } })
```

Confirmed bugs → **GATE-SWEEP**: show them ranked; options fix-all / select-subset / defer-all.
Approved fixes:

```
Workflow({ scriptPath: '~/.claude/workflows/crg-debug.js',
  args: { repoRoot, fix: true, fromLedger: '<repoRoot>/.crg-debug/ledger.json', model, methodologyPath } })
```

(crg-debug commits its fix waves on the current branch's `crg-debug/fix-*` — report both branches.)

## After it returns

`close-run <ralphRunId>`. Report per the methodology's report layout: the plan summary, built
stories with commit hashes and tiers, unbuilt with stall reasons and escalation evidence, blocked
stories, sweep results, manual-acceptance items (criteria needing deploy/remote hosts), and the
explicit line that **nothing was pushed**. Offer to merge `crg-ralph/build-*` back (or run
`/cpdv`), note any uncommitted work left in the tree, and point at `<repoRoot>/.crg-ralph/`
(plan.json, prd/, campaign.jsonl) for the durable record.
