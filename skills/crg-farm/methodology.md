# CRG Farm — Methodology Reference

The judgment + protocol the `/crg-farm` skill applies. `/crg-farm` is a **main-loop
orchestrator**: it sources candidate bugs, triages them cheaply with `crg-debug`, escalates
model capacity only where repair struggles, and puts a human in the loop at every boundary that
matters. It **calls `crg-debug` as a primitive** and changes zero lines of the crg-debug Workflow.

Why the loop lives above the Workflow: the Workflow sandbox cannot nest subagents, call skills,
or ask the user. `/xplore` and `AskUserQuestion` are both main-loop-only. So recon, approval,
complexity scoring, and escalation all run in this skill, around the Workflow.

> ## ⛔ NON-NEGOTIABLE — the hard gates
> **`GATE-DIFF` (working-tree → commit), `GATE-SUBMIT` (fork → upstream), and
> `GATE-ADVISORY-REVIEW` (compiled security report → human) ALWAYS block for explicit human
> approval under normal operation. `--auto` does NOT bypass any of them. Ever.** `GATE-DIFF`/
> `GATE-SUBMIT` guard the two irreversible boundaries of the normal PR pipeline: writing to version
> control, and publishing to a repo you don't own. Auto-submitting a PR to a third-party maintainer
> is the one failure mode that burns reputation irrecoverably — **no flag ever crosses
> `GATE-SUBMIT` unattended.** `--auto-bypass` (§Auto-bypass mode) is a separate, standalone flag —
> not an extension of `--auto`, not implied by it — that *does* cross `GATE-DIFF` unattended
> (auto-commit) and, in the prose path, may auto-pass `GATE-ADVISORY-REVIEW` too (to `save-only` —
> a report never leaves local disk under any option regardless, §Security classification), but
> every PR it opens stops at **draft**. Flipping a PR to ready-for-review stays a deliberate,
> separate human action outside the farm loop, no matter which flags were passed.
> `GATE-ADVISORY-REVIEW` also guards a second property regardless of flag: this tool never files,
> emails, or otherwise discloses a compiled security report on the human's behalf under any option
> — disclosure timing and channel are always the human's call. A security-sensitive bug is also
> NEVER routed into the normal PR pipeline — it does not reach `GATE-DIFF` at all, bypass or not,
> harness or prose. Under `--auto-bypass` the harness runs the advisory track itself (auto-passing
> `GATE-ADVISORY-REVIEW` to `save-only`) and stops at the on-disk report — never a PR, never
> transmitted.

---

## The loop

```
RECON (/xplore | gh search)  → duplicate-fix check + ranking (§RECON)  → GATE-RECON    (soft)
  → TRIAGE (crg-debug --detect-only → ledger)  + complexity score + security classification
                   → GATE-TRIAGE  (soft; the steering gate — pick bugs + start tier)

  security-sensitive bugs fork here (§Security classification & the advisory track):
    → GATE-SECURITY-ROUTE (soft)  → PoC-VERIFY → TRACE-EXPLOIT-PATH → SEVERITY-CALIBRATE
      → COMPILE-REPORT → GATE-ADVISORY-REVIEW (HARD by default)  → TRACK
    (never reaches GATE-DIFF / PR-PREP / GATE-SUBMIT — no public PR for an undisclosed vuln; the
    `--auto-bypass` harness runs this track too, auto-passing GATE-ADVISORY-REVIEW to save-only)

  everything else continues:
    → FIX (crg-debug --from-ledger @tier)  → escalate on failure (§Escalation)
                     → GATE-ESCALATE (soft; HARD on regression / tier cap)
    → GATE-DIFF (HARD)  → PR-PREP (fork/branch/draft)  → GATE-SUBMIT (HARD)  → TRACK
```

Every stage appends to the farm DB (§Farm database). RECON→check→TRIAGE is cheap and runs broad;
the expensive FIX/escalation only fires on **fresh** candidates that pass verify and GATE-TRIAGE.

Under `--auto-bypass` (a separate flag, §Auto-bypass mode) every gate above auto-passes and the
loop runs top-to-bottom unattended for up to 5 candidates concurrently — through `GATE-DIFF`
(commit) and stopping at an opened **draft** PR; `GATE-SUBMIT` always resolves to `keep-draft`.
Security-sensitive bugs are excluded from that unattended run entirely (§Security classification).

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

## Environment provisioning (`--env`, GATE-BUILDABILITY)

A farm PR was once rejected because `uv build` failing on a repo that was never a library got
"fixed" as a bug — an **un-provisioned environment misread as a code defect**. `--env` closes that
gap: it makes each candidate genuinely buildable before TRIAGE, and classifies a failure that
survives provisioning as *environment*, not *code*.

- **`--env container` (default under the harness)** — right after the clone/sync above, crg-debug
  provisions a **dedicated, cached Docker env for that repo** (`crg-env-<owner>-<repo>`): a slim base
  image for its stack, `apt`-installed system deps (hand-installed iteratively — build, see what's
  missing, install, retry), language deps in a persistent named volume (`crg-deps-<owner>-<repo>`),
  source bind-mounted, and every toolchain command wrapped to run inside it. The image is
  **fingerprinted by the repo's manifests + lockfiles** and reused untouched unless deps change — an
  env is never rebuilt needlessly, so the cost is paid once per repo, not once per run. Full recipe
  in `crg-debug.methodology.md` §Environment provisioning & baseline classification.
- **`--env none`** — baseline runs against the host as-is (no Docker). Standalone `/crg-debug`'s
  default; available to the farm when you don't want containers.
- **GATE-BUILDABILITY (baseline classification).** crg-debug tags each baseline build/typecheck
  failure `code` (a real source defect — seeded as a bug) or `env` (missing tool/dep/system lib the
  mode couldn't supply, a build not applicable to the project, Docker down). **Any residual `env`
  failure ⇒ the candidate is `unfarmable`:** the harness hands it off cleanly (no fix, no PR, no
  invented bug) rather than climbing tiers against an unbuildable tree. Under `--auto-bypass` this is
  a hand-off outcome alongside `handed-to-human`, reported in the run summary.

---

## Named-Gate Protocol

Every gate is a fixed `AskUserQuestion` (question + `header ≤12 chars` + 2–4 labeled options,
first option `(Recommended)` where one is). Immediately before calling `AskUserQuestion`, append a
`gate-asked` record (`gate`, `farmRunId`, `repo` if the gate is per-repo); once it returns, append
the `gate` decision record as before. The two timestamps bound the actual human wait — everything
before `gate-asked` and after the `gate` decision is agent work, not waiting. Skip `gate-asked` for
any gate that ends up auto-passed or bypassed: nothing was shown, so there's nothing to time.

Every decision is appended to the farm DB as a `gate` record — the audit trail. `--auto` auto-passes
**soft** gates with the recommended default and logs `auto:true`; **hard** gates ignore `--auto`.
`--auto-bypass` (§Auto-bypass mode) is a separate flag that additionally auto-passes `GATE-DIFF`
(and a HARD-promoted GATE-ESCALATE, which climbs one strictly-higher tier per regression — never a
same-tier retry, so at most two hops from a `haiku` start) — logging `bypass:true` instead of
`auto:true` so the audit trail always shows whether a decision came from a human, from `--auto`, or
from `--auto-bypass`. `GATE-SUBMIT` is logged with `bypass:true` too, but its decision is always
`keep-draft` — no flag ever resolves it to `submit-upstream` automatically. In the **prose** path
only (§Auto-bypass mode → "Prose vs. harness"), `--auto-bypass` also auto-passes
`GATE-ADVISORY-REVIEW` to `save-only`, logged `bypass:true` — the **harness** never reaches that
gate at all, since it excludes security-sensitive bugs before FIX rather than attempting the
advisory track itself (§Security classification & the advisory track).

| Gate | Fires after | Shows | Options | Class |
|---|---|---|---|---|
| **GATE-RECON** | RECON (`/xplore` scoped, or `gh search` themed/wildcard) | candidate areas / issues / suspected bugs, **ranked by impact × review-likelihood** (post-dedup, §Ranking) | approve-all / select-subset (ranked list + cut-point follow-up) / add-context / abort | Soft |
| **GATE-TRIAGE** | `--detect-only` returns ledger + complexity scores | confirmedBugs by severity, per-bug complexity + recommended start tier, deferred/rejected counts | select-bugs / choose-tier / set-escalation-cap / abort | Soft (steering) |
| **GATE-SECURITY-ROUTE** | GATE-TRIAGE, only when ≥1 of that repo's bugs is flagged `securitySensitive` | flagged bugs, `vulnClass`, flag rationale | advisory-track / treat-as-normal-bug / drop / abort | Soft |
| **GATE-ESCALATE** | each fix pass leaving `unfixed[]` or a RED final gate | fixed/unfixed + reasons, current→next tier, final-gate status | escalate-tier / stop-keep-fixed / hand-to-human / abort | Soft → **HARD** on regression or tier cap |
| **GATE-DIFF** | fixes settle, before any PR prep | `git diff`, files touched, final-gate status | approve-for-PR / revert-files / commit-local-only / abort | **HARD** |
| **GATE-SUBMIT** | draft PR created, before draft→ready / upstream | draft PR URL, branch, upstream target, PR body, diff summary | submit-upstream / keep-draft / keep-local / abort | **HARD** (never auto) |
| **GATE-ADVISORY-REVIEW** | COMPILE-REPORT (advisory track only) | compiled report (or path + summary) | save-only / revise / discard / abort | **HARD by default** — auto-passed to `save-only` under `--auto-bypass` (harness Advisory stage or `--prose`) |

Abort at any gate ends the run cleanly, logs a `gate` record with `decision:'abort'`, closes the
run (`close-run <farmRunId>`, §Farm database), and leaves the working tree exactly as it was at
that point (nothing committed, nothing pushed).

---

## Auto-bypass mode (`--auto-bypass`)

A distinct, standalone flag from `--auto` — **not** a superset of it and not implied by it.
`--auto` only ever auto-passes the two soft gates and still stops hard at commit and upstream
submit. `--auto-bypass` removes every pause up through commit, including `GATE-DIFF` and a
HARD-promoted `GATE-ESCALATE`, so a run can go from `/crg-farm --auto-bypass …` straight to opened
**draft** PRs with zero human interaction. It does **not** touch `GATE-SUBMIT` — every PR it opens
stays a draft; flipping one to ready-for-review is a separate, deliberate action outside the farm
loop, always. It trades the "diff reviewed before it commits" guarantee for full automation while
keeping the "a human decides what reaches a maintainer" guarantee intact — opt in deliberately,
and expect to ask for it by name every time; it is never inferred from `--auto` or from repeated
approvals in a prior run.

**Candidate cap.** Immediately after ranking (§Ranking) and before GATE-RECON would normally ask,
auto-bypass truncates the fresh, ranked candidate list to the **top 5**. This is a hard cap, not a
default suggestion — a bypass run never triages, fixes, or opens PRs for more than 5 candidates,
regardless of how many survived dedup.

**Concurrency cap.** Each surviving candidate's TRIAGE → FIX → escalate → PR-prep pipeline runs as
its own `Workflow` invocation, keyed by repo. Launch each one as soon as it's ready rather than
batching (don't wait for siblings to finish RECON/TRIAGE before starting a repo's FIX); auto-bypass
runs pipelines **concurrently, capped at 5 in-flight at once** — satisfied by construction once
the candidate cap above holds.

**Gate behavior** — every gate auto-passes its recommended default and logs `bypass:true`:

| Gate | Auto-bypass behavior |
|---|---|
| GATE-RECON | approve-all, already truncated to the top 5 |
| GATE-TRIAGE | select-bugs: the confirmed non-conflicted set, tier = complexity recommendation |
| GATE-ESCALATE (soft) | escalate-tier, up to `maxTier` (default opus) |
| GATE-ESCALATE (HARD, regression) | escalate-tier, climbing to the **next, strictly higher** tier — never a retry of the tier that just regressed. Every tier gets exactly one shot, always, no exceptions (raised from the normal "escalate at most once" rule, §Escalation, only in that a regression at `haiku` can still climb through `sonnet` *and* `opus` — up to two hops — before running out of ladder). If the regression happens already at `maxTier`, there is no higher tier to climb to — hand off immediately, no retry. That candidate is dropped from PR-prep and marked `handed-to-human` in the final report; bypass never auto-commits a regressing diff |
| GATE-DIFF | approve-for-PR, unconditionally, for any candidate whose final gate is clean |
| GATE-SUBMIT | **always** `keep-draft` (unchanged mechanics, §PR-prep — `gh pr create --draft` and stop). Logged `bypass:true` for audit parity, but no flag ever resolves this to `submit-upstream` |

**Security routing.** Immediately after TRIAGE returns confirmedBugs for a candidate, classify them
against the fixed checklist (§Security classification & the advisory track). If any bug in that
candidate's batch is flagged `securitySensitive`, the whole candidate is excluded from FIX/PR-prep
— rather than partially proceeding — and auto-routed to the advisory track in the harness's own
Advisory stage (`outcome: 'security-advisory'` → `'advisory-compiled'`). The harness runs
PoC-VERIFY, TRACE-EXPLOIT-PATH, SEVERITY-CALIBRATE, and COMPILE-REPORT itself, auto-passing
`GATE-ADVISORY-REVIEW` to `save-only`: it writes the report to `~/.claude/crg-farm/advisories/` and
stops there — never a fix, commit, PR, or transmission. The prose path (`--prose`, or a plain
`/crg-farm` run without `--auto-bypass`) runs the same track with a human present at
`GATE-ADVISORY-REVIEW` in place of the auto-passed save-only.

**Reporting.** After every candidate's pipeline settles — shipped or handed-to-human — produce one
summary for the whole run: per candidate, repo + issue, tier it closed at, and either the draft PR
URL or the hand-off reason (including a security exclusion) with a pointer to the RED repro tests
left in the clone cache. Under `--auto-bypass` the user was not present for any gate, so this
report — plus the drafts themselves, sitting unsubmitted until a human reviews and readies them —
is the only record they see.

### Prose vs. harness

Like crg-debug itself, `--auto-bypass` has two enforcement modes over the same rules above — they
differ in **who** enforces the candidate cap, the concurrency cap, and the one-shot-per-tier rule:

| | Prose (default) | Harness (`workflows/crg-debug.farm-bypass.js`) |
|---|---|---|
| Enforcement | the model follows this section | real JS: `.slice(0, 5)`, a `pipeline()` over ≤5 items, a tier function that can only climb — it has no way to return the tier it was just called with |
| RECON sourcing | scoped mode may use `/xplore` (main-loop-only) | `gh` only in every mode, including scoped — a Workflow agent cannot call `/xplore` |
| Invocation | the `/crg-farm` skill runs Steps 1-4 itself | one `Workflow({scriptPath: '.../crg-debug.farm-bypass.js', args:{...}})` call replaces Steps 1-4 entirely |
| When it's used | always available; the only option if the harness file isn't installed, or `--prose` is passed | preferred automatically once installed (`crg-deterministic` enabler), same convention as crg-debug's own Workflow |

The harness exists because auto-bypass is the one mode where nothing a human would have caught
gets a second look — every cap this section describes is exactly the kind of "the model is
supposed to stop at 5" rule that is worth pinning in code instead of a prompt. It reuses
`crg-debug.js` unmodified via the `workflow()` composition primitive (one Workflow calling
another) for both TRIAGE and FIX passes, so the underlying detect/fix engine is identical between
prose and harness auto-bypass — only the orchestration around it (RECON, ranking, the cap,
escalation bookkeeping, PR-prep sequencing) moves from prompt-following to code.

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

## Security classification & the advisory track

Same pass as complexity scoring (after `--detect-only` persists the ledger), classify each
`confirmedBugs[]` entry against a fixed checklist — conservative on purpose, a false positive only
costs one extra gate, a false negative risks a public PR that discloses an unpatched vulnerability:

- injection (command/SQL/template/code — unsanitized input reaches an interpreter, shell, or query)
- auth/authz bypass (missing or incorrect access check)
- secrets/credential exposure (hardcoded secret, or a secret reaching logs/responses/cookies
  without the protection the surrounding code implies it should have)
- SSRF, path traversal, or arbitrary file read/write
- insecure deserialization
- cryptographic misuse (weak/no encryption where the code implies it's required, predictable tokens)
- memory-safety bug in an unsafe/native path (buffer overflow, use-after-free) reachable from
  attacker-influenced input

A bug matches `securitySensitive: true` when its root cause fits one of these categories **and**
the tainted input isn't obviously operator-only (a CLI flag only an admin sets, a value derived
from git's own output). When reachability is unclear, flag it anyway — TRACE-EXPLOIT-PATH below is
where that gets resolved with evidence, not a guess at GATE-TRIAGE time. Record `securitySensitive`
and `vulnClass` on the bug's row for GATE-TRIAGE and the farm DB.

**GATE-TRIAGE** shows security-sensitive bugs in their own group, separate from the normal
confirmedBugs list, with a note that they will not enter the normal PR pipeline. They are excluded
from `select-bugs`'s default set (§Named-Gate Protocol) — the normal pipeline only ever proceeds
with non-security bugs.

**GATE-SECURITY-ROUTE** (soft) fires per repo, immediately after that repo's GATE-TRIAGE, only when
≥1 of its bugs is `securitySensitive`: shows each flagged bug with its `vulnClass` and the flag
rationale; options `advisory-track` *(Recommended)* / `treat-as-normal-bug` (override — e.g.
already publicly disclosed, embargo lifted, or the flag was a false positive at a glance) / `drop`
/ `abort`. `treat-as-normal-bug` rejoins the bug to the normal confirmedBugs set and it proceeds
through FIX like anything else; everything else follows the track below. Under `--auto` (and
`--auto-bypass`, a superset for this gate's purposes), skip `gate-asked` — `advisory-track` is
auto-passed, nothing is shown.

**Under `--auto-bypass`, the harness auto-passes this gate to `advisory-track`.** It classifies
confirmedBugs the same way, excludes the whole candidate from FIX/PR-prep, then runs the advisory
track itself in its Advisory stage (§Auto-bypass mode → "Security routing") — auto-passing
`GATE-ADVISORY-REVIEW` to `save-only`. PoC-VERIFY/TRACE-EXPLOIT-PATH/SEVERITY-CALIBRATE/COMPILE-REPORT
run unattended; the prose path runs the identical track with a human reviewing the compiled report
at `GATE-ADVISORY-REVIEW` instead.

### The advisory track (never reaches GATE-DIFF, PR-PREP, or GATE-SUBMIT)

No code is ever committed or pushed for a bug on this track — the deliverable is a private report,
not a PR. Runs per bug (or per tightly-coupled cluster of bugs sharing one root cause), in the prose
path (human at `GATE-ADVISORY-REVIEW`) or the `--auto-bypass` harness (that gate auto-passed to
`save-only`):

1. **PoC-VERIFY.** Write and *actually run* a minimal, non-destructive proof of concept against the
   real vulnerable code — instantiate the actual function/class from the cloned repo (§Clone cache)
   with a crafted malicious input, execute it, and observe a harmless side effect (a marker file, a
   benign echo) rather than anything destructive. Never claim exploitability without having run
   something; if execution genuinely isn't feasible (needs live infra you can't stand up locally),
   say so explicitly and mark the verdict `inconclusive` rather than asserting it. Record: the PoC
   code, the exact command run, its full output, and a verdict — `confirmed-exploitable` /
   `confirmed-not-exploitable` (a false positive caught before it wasted a report) /
   `inconclusive-could-not-execute`.
2. **TRACE-EXPLOIT-PATH.** Follow the taint from an attacker-reachable input to the vulnerable sink,
   hop by hop (file:line, the value at that hop, why it is or isn't attacker-influenced) — grep
   every call site of the vulnerable function, don't stop at the first one. The reachability
   verdict this produces (remote/unauthenticated, remote/authenticated, local-only,
   operator-only-not-exploitable) is evidence, not a guess, and it's what GATE-SECURITY-ROUTE's
   flag gets confirmed or downgraded against.
3. **SEVERITY-CALIBRATE.** Compute severity from what steps 1–2 actually showed — reachability ×
   impact (RCE/data-loss/auth-bypass/info-disclosure) × PoC verdict — independent of whatever
   severity label the discovery/fix agent may have attached upstream. Never repeat an agent's
   severity claim without recomputing it here; if the PoC came back `inconclusive`, cap the language
   at "potential" and say why. Downgrading a claim (or upgrading one an agent under-called) is a
   normal, expected outcome of this step, not a failure of it.
4. **COMPILE-REPORT.** Assemble one Markdown report per bug (or per coupled cluster) at
   `node lib/farm-db.mjs advisory-path '<owner/repo>' '<keyOf>'` — a path under
   `~/.claude/crg-farm/advisories/` (`CRG_FARM_ADVISORIES` overrides the root), deliberately outside
   any cloned repo's working tree so it can never be swept into a commit by PR-PREP. Sections:
   summary, affected file(s)/line(s)/commit, `vulnClass`, root cause, the taint trace from step 2,
   the PoC code + exact command + output from step 1, the calibrated severity + rationale from step
   3, a suggested fix (described in prose/diff form — **not** applied to the working tree, not
   committed), and a blank disclosure-timeline section for the human to fill in themselves. Append
   an `advisory` farm-DB record (`repo`, `keyOf`, `vulnClass`, `severity`, `pocVerdict`,
   `reportPath`).
5. **GATE-ADVISORY-REVIEW** (HARD by default — blocks under a plain invocation or `--auto`;
   auto-passed to `save-only` under `--auto-bypass`, in both the harness's Advisory stage and the
   `--prose` path): show the
   compiled report (or its path plus a summary) to the human; options `save-only` *(Recommended)* —
   leave the file in place, the human handles disclosure manually, e.g. via GitHub's own Security
   Advisory UI — / `revise` (loop back into COMPILE-REPORT with the human's notes) / `discard` (the
   PoC or trace changed the picture — false positive, drop it) / `abort`. Under `--auto-bypass`
   (prose path), skip `gate-asked` — `save-only` is auto-passed, nothing is shown. **This tool
   never files, emails, or otherwise transmits a security report on the human's behalf under any
   option, auto-passed or not** — disclosure channel and timing are the human's call, not an
   agent's, full stop. Append a second `advisory` record with the final `decision`.

`TRACK` after `save-only`/`discard`/`abort` here follows the same `close-run` step as the normal
pipeline (§Farm database) — the advisory track still closes out its `farmRunId` participation even
though it never touches PR-PREP.

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
     right lever → **GATE-ESCALATE (soft)**; options `escalate-tier` *(Recommended)* /
     `stop-keep-fixed` / `hand-to-human` / `abort`. On `escalate-tier`, slice ledger to the
     unfixed keys and re-invoke `--from-ledger` at the next tier.
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
| `gate-asked` | immediately before each non-auto/non-bypass `AskUserQuestion` | `gate`, `farmRunId`, `repo` (if per-repo) |
| `gate` | per gate decision (once `AskUserQuestion` returns, or immediately for an auto/bypass decision) | `gate`, `decision`, `farmRunId` (+ `auto:true` under `--auto`, or `bypass:true` under `--auto-bypass`) |
| `attempt` | per fix pass | `tier`, `fixed:[keyOf]`, `unfixed:[{keyOf,reason}]`, `finalGateClean` |
| `pr` | draft-create + submit | `repo`, `issueRef`, `url`, `state`, `keyOf` |
| `advisory` | COMPILE-REPORT (draft) and GATE-ADVISORY-REVIEW (final decision) | `repo`, `keyOf`, `vulnClass`, `severity`, `pocVerdict`, `reportPath`, `decision` |
| `run-end` | loop finishes — TRACK, or any abort | `farmRunId`, `startedAt`, `endedAt`, `durationMs` (+ `backfilled:true` if reconstructed) |

`keyOf` (`norm(file)::norm(rootCause)`, from `ledger-slice.mjs`) is the cross-run identity. The
farm-DB dedup pass (§RECON pass 1) uses it so the farm never re-works a bug we already shipped or
exhausted; the upstream duplicate-fix check (§RECON pass 2) is the complementary guard against
duplicating *someone else's* in-flight or merged fix.

`run-end` closes the run started by its matching `run` record: `startedAt` is that record's `ts`,
`endedAt`/`durationMs` are computed by `node lib/farm-db.mjs close-run <farmRunId>` (defaults
`endedAt` to now). Call it exactly once per `farmRunId` — at TRACK on the happy path, or
immediately after logging an `abort` gate decision. Historical runs from before `run-end` existed
can be reconstructed with `node lib/farm-db.mjs backfill-run-ends`, which derives `endedAt` as the
latest `ts` among that `farmRunId`'s existing records and marks the result `backfilled:true`; it
skips any `farmRunId` that already has a `run-end`, so it's safe to re-run.

`node lib/farm-db.mjs gate-waits '<filter>'` pairs each `gate` decision with its `gate-asked` and
returns `waitMs` — the real time a question sat in front of the human, not a gap inferred from
neighboring records. Runs predating `gate-asked` get `waitMs: null` for those gates (nothing to
pair); there is no backfill for this one — unlike `run-end`, there's no proxy timestamp for when an
already-answered question was first shown.

`node lib/farm-db.mjs advisory-path '<owner/repo>' '<keyOf>'` prints the deterministic report path
for a bug on the advisory track (§Security classification & the advisory track) — always under
`~/.claude/crg-farm/advisories/` (`CRG_FARM_ADVISORIES` overrides the root) and never inside a
cloned repo's working tree, so a compiled report can't be accidentally staged by PR-PREP.
