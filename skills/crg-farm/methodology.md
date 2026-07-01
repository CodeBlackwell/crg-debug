# CRG Farm — Methodology Reference

The judgment + protocol the `/crg-farm` skill applies. `/crg-farm` is a **main-loop
orchestrator**: it sources candidate bugs, triages them cheaply with `crg-debug`, escalates
model capacity only where repair struggles, and puts a human in the loop at every boundary that
matters. It **calls `crg-debug` as a primitive** and changes zero lines of the crg-debug Workflow.

Why the loop lives above the Workflow: the Workflow sandbox cannot nest subagents, call skills,
or ask the user. `/xplore` and `AskUserQuestion` are both main-loop-only. So recon, approval,
complexity scoring, and escalation all run in this skill, around the Workflow.

> ## ⛔ NON-NEGOTIABLE — the two hard gates
> **`GATE-DIFF` (working-tree → commit) and `GATE-SUBMIT` (fork → upstream) ALWAYS block for
> explicit human approval. `--auto` does NOT bypass them. Ever.** These guard the two
> irreversible boundaries: writing to version control, and publishing to a repo you don't own.
> Auto-submitting a PR to a third-party maintainer is the one failure mode that burns
> reputation irrecoverably — never cross either boundary without a human "yes".

---

## The loop

```
RECON (/xplore)  → duplicate-fix check (§RECON)  → GATE-RECON    (soft)
  → TRIAGE (crg-debug --detect-only → ledger)  + per-bug complexity score
                   → GATE-TRIAGE  (soft; the steering gate — pick bugs + start tier)
  → FIX (crg-debug --from-ledger @tier)  → escalate on failure (§Escalation)
                   → GATE-ESCALATE (soft; HARD on regression / tier cap)
  → GATE-DIFF (HARD)  → PR-PREP (fork/branch/draft)  → GATE-SUBMIT (HARD)  → TRACK
```

Every stage appends to the farm DB (§Farm database). RECON→check→TRIAGE is cheap and runs broad;
the expensive FIX/escalation only fires on **fresh** candidates that pass verify and GATE-TRIAGE.

---

## RECON — sourcing + duplicate-fix check

Sourcing a candidate is not enough; before it costs any triage it must survive **two** dedup
passes. A bug worth farming is one that is genuinely open AND not already being fixed by someone
else — chasing a bug that already has a merged or in-flight fix wastes effort and, worse, produces
a duplicate PR that annoys maintainers.

**1. Farm-DB dedup (our own history).** Drop any candidate whose `keyOf` already appears in a `pr`
record (we shipped it) or was handed to a human at the tier cap (exhausted). `query
'{"type":"pr"}'`.

**2. Upstream duplicate-fix check (the other repo's state).** For each surviving candidate, ask
the upstream repo whether a fix already exists or is pending. Classify it:

- `gh issue view <n> -R <owner>/<repo> --json state,title,body` — confirm the issue is still
  **open** (a closed issue usually means it's fixed).
- `gh search prs "repo:<owner>/<repo> <n>" --state all --json number,title,state,url` and
  `gh pr list -R <owner>/<repo> --state open --search "<n> in:body,title"` — find any PR that
  references the issue number.
- Skim the top hits for a PR that touches the same symptom/area even without citing the number
  (keyword search on the bug's function/file).

Classify each candidate and record it on its `candidate` farm-DB row (`status`, `competingPr`):

| status | meaning | action |
|---|---|---|
| **fresh** | open issue, no open/merged PR addressing it | proceed to GATE-RECON |
| **in-flight** | an OPEN PR already addresses it | **drop** — do not duplicate; log `competingPr` |
| **already-fixed** | a MERGED PR (or a fix on the default branch) resolves it, even if unreleased | **drop** — log `competingPr` |

Only **fresh** candidates advance. `in-flight`/`already-fixed` are shown at GATE-RECON as *dropped,
with the competing PR URL*, so the human can override (e.g. the existing PR is stale/abandoned and
worth superseding) — an override is an explicit `add-context` choice, never the default.

---

## Named-Gate Protocol

Every gate is a fixed `AskUserQuestion` (question + `header ≤12 chars` + 2–4 labeled options,
first option `(Recommended)` where one is). Every decision is appended to the farm DB as a `gate`
record — the audit trail. `--auto` auto-passes **soft** gates with the recommended default and
logs the decision as `auto`; **hard** gates ignore `--auto`.

| Gate | Fires after | Shows | Options | Class |
|---|---|---|---|---|
| **GATE-RECON** | `/xplore` recon | candidate areas / issues / suspected bugs (post-dedup) | approve-all / select-subset / add-context / abort | Soft |
| **GATE-TRIAGE** | `--detect-only` returns ledger + complexity scores | confirmedBugs by severity, per-bug complexity + recommended start tier, deferred/rejected counts | select-bugs / choose-tier / set-escalation-cap / abort | Soft (steering) |
| **GATE-ESCALATE** | each fix pass leaving `unfixed[]` or a RED final gate | fixed/unfixed + reasons, current→next tier, final-gate status | escalate-tier / stop-keep-fixed / hand-to-human / abort | Soft → **HARD** on regression or tier cap |
| **GATE-DIFF** | fixes settle, before any PR prep | `git diff`, files touched, final-gate status | approve-for-PR / revert-files / commit-local-only / abort | **HARD** |
| **GATE-SUBMIT** | draft PR created, before draft→ready / upstream | draft PR URL, branch, upstream target, PR body, diff summary | submit-upstream / keep-draft / keep-local / abort | **HARD** (never auto) |

Abort at any gate ends the run cleanly, logs a `gate` record with `decision:'abort'`, and leaves
the working tree exactly as it was at that point (nothing committed, nothing pushed).

---

## Complexity scoring (main loop, after `--detect-only` persists the ledger)

For each unique `confirmedBugs[].file`, call `mcp__code-review-graph__get_impact_radius_tool` and
combine, per bug:

- **blast radius** = impact-radius node count (bigger → harder),
- **severity weight** (Critical 4 · High 3 · Medium 2 · Low 1),
- **language penalty** — C/C++/Rust or template-generated (`.c.src`, `.pyx`, generated) code is
  materially harder to repair than pure Python/JS (the numpy einsum bug: correct localization,
  automated repair still failed),
- **`conflicted` flag** — mixed reviewer verdicts → treat as harder.

Use the score only to **recommend the starting tier** at GATE-TRIAGE (high → start at
`sonnet`/`opus` instead of climbing from `haiku`). It is a recommendation the human overrides;
it never auto-selects a tier. Pure MCP reads — no new executable code.

---

## Escalation (orchestrator-driven; zero Workflow changes)

`crg-debug --from-ledger` re-fixes **every** `confirmedBugs` entry in the ingested ledger and
does not know which already closed. So escalation **narrows the ledger to just the unfixed set**
(`lib/ledger-slice.mjs`) before re-invoking at a higher tier — which automatically scopes the
expensive model to the hard bugs only. Never re-run a closed bug: re-attempting a green bug can't
fail RED and gets mislabeled `"RED not observed"`.

Read the Workflow return: `ret.fix = { waves, fixed, unfixed, finalGate:{clean, results} }`.

1. Fix pass at `<tier>`. If `unfixed` is empty AND `finalGate.clean` → **done**.
2. Else branch on the **failure channel** (they are distinct):
   - **`unfixed[]` present** — reasons `"RED not observed — not reproduced; source left
     untouched"` (`:671`) or `"…both failed — needs human"` (`:711`). Harder reasoning is the
     right lever → **GATE-ESCALATE (soft)**; on `escalate`, slice ledger to the unfixed keys and
     re-invoke `--from-ledger` at the next tier.
   - **`finalGate.clean === false`** — a fix introduced a regression (bugs may have closed).
     Model escalation will NOT reliably fix a fix that broke a sibling → **GATE-ESCALATE promoted
     to HARD**, showing the regressing diff; escalate at most once, then require a human.
3. Ladder **haiku → sonnet → opus**, capped at opus (the numpy datum: a human on Opus succeeded
   where the fix agent degenerated). Stop at the cap the human set at GATE-TRIAGE.
4. Opus tier still leaves `unfixed[]` → **GATE-ESCALATE hard** with `hand-to-human`: keep the
   fixed bugs, the RED repro tests, and the reviewer notes; do not loop further.

Each fix pass is logged as an `attempt` record (tier, fixed/unfixed keys, `finalGateClean`).

---

## PR-prep (behind GATE-DIFF; reuse `gh` + `parseRemote`)

Only reached after GATE-DIFF approves the diff. Honors crg-debug's git policy (named files only,
never `git add -A`, never push without the human crossing GATE-SUBMIT).

1. `parseRemote(git -C <repo> remote get-url origin)` → `{owner, repo}` (reuse `lib/issue-ref.mjs`).
2. Push access? If not, `gh repo fork --clone=false` and target the fork.
3. `git checkout -b crg-farm/<issue-or-slug>` (branch off the default branch).
4. Stage **only** the files crg-debug changed — `ret.fix.fixed[].testFile` + the touched source,
   by explicit path. Commit with the co-author trailer
   `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
5. Push the branch to the fork; `gh pr create --draft` targeting upstream.
6. PR body from the ledger: root cause per bug, before/after behavior, tests added, final-gate
   status, `Fixes <issueRef>`. It stays a **draft** until GATE-SUBMIT.
7. On draft-create and on submit, append a `pr` record (`url`, `state`).

**Never** flip draft→ready or run any upstream write before GATE-SUBMIT returns `submit-upstream`.

---

## Farm database (cross-run persistence)

Global append-only JSONL at `~/.claude/crg-farm/history.jsonl` via `lib/farm-db.mjs`
(`append`/`query`; `CRG_FARM_DB` overrides the path). This is durable memory the per-run
`.crg-debug/ledger.json` is not. One `type`-tagged object per line:

| type | when | key fields |
|---|---|---|
| `run` | loop start | `repo`, `issueRef`, `scope`, `mode`, `farmRunId` |
| `candidate` | per `/xplore`-surfaced candidate | `repo`, `source`, `title`, `url`, `keyOf`, `status` (fresh/in-flight/already-fixed), `competingPr` |
| `gate` | per gate decision | `gate`, `decision`, `farmRunId` (+ `auto:true` under `--auto`) |
| `attempt` | per fix pass | `tier`, `fixed:[keyOf]`, `unfixed:[{keyOf,reason}]`, `finalGateClean` |
| `pr` | draft-create + submit | `repo`, `issueRef`, `url`, `state`, `keyOf` |

`keyOf` (`norm(file)::norm(rootCause)`, from `ledger-slice.mjs`) is the cross-run identity. The
farm-DB dedup pass (§RECON pass 1) uses it so the farm never re-works a bug we already shipped or
exhausted; the upstream duplicate-fix check (§RECON pass 2) is the complementary guard against
duplicating *someone else's* in-flight or merged fix.
