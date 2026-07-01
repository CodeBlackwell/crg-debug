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
RECON (/xplore | gh search)  → duplicate-fix check + ranking (§RECON)  → GATE-RECON    (soft)
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

### Sourcing candidates (mode from `direction`)

`/crg-farm` never assumes the current directory is the target. RECON picks a sourcing mode from
`direction` (SKILL.md §Parse `$ARGUMENTS`):

| mode | trigger | how |
|---|---|---|
| **scoped** | `direction` names a repo (`owner/repo`, a URL, a local path, or `--repo`) | Resolve/clone that repo (§Clone cache), then run `/xplore` (local `Explore` agents) framed as "open, PR-able bugs in `<repo>`" — or with `--issue`, "reproduce and localize `<issueRef>` in `<repo>`, plus adjacent open defects." Combine with `gh issue list --repo <owner>/<repo> --state open --label bug` so filed issues aren't missed alongside code-level findings. |
| **themed** | `direction` is free text that isn't a repo (a topic, symptom, or language) | Cross-repo, `gh`-only — `Explore` agents can't reach remote GitHub: `gh search issues "<direction>" --state open --label bug --sort updated --json repository,number,title,url -L 30` (drop `--label bug` and retry if it returns too few hits; a `good-first-issue` label is a reasonable fallback filter). |
| **wildcard** | no `direction` at all | Same `gh search issues`, unthemed: `gh search issues --state open --label bug --sort updated -L 30`. Quality-filter before candidates are recorded — drop any repo that's archived or has had no push in the last 12 months (`gh repo view <owner>/<repo> --json isArchived,pushedAt`), so triage budget never sinks into dead projects. |

Each `gh search` hit becomes a raw candidate: `{repo:"owner/repo", issueRef:"#<n>", title, url,
source:'gh-search'}`. `/xplore` hits (scoped mode) keep their existing shape. Both feed the same
dedup pipeline below.

### Duplicate-fix check

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

### Ranking (impact × review-likelihood)

An unordered dump of 20+ fresh candidates is not something a human can usefully triage — rank them
before GATE-RECON. Two independent signals, gathered **once per distinct repo** (not per issue,
themed/wildcard candidates often cluster on the same repo):

- **Stars** — `gh repo view <owner>/<repo> --json stargazerCount` — proxy for blast radius / how
  many users a correct fix actually helps.
- **Review cadence** — `gh pr list -R <owner>/<repo> --state merged -L 5 --json mergedAt,number` —
  read two things off the last 5 merge timestamps: how tightly spaced they are (tight = actively
  reviewed) and the gap between `now` and the most recent one. A repo with historically tight
  spacing but a stale recent gap (no merges in the last few weeks) has likely gone quiet —
  demote it even though its historical cadence looks fast.

**Impact** is scored per-candidate from the issue body itself, not just repo size: data loss /
data corruption / security / safety-relevant bugs (locks, auth, payments) outrank plain functional
breakage, which outranks cosmetic/UX issues. A tiny, low-star repo with a severe bug can rank above
a huge repo with a cosmetic one — read the issue, don't just sort by stars.

Sort the fresh candidates with **impact as the primary key, review-likelihood as the tiebreaker**
(and as a demotion factor for repos that look stalled per above). Record the signals behind the
rank on each `candidate` farm-DB row (`rankSignals: {stars, recentMergeSpanDays,
daysSinceLastMerge}`) so GATE-RECON can show *why* something ranked where it did, and so a later
run can compare against a repo's prior signals instead of re-deriving them from scratch.

GATE-RECON then shows the ranked list, not a raw dump. Because a ranked list commonly runs past
the 4-option cap the Named-Gate Protocol allows, `select-subset` (SKILL.md §GATE-RECON) is a
two-step pick: post the full ranked list as plain text (repo, issue, one-line impact/cadence
rationale per entry), then ask a small follow-up `AskUserQuestion` with cut points sized to the
list — e.g. Top-5 (Recommended) / Top-10 / Top-N (everything but the flagged/low tier) / Custom —
rather than trying to cram every candidate into one 4-option gate.

---

## Clone cache (repoRoot resolution)

`repoRoot` is no longer fixed before RECON runs — themed/wildcard candidates can span many repos,
so each one is resolved lazily, right before it needs a working tree (TRIAGE, and again at
PR-prep).

Persistent cache at `~/.claude/crg-farm/repos/<owner>/<repo>` (`CRG_FARM_REPOS` overrides the
root, mirroring `CRG_FARM_DB`):

- **Missing** → `gh repo clone <owner>/<repo> <path>`.
- **Present** → sync to the tip of the default branch: `git -C <path> fetch origin && git -C
  <path> checkout <default-branch> && git -C <path> reset --hard origin/<default-branch> && git -C
  <path> clean -fd`. This is the farm's own cache, not the user's working copy, so the hard reset
  is safe — it guarantees every run starts from a clean, current tree instead of accumulating
  drift from a prior run.
- `repoRoot` for a candidate = its cache path. Candidates that share a repo share one `repoRoot`
  and are triaged together in a single `--detect-only` pass (batch by repo, not per-bug).
- The same clone is reused at PR-prep (§PR-prep) — `git remote get-url origin` there already
  points at the cached clone, so `gh repo fork` (when push access is missing) just retargets it in
  place.

---

## Named-Gate Protocol

Every gate is a fixed `AskUserQuestion` (question + `header ≤12 chars` + 2–4 labeled options,
first option `(Recommended)` where one is). Every decision is appended to the farm DB as a `gate`
record — the audit trail. `--auto` auto-passes **soft** gates with the recommended default and
logs the decision as `auto`; **hard** gates ignore `--auto`.

| Gate | Fires after | Shows | Options | Class |
|---|---|---|---|---|
| **GATE-RECON** | RECON (`/xplore` scoped, or `gh search` themed/wildcard) | candidate areas / issues / suspected bugs, **ranked by impact × review-likelihood** (post-dedup, §Ranking) | approve-all / select-subset (ranked list + cut-point follow-up) / add-context / abort | Soft |
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
| `candidate` | per sourced candidate (`/xplore` scoped, or `gh search` themed/wildcard) | `repo`, `source`, `title`, `url`, `keyOf`, `status` (fresh/in-flight/already-fixed), `competingPr` |
| `gate` | per gate decision | `gate`, `decision`, `farmRunId` (+ `auto:true` under `--auto`) |
| `attempt` | per fix pass | `tier`, `fixed:[keyOf]`, `unfixed:[{keyOf,reason}]`, `finalGateClean` |
| `pr` | draft-create + submit | `repo`, `issueRef`, `url`, `state`, `keyOf` |

`keyOf` (`norm(file)::norm(rootCause)`, from `ledger-slice.mjs`) is the cross-run identity. The
farm-DB dedup pass (§RECON pass 1) uses it so the farm never re-works a bug we already shipped or
exhausted; the upstream duplicate-fix check (§RECON pass 2) is the complementary guard against
duplicating *someone else's* in-flight or merged fix.
