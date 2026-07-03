---
name: crg-build
description: Readiness campaign over one app — boot it, survey readiness gaps (stability, completeness, consistency, polish, reachability, docs, launch-blockers) into a ranked ledger, gate it with the human, then build approved gaps in dependency-ordered waves validated by exit codes AND a headless browser gate, committing each green wave per subrepo (never pushing). Reuses the crg core; composes crg-debug for a STABILIZE pass. Use for /crg-build, "bring this app to a ready state", "readiness campaign".
argument-hint: "[app path] [--dimensions <csv>] [--skip-stabilize] [--headed] [--auto-bypass] [--prose] [--model <name>] [--max-waves <n>]"
user_invocable: true
---

# CRG Build

A main-loop campaign orchestrator that turns the crg core toward *bringing an app to a ready
state*:

```
PROFILE (first run, GATE-PROFILE) → STABILIZE (crg-debug per subrepo, GATE-STABILIZE-COMMIT)
  → BOOT (skill-owned daemons + health poll + token mint)
  → SURVEY (crg-build.js) → GATE-SPEC → BUILD (crg-build.js, commits per green wave)
  → UX-REVIEW (two scorers + merge; optional headed pass) → LOOP or EXIT
```

**The skill owns every long-running process.** The Workflow never starts or stops a daemon; when it
returns `status:'app-down'`, YOU restart the app and re-invoke. Read `methodology.md` in this
skill's directory first — it is the judgment contract for every stage; the Workflow's JS owns the
enforcement.

**Prerequisite (deterministic mode):** `$HOME/.claude/workflows/crg-build.js` installed by the
bundled `crg-deterministic` enabler. Absent, or `--prose` passed → execute `methodology.md`
directly in the main loop (its *Execution mode* section), honoring every rule verbatim.

## Parse `$ARGUMENTS`

- **appRoot**: an explicit path wins; else the current `git rev-parse --show-toplevel`; else STOP
  and ask. This is the app's umbrella directory (subrepos live inside it, per the profile).
- **dimensions**: `--dimensions stability,docs` narrows the survey. Default: all seven.
- **skipStabilize**: `--skip-stabilize` skips the crg-debug pass (default: STABILIZE runs on a
  campaign's FIRST run only — check the campaign DB for a prior `run` record).
- **headed**: `--headed` adds the qualitative claude-in-chrome pass to UX-REVIEW.
- **autoBypass**: `--auto-bypass` replaces GATE-SPEC's ask with the computed `auto-approve` (below),
  logged `bypass:true`. GATE-PROFILE and GATE-STABILIZE-COMMIT still block — a profile and a
  pre-existing dirty tree are never auto-resolved.
- **model** / **maxWaves**: forwarded to the Workflow (`haiku` default; 6 waves default).

Generate a `buildRunId` slug (app + date). **Campaign DB** = the farm DB machinery pointed at this
app: every `node $HOME/.claude/workflows/crg-debug.farm-db.mjs` call in this skill runs with
`CRG_FARM_DB=<appRoot>/.crg-build/campaign.jsonl`. Append a `run` record (`farmRunId: buildRunId`)
at start; `close-run` at every exit. Record types: `run`, `gap` (keyed `gapKeyOf`, status:
surveyed|approved|pruned|built|committed|unbuilt|proposed), `gate-asked`/`gate`, `wave`, `ux-review`,
`run-end`.

## Stage 0 — PROFILE (first run) → GATE-PROFILE (HARD)

Load `<appRoot>/.crg-build/profile.json`; validate with
`node $HOME/.claude/workflows/crg-build.profile.mjs validate <path>` — fix-or-stop on errors.

If absent: dispatch ONE profiler agent to draft it — read the app's justfile/Makefile/compose
files, router sources, and auth scripts; produce the profile shape in `methodology.md`'s terms:
`{app, subrepos[{name,path,kind}], boot:{up,down,readyTimeoutSec}, health[{name,url,expect}],
frontends[{name,url,routesManifest, auth:{kind:localStorage|url-token, key?, tokenCmd,
routeTemplate?, mintPerCheck?}, identities[], identityEmails{}, env{}, consoleErrorAllow[]},
specSources[]}`. **tokenCmd carries any env it needs (DATABASE_URL, JWT_SECRET) inline; tokens are
NEVER stored in the profile.** Then **GATE-PROFILE**: show the draft (boot cmd, ports, identities,
tokenCmd) — approve / edit / abort. Only on approval write the file. Never auto-passed.

## Stage 1 — STABILIZE (first run, unless --skip-stabilize) → GATE-STABILIZE-COMMIT (HARD)

Real bugs get fixed before feature work builds on them. Per subrepo (profile order):

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-debug.js',
  args: { repoRoot: '<appRoot>/<subrepo.path>', fix: true, model, env: 'none',
          methodologyPath: '$HOME/.claude/workflows/crg-debug.methodology.md' } })
```

crg-debug commits each validated wave on a `crg-debug/fix-*` branch in the subrepo (re-ingesting
the graph as it goes), leaving the subrepo checked out on that branch. Resolve it NOW at
**GATE-STABILIZE-COMMIT**: per subrepo show the fix-branch commits (`git log --oneline
<original>..HEAD`) + diffstat + the fix ledger; options merge-fix-branch *(Recommended when its
final gate was green: checkout the original branch, merge the fix branch, delete it)* /
proceed-on-fix-branch (BUILD's own wave commits continue on it) / revert (checkout the original
branch, delete the fix branch). Any working-tree dirt left over (a failed or opted-out commit)
must still be committed or reverted here — a dirty tree does NOT proceed to BUILD.

## Stage 2 — BOOT (skill-owned)

1. `Bash(profile.boot.up, run_in_background: true)` with cwd `appRoot`. Extra processes
   (`boot.extra[]`) each get their own background shell.
2. Poll every `profile.health[]` URL with curl until all match `expect` or `readyTimeoutSec` runs
   out (retry ~every 5s). Timeout → show the boot log tail, STOP.
3. Mint tokens: per frontend, per identity in `identities` (skip `anon`), run `auth.tokenCmd` with
   `{email}` ← `identityEmails[identity]` (or the identity itself when no map). Extract the token
   (the `eyJ…` line for JWTs; otherwise the command's last line).
4. Assemble `runtime = { health, frontends:[{name,url,routesManifest,auth:{kind,key,routeTemplate},
   identities, tokens:{identity:token}, consoleErrorAllow}] }`. Tokens travel ONLY in Workflow args.
   Re-mint fresh on every BOOT — never reuse across sessions. `mintPerCheck:true` frontends get the
   tokenCmd itself forwarded in runtime so gate agents mint immediately before navigating.

On any later `status:'app-down'` return: re-run this stage (restart), then re-invoke the Workflow
ONCE; a second app-down for the same stage stops the run with the reason.

## Stage 3 — SURVEY

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-build.js',
  args: { appRoot, runtime, profile, dimensions, surveyRounds, model,
          methodologyPath: '$HOME/.claude/workflows/crg-build.methodology.md' } })
```

Await the return: `{ledgerPath, gaps, deferred, rejected, unsurveyable, stats}`. Append one `gap`
record per confirmed gap (`status:'surveyed'`). If a prior campaign session left approved-unbuilt
gaps (query the campaign DB for `status:'approved'` without a matching `built`/`committed`), skip
SURVEY and jump to Stage 5 with the existing ledger.

## Stage 4 — GATE-SPEC (HARD; computed under --auto-bypass)

Append `gate-asked` (`gate:'GATE-SPEC'`). Show the ranked ledger grouped by dimension — per gap:
impact/effort, surface, the gap sentence, criteria count and kinds. When the list is too long for a
4-option gate, post it as plain text first, then ask cut points (Top-8 *(Recommended)* / Top-15 /
By-dimension / Custom). Options: approve-all / select-subset / prune / abort. **launch-blockers
gaps are shown in their own section and are NEVER part of any Recommended default** — approving one
is always an explicit human selection. Log the `gate` decision; update each gap record to
`approved`/`pruned`.

Under `--auto-bypass`: skip the ask —
`node $HOME/.claude/workflows/crg-build.profile.mjs auto-approve <ledgerPath>` computes the
approved set in real code (High|Medium impact, S|M effort, launch-blockers always excluded, top 12
by rank). Log `approve-computed` with `bypass:true`.

## Stage 5 — BUILD

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-build.js',
  args: { appRoot, runtime, profile, model, maxWaves, build: true,
          fromLedger: '<ledgerPath>', approvedGapIds: [...],
          methodologyPath: '$HOME/.claude/workflows/crg-build.methodology.md' } })
```

Await `{built, unbuilt, commits, waves}`. Append a `wave` record per wave and update gap records
(`built`→`committed` when its wave's commit verified; `unbuilt` with the stall reason). Commits
happened inside the Workflow, per validated wave, per subrepo — verify nothing was pushed
(`git log @{push}..` is non-empty or no upstream). `unbuilt` gaps return to the NEXT GATE-SPEC.

## Stage 6 — UX-REVIEW

1. Two independent scorer `Agent`s per frontend surface, run SEQUENTIALLY (one shared browser):
   each drives the full route × identity matrix headless (Playwright MCP, auth per runtime) and
   returns `{surface, scores:[{criterion, score, evidence}]}` against the methodology's rubric.
   Discard any score without route-level evidence.
2. Merge per the methodology: mean; disagreement >2 → min; threshold 4. Append an `ux-review`
   record with the merged scores.
3. Sub-threshold criteria become PROPOSED gaps (`gap` records, `status:'proposed'`) for the next
   GATE-SPEC — never built this session, never auto-approved (auto-approve reads only the ledger).
4. `--headed` only: one qualitative claude-in-chrome pass over the worst-scoring surface
   (tabs_context first, new tab, token via javascript_tool). Its findings are also proposed-only.

## Stage 7 — LOOP or EXIT

- `unbuilt` or `proposed` gaps exist → report them; the next `/crg-build` invocation resumes at
  GATE-SPEC (survey skipped) with those plus any re-survey.
- Ledger empty AND last survey round was dry AND UX ≥ threshold → the campaign is DONE.
- Either way: `close-run <buildRunId>`, leave the app running (tell the user how to stop it:
  `profile.boot.down`).

## After it returns

Report per the methodology's report layout: ledger summary by dimension, built gaps with commit
hashes and messages, unbuilt with stall reasons, UX scores with evidence, proposed gaps, and the
explicit line that nothing was pushed. Point at `<appRoot>/.crg-build/` (ledger, campaign.jsonl)
for the durable record. Under `--auto-bypass` this report is the deliverable — every computed gate
decision is queryable in the campaign DB.
