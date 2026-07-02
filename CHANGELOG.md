# Changelog

All notable changes to the crg-debug plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.14.0] - 2026-07-02

### Added
- **Feed-forward resource caps on every gate container (`--cpus=4 --memory=6g`).** The concurrency
  cap bounds candidate *count*, not build *weight* — three concurrent heavy gates (a `dotnet` /
  `gradle` / `cargo` build each forks many compiler processes) still oversubscribed the host; one
  uncapped run drove a 12-core machine to load 200+ and had to be killed. Every containerized
  install/toolchain/gate command now carries a fixed CPU + memory cap, bounding worst-case load to
  ~`CANDIDATE_CAP × cpus` at the container boundary where the resource is actually spent. The cap is
  a constant, not derived from live load: the Workflow script has no shell to sample the machine and
  a probe agent would add load and lag a spike — deterministic feed-forward beats a latent feedback
  loop. Static heavy-toolchain serialization is documented as the next lever if caps prove
  insufficient; runtime load-sensing is explicitly rejected.
- **Recon-time security exclusion for `/crg-farm --auto-bypass` (`--no-security`, or "not
  security" in the query).** Skips security-sensitive candidates during RECON so a wildcard run
  fills its slots with directly-PR-able functional bugs. This is a heuristic pre-filter only; the
  authoritative security decision remains TRIAGE's `secCheck` + the advisory track.
- **In-process verbosity — transitions, decisions, and agent assignments are logged.** A `note()`
  helper streams every stage transition and decision (with its *why*) to the `/workflows` narration,
  and a `mark()` helper mirrors the key ones as pollable farm-DB `stage` records — so a run's
  progress is trackable at a glance without waiting for it to finish.

### Changed
- **Concurrency lowered from 5 to 3** (candidate cap and in-flight pipeline cap). Combined with the
  per-container resource caps, this keeps a wildcard run within a single host's headroom.

### Fixed
- **Fix-quality gates hardened after a stopped run surfaced unshippable fixes.** Two guards added to
  the crg-debug methodology: a **dead-code guard** (Phase 4 diff review) — every symbol the fix
  newly declares must have a call site in reachable production code, so an added-but-unused helper
  can't ride along in a "green" diff; and a **repro-must-compile guard** (TDD RED) — a test that
  fails to *compile* (wrong language version, a feature the repo's toolchain can't parse, an
  undefined symbol) is not a valid RED, so a bug whose repro the repo can't express is marked
  *suspected* rather than forced through.

## [0.13.0] - 2026-07-01

### Added
- **Farmability prior — `/crg-farm --auto-bypass` demotes predictably-unbuildable repos before the
  top-5 cap.** Wildcard runs were spending every slot on repos a slim container can't build
  (C++/premake, Android/Gradle, giant RN monorepos) and shipping nothing. RECON now scores a cheap,
  no-clone farmability prior per candidate from repo metadata (language, build manifests, size) and
  from prior `unfarmable` verdicts recorded per `repo::env`, then sinks low-prior and
  previously-unbuildable candidates below comparable-impact farmable ones. The prior is a
  third-order sort key and the final demotion + cap are enforced in JS, so it over-selects farmable
  repos without ever hard-excluding one — a demoted repo still runs when fewer than five farmable
  candidates exist. New farm-DB record type `buildability` lets the farm learn a repo's env
  verdict across runs instead of re-deriving it.

### Fixed
- **Container env provisioning: the deps volume is now mounted on every toolchain command.** The
  setup agent installed language deps into the `crg-deps-<slug>` volume but could run the baseline
  typecheck without the `-v crg-deps-<slug>:/work/<depDir>` mount, so installed binaries (`tsc`,
  `pytest`, `eslint`) went missing and an unbuildable env was misread as a broken build
  (`Expensify/App` handed off unfarmable on `tsc: not found`). The dep dir is pinned at install, the
  mount is required on every command, and a `not found` failure self-corrects — re-add the mount and
  rerun before classifying env vs code.

## [0.12.0] - 2026-07-01

### Added
- **`/crg-build` — a readiness-campaign track that reuses the crg core for building instead of
  debugging.** One invocation boots the target app (skill-owned daemons: the Workflow never starts
  or stops a server — it returns `status:'app-down'` and the skill restarts), surveys readiness
  gaps across seven dimensions (`stability, completeness, consistency, polish, reachability, docs,
  launch-blockers`) with dimension-disjoint surveyors — the browser-driving ones serialized over
  the single Playwright MCP instance — adversarially verifies every gap (refute = already-done /
  intentional / out-of-scope; confirm must also refine every acceptance criterion into a testable
  `command` or `browser` check), then persists a ranked readiness ledger for **GATE-SPEC**. Build
  mode (`fromLedger` + `approvedGapIds`) packs approved gaps into dependency-ordered, file-disjoint
  waves (`packWaves`: greedy earliest-fit, deterministic cycle-break toward the earlier-ranked gap,
  dep-deferred cascade) and closes each gap only when **Gate A** (every command criterion re-run
  blind, exit codes judged by the script) AND **Gate B** (a serialized headless browser gate —
  `browserVerdict` in JS over httpStatus / non-allowlisted console errors / screenshot / assertions,
  one retry after an infra-shaped failure, two → `app-down`) both pass. Each green wave is
  committed per subrepo with a script-verified allowlist (`commitFilesOk` ⊆ check), a
  script-composed message, and the no-attribution rule enforced in code (`commitMessageOk` — a
  violating commit is reverted with `git reset --mixed`). Never pushes. New files:
  `skills/crg-build/{SKILL.md,methodology.md}`, `workflows/crg-build.js`, `lib/build-profile.mjs`
  (`validateProfile` / `autoApprove` — the `--auto-bypass` GATE-SPEC replacement: High|Medium
  impact, S|M effort, `launch-blockers` always excluded, top-12 cap / `scoreUx` — two-scorer merge,
  mean or min-on-disagreement), plus extraction-pattern test suites
  `test/crg-build-helpers.test.mjs` and `test/build-profile.test.mjs`. The campaign loop (PROFILE →
  STABILIZE via composing crg-debug per subrepo → BOOT → SURVEY → GATE-SPEC → BUILD → UX-REVIEW →
  LOOP) lives in the skill; campaign state reuses `farm-db.mjs` unchanged via
  `CRG_FARM_DB=<appRoot>/.crg-build/campaign.jsonl`. The enabler now also installs `crg-build.js`,
  `crg-build.methodology.md`, and `crg-build.profile.mjs`.

## [0.11.1] - 2026-07-01

### Changed
- **crg-debug/crg-farm commits and PR bodies no longer carry any AI/Claude/Anthropic attribution.**
  The co-author trailer previously added to every commit (`Co-Authored-By: Claude Opus 4.8 ...`)
  is gone from the git/PR policy in `skills/crg-debug/methodology.md`, `skills/crg-farm/methodology.md`,
  `agents/crg-debugger.md`, and the `--auto-bypass` harness's commit/PR-shipping prompt in
  `workflows/crg-debug.farm-bypass.js`. Commit messages and PR bodies are now written in plain
  contributor prose and cadence — no tool credit, no session link, no emoji — to avoid the stigma
  against AI-assisted submissions on repos `/crg-farm` opens PRs against.

## [0.11.0] - 2026-07-01

### Changed
- **`/crg-farm`'s security advisory track now picks a channel instead of always compiling a formal
  report.** A live run confirmed the gap: a mechanical, one-line-fixable shell-injection bug whose
  real-world reachability required an attacker to already control the target's own monitoring
  infrastructure got escalated straight into a multi-page GHSA report — the maintainer rejected it,
  pointing out the fix could have been a one-line PR with one sentence of motivation, "as
  communication from human to human." New gate **`GATE-DISPATCH-CHANNEL`** fires after a *quick*
  PoC-VERIFY/TRACE-EXPLOIT-PATH pass (TRACE-EXPLOIT-PATH now also produces a **marginal-risk
  verdict**: does exploiting this require a precondition that already implies far more compromise
  than the bug itself grants?) and a new **CHECK-CONTRIB-POLICY** step (fetches the target repo's
  own `CONTRIBUTING.md`/`SECURITY.md` and checks for a private-reporting requirement or PR
  conventions to honor). It picks `pr-with-motivation` — apply the fix and route through the
  **normal** GATE-DIFF → PR-PREP → GATE-SUBMIT pipeline, PR body/commit message capped at 1-3
  human-voiced sentences, no report prose — only when the fix is mechanical, the marginal risk is
  small, AND the repo's policy doesn't forbid it; any one unfavorable signal falls back to
  `advisory-report` (SEVERITY-CALIBRATE, now explicitly conservative, → COMPILE-REPORT, now short by
  default → `GATE-ADVISORY-REVIEW`, disk-only, never transmitted). `GATE-SECURITY-ROUTE` is
  unchanged (it only decides whether a bug is security-sensitive at all); the channel decision is
  new and separate, and deliberately asymmetric — the safe branch is the fallback, not the PR
  branch. `GATE-SUBMIT` still never auto-passes under any flag, so a security-sensitive bug still
  only ever reaches a maintainer via the same draft-then-human-submits path every other bug uses.
- **`/crg-farm --auto-bypass`'s harness can now run the whole security-dispatch decision itself,
  unattended** — restoring (and improving on) the capability an interim design briefly removed.
  Rather than trusting a model's summary of its own judgment, the channel decision is computed in
  plain JS (`isDispatchSafe()` in `workflows/crg-debug.farm-bypass.js`) from structured booleans an
  agent call returns (PoC verdict, fix-mechanicality, marginal-risk, contribution-policy) — the
  model reports signals, the code decides. `pr-with-motivation` candidates rejoin the exact same
  fix/PR-prep code path as any other bug (still stops at a **draft**, still never crosses
  `GATE-SUBMIT`); everything else falls back to a short, conservative, disk-only report exactly like
  the prose path. Re-added `ADVISORY_SCHEMA`(now `SECURITY_ASSESS_SCHEMA`)/the `Advisory` pipeline
  phase/the `advisory-compiled` outcome that an interim version of this change had removed.

## [0.10.1] - 2026-07-01

### Fixed
- **`/crg-farm --auto-bypass` no longer silently drops a candidate whose pipeline stage errors.**
  When a per-candidate stage threw (e.g. a subagent completed without returning structured output),
  `pipeline()` nulled that slot and `settled.filter(Boolean)` discarded it — the candidate vanished
  from the run's outcome entirely, reading as if it never ran. The run aggregation now recovers
  dropped slots by index (`settled` is index-aligned with the capped candidates) and surfaces each
  as `outcome: 'errored'` with the candidate's original repo/issue identity and a reason, kept
  distinct from `handedOff`. Added an `errored` bucket to the summary and the workflow return.

## [0.10.0] - 2026-07-01

### Changed
- **Security-sensitive bugs are now auto-routed to the advisory track under `/crg-farm
  --auto-bypass`** (previously they were excluded and handed off untouched, requiring a separate
  `--prose` re-run to get a report). The bypass harness now runs the full advisory track itself in a
  new **Advisory** pipeline stage — PoC-VERIFY → TRACE-EXPLOIT-PATH → SEVERITY-CALIBRATE →
  COMPILE-REPORT — auto-passing `GATE-ADVISORY-REVIEW` to `save-only`. It writes the report to
  `~/.claude/crg-farm/advisories/` and stops there. **The safety invariants are unchanged:**
  security-sensitive candidates still never enter FIX/PR-prep, and the harness never files, emails,
  commits, PRs, or otherwise transmits the report — the deliverable is the on-disk report only.
  `GATE-SUBMIT` is still never crossed by any flag. The prose path is unchanged (a human reviews the
  report at `GATE-ADVISORY-REVIEW`). Implemented in `workflows/crg-debug.farm-bypass.js`; the
  `--auto-bypass` docs in `skills/crg-farm/SKILL.md`, `skills/crg-farm/methodology.md`, and
  `README.md` were updated to match.

## [0.9.0] - 2026-07-01

### Added
- **Per-repo buildability provisioning for `/crg-farm` (`--env`, GATE-BUILDABILITY).** crg-debug
  gains an `env` mode: `--env container` (the harness default) provisions a **dedicated, cached
  Docker environment for each candidate repo** before TRIAGE — a slim base image for its stack,
  `apt`-hand-installed system deps (installed iteratively: build, see what's missing, install,
  retry), language deps in a persistent named volume, source bind-mounted, and every toolchain
  command wrapped to run inside it. The image is **fingerprinted by the repo's manifests/lockfiles
  and reused as-is unless deps change**, so an env is never rebuilt needlessly (cost is once per
  repo, not once per run). `--env none` keeps the prior host-as-is behavior and stays the standalone
  `/crg-debug` default, so plain `/crg-debug` is unchanged.
- **Baseline classification: environment vs. code.** Every baseline build/typecheck failure is
  tagged `code` (a genuine source defect — seeded as a bug, as before) or `env` (a missing
  tool/dep/system library, a build not applicable to the project, or Docker unavailable — NOT a
  bug). **Any residual `env` failure ⇒ the candidate is `unfarmable`:** crg-debug returns early and
  the `--auto-bypass` harness hands it off cleanly (no fix, no PR, no invented bug) instead of
  climbing tiers against an unbuildable tree. This fixes the failure class where an un-provisioned
  environment (e.g. `uv build` on a repo that was never a library) was mistaken for a code bug and
  produced a rejected PR. See `crg-debug.methodology.md` §Environment provisioning & baseline
  classification and `skills/crg-farm/methodology.md` §Environment provisioning.

### Tested
- New `test/buildability.test.mjs` runs the **real** `crg-debug.js` control flow with stubbed
  runtime globals, asserting env-kind failures route to `unfarmable` (both `container` and `none`
  modes) while code-kind failures flow into discovery. New `test/live-provision.test.mjs` exercises
  the actual Docker recipe end-to-end on a fixture repo — fingerprint-labeled image build, deps in a
  named volume, green containerized baseline, fingerprint reuse, and the host-edit→container-visible
  loop — and self-skips when the Docker daemon is down.

## [0.8.0] - 2026-07-01

### Added
- **Security advisory track for `/crg-farm`.** Confirmed bugs are classified against a fixed
  vulnerability checklist (injection, auth/authz bypass, secrets exposure, SSRF/path-traversal,
  insecure deserialization, crypto misuse, memory-safety) at the same pass as complexity scoring.
  Flagged bugs never enter the normal PR pipeline — a new `GATE-SECURITY-ROUTE` (soft) diverts
  them into a dedicated track: PoC-VERIFY (write and actually run a non-destructive proof of
  concept against the real cloned code), TRACE-EXPLOIT-PATH (hop-by-hop taint trace from
  attacker-reachable input to the vulnerable sink, with an explicit reachability verdict),
  SEVERITY-CALIBRATE (recompute severity from evidence, independent of any label an upstream
  agent attached), and COMPILE-REPORT (a Markdown report written under the new
  `lib/farm-db.mjs advisory-path` — always outside any cloned repo's working tree). A new
  `GATE-ADVISORY-REVIEW` gates the compiled report — HARD by default, auto-passable to
  `save-only` under `--auto-bypass` (prose path only), and this tool never files, emails, or
  otherwise transmits the report on the human's behalf under any option, auto-passed or not. The
  `--auto-bypass` **harness** (`workflows/crg-debug.farm-bypass.js`) never attempts this track
  itself — it classifies the same way inside its own Triage stage and excludes/hands off any
  security-sensitive candidate wholesale rather than partially proceeding, since PoC/exploit-path
  judgment stays in the prose path where a human reviews the report. New `advisory` farm-DB
  record type. See `skills/crg-farm/methodology.md` §Security classification & the advisory
  track.
- **Exact human-wait tracking for `/crg-farm` gates.** A new `gate-asked` farm-DB record is
  appended immediately before each non-auto/non-bypass `AskUserQuestion`, paired with the
  existing `gate` decision record. `node lib/farm-db.mjs gate-waits '<filter>'` matches the two
  per `farmRunId`+`gate`+`repo` and returns `waitMs` — the actual time a question sat in front of
  the human — instead of a gap inferred from neighboring records, which previously conflated
  agent work (diff prep, PR pushes) with human think time. No backfill for pre-existing runs:
  there's no proxy timestamp for when an already-answered question was first shown.
- **`/crg-farm` run duration tracking.** A new `run-end` farm-DB record type closes out each
  `farmRunId` with `startedAt`/`endedAt`/`durationMs` — appended via
  `node lib/farm-db.mjs close-run <farmRunId>` at TRACK on the happy path, or right after any
  `abort` gate decision. `node lib/farm-db.mjs backfill-run-ends` retroactively reconstructs
  `run-end` records for runs that predate this (`endedAt` = the latest `ts` among that run's own
  records, marked `backfilled:true`); it's idempotent and skips any `farmRunId` already closed.

### Fixed
- **`GATE-ESCALATE`'s recommended default was undefined.** `escalate-tier` is now explicitly
  `(Recommended)`, with the same "skip `gate-asked` under `--auto`" behavior documented for
  `GATE-RECON`/`GATE-TRIAGE`.

## [0.7.0] - 2026-06-30

### Added
- **`--auto-bypass` — a fully unattended `/crg-farm` run through commit and an opened draft PR.**
  A separate, standalone flag from `--auto` (never implied by it, never inferred from prior
  approvals): it auto-passes every gate up through `GATE-DIFF` (commit) and a HARD-promoted
  `GATE-ESCALATE` on regression — which climbs to the next, strictly higher tier, **never a retry
  of the tier that just failed**. Every tier gets exactly one shot, always; a `haiku` start can
  still climb through two regressions (to `sonnet`, then `opus`) before running out of ladder.
  Truncates ranked candidates to the top 5 (§Ranking) and runs their TRIAGE→FIX→PR pipelines
  concurrently, capped at 5 in-flight. `GATE-SUBMIT` is never bypassed by any flag — every PR this
  opens **stops at draft**; flipping one to ready-for-review stays a deliberate, separate human
  action. A regression that's still unclean once `maxTier` itself has regressed drops that
  candidate from PR-prep and marks it `handed-to-human` in the run's closing report instead of
  committing an unclean diff. Every gate decision it auto-passes is logged `bypass:true` (never
  `auto:true`), keeping the audit trail able to distinguish a human "yes" from `--auto`'s
  soft-gate defaults from a fully unattended bypass. See `skills/crg-farm/methodology.md`
  §Auto-bypass mode.
- **`workflows/crg-debug.farm-bypass.js` — the harness-held option for `--auto-bypass`.** A new
  deterministic Workflow, installed by the existing `crg-deterministic` enabler, that owns RECON
  (dedup + rank + the top-5 cap), TRIAGE, FIX/escalation, and PR-prep in real JS instead of prompt
  compliance — the top-5 cap, the 5-way concurrency cap, and the one-shot-per-tier escalation rule
  are all enforced in code (a strictly-climbing tier function that cannot return the tier it was
  just called with), not trusted to a model self-policing them across up to 5 parallel repos.
  Composes the existing `crg-debug.js` Workflow unmodified via the `workflow()` nesting primitive
  for both TRIAGE and FIX passes, so the underlying detect/fix engine is identical between prose
  and harness auto-bypass. `/crg-farm --auto-bypass` prefers it automatically once installed;
  `--prose` forces the prompt-driven path (needed for a scoped `/xplore` sweep, which a Workflow
  agent can't run). See `skills/crg-farm/methodology.md` §Auto-bypass mode → "Prose vs. harness".

## [0.6.0] - 2026-06-30

### Added
- **`/crg-farm` RECON ranks fresh candidates by impact × review-likelihood.** Previously GATE-RECON
  showed an unordered dump of fresh candidates, which stopped being triageable once a themed or
  wildcard search returned 20+ results. RECON now pulls two signals per distinct repo —
  `stargazerCount` (blast-radius proxy) and the last 5 merged-PR timestamps (review-cadence proxy:
  tight spacing means active review, a stale gap since the last merge demotes a repo even if its
  historical cadence looked fast) — and combines them with an impact read of the issue body itself
  (data-loss/security/safety-relevant bugs outrank functional breakage, which outranks cosmetic
  ones). Candidates sort impact-first, review-likelihood as tiebreaker/demotion, with the signals
  recorded on each `candidate` farm-DB row (`rankSignals`). Because a ranked list commonly exceeds
  the 4-option cap on a gate, `select-subset` at `GATE-RECON` is now a two-step pick: the ranked
  list posted as plain text, then a compact cut-point follow-up (Top-5/Top-10/Top-N/Custom). See
  `skills/crg-farm/methodology.md` §Ranking.

## [0.5.1] - 2026-06-30

### Fixed
- **`/crg-farm` no longer defaults RECON to the current-directory repo.** The skill's `repoRoot`
  resolution silently fell back to `git rev-parse --show-toplevel`, so an unscoped invocation would
  farm bugs in whatever repo happened to be the working directory instead of sourcing candidates
  from GitHub. RECON now resolves a mode from `direction`: **scoped** (a named repo, or `--issue`)
  runs `/xplore` against that repo as before; **themed** (free-text topic, no repo) and **wildcard**
  (no direction at all) run a cross-repo `gh search issues` instead, since `Explore` agents can't
  reach remote GitHub. `repoRoot` is no longer resolved up front — each candidate's repo is
  cloned/synced lazily via a new persistent clone cache at `~/.claude/crg-farm/repos/<owner>/<repo>`
  once it survives `GATE-RECON`, and candidates sharing a repo are batched into one `--detect-only`
  triage pass. See `skills/crg-farm/methodology.md` §Sourcing candidates and §Clone cache.

## [0.5.0] - 2026-06-30

### Added
- **`/crg-farm` — a bug-farming loop over crg-debug.** A `user_invocable` main-loop orchestrator
  that sources real open bugs, triages them cheaply, escalates model capacity only where repair
  struggles, and ships draft PRs — with formal human approval at every consequential boundary. It
  *calls* crg-debug as a primitive (zero Workflow changes). Stages: RECON (`/xplore`) → dedup →
  TRIAGE (`--detect-only`) → FIX (`--from-ledger`, escalating haiku→sonnet→opus) → PR-prep. See
  `skills/crg-farm/`.
- **Two-pass duplicate-fix check in RECON** — before any triage spend, each candidate is verified
  as genuinely open AND not already being fixed: pass 1 dedups against our own farm history; pass 2
  checks the upstream repo (`gh issue view` / `gh search prs` / `gh pr list`) and classifies each
  candidate fresh / in-flight / already-fixed, dropping the latter two so the farm never produces a
  duplicate PR for a bug someone else already has in flight.
- **Named-Gate Protocol** — five repeatable approval gates (RECON, TRIAGE, ESCALATE, DIFF, SUBMIT)
  via `AskUserQuestion`. `GATE-DIFF` (working-tree→commit) and `GATE-SUBMIT` (fork→upstream) are
  HARD stops that `--auto` never bypasses; soft gates auto-pass under `--auto`.
- **Orchestrator-driven model escalation** — reads the Workflow's `ret.fix` return, narrows the
  ledger to just the unfixed bugs (`lib/ledger-slice.mjs`), and re-invokes `--from-ledger` at the
  next tier, so a stronger model only ever re-runs the hard bugs. Branches on failure channel
  (RED-not-observed vs a regressing final gate).
- **Farm database** — `lib/farm-db.mjs`, a global append-only JSONL at
  `~/.claude/crg-farm/history.jsonl` recording every run, candidate, gate decision, fix attempt,
  and PR across all repos. Enables cross-run candidate dedup (never re-work a shipped bug) and a
  full audit trail. `CRG_FARM_DB` overrides the path.
- `lib/ledger-slice.mjs` + `lib/farm-db.mjs` — standalone importable + CLI helpers (mirroring
  `issue-ref.mjs`), each with a zero-dependency `node --test` suite. Installed next to the workflow
  by the `crg-deterministic` enabler.

### Changed
- **Hardened the TDD RED step** (methodology + fix-agent prompt): a test that asserts the current
  buggy output or expects the reported exception (`assert_raises` on the very error) is INVALID —
  it codifies the bug and falsely "passes" RED. This is the guard the numpy einsum experiment
  showed was needed (the fix agent had degenerated to asserting the symptom).
- **Final gate narrows to the CRG blast radius** of touched files (impact radius + `tests_for` +
  affected flows) instead of running the whole suite — a fix run can no longer hang polling a giant
  test suite while still catching cross-file regressions.

## [0.4.0] - 2026-06-30

### Added
- **`--from-ledger <path>`** — resume from a prior read-only run's `.crg-debug/ledger.json` and skip
  straight to Phase 4 fix waves over the already-confirmed bugs. Enables a serialized
  detect → review → fix hand-off (run `--detect-only`, review the ledger, then fix it). Implies
  `fix=true`.

### Changed
- The deterministic workflow now resolves `methodology.md`'s path at runtime via
  `args.methodologyPath` (passed by the `/crg-debug` skill) instead of having it baked in by `sed`
  at install time — `crg-deterministic` now just copies `workflows/crg-debug.js` unmodified.
- README restyled with badges and section emojis (no content changes).

## [0.3.0] - 2026-06-30

### Added
- **Point the sweep at an issue/ticket.** `--issue <ref>` (or a GitHub ref auto-detected in
  the freeform args — `#n`, `owner/repo#n`, or a full issue URL) fetches the issue via `gh` and
  drives the run from it: the issue resolves the file set *and* is threaded into the discovery
  finders, so they hunt the specific reported symptom rather than just "bugs in these files."
  Non-GitHub trackers (Jira/Linear/…) are supported via a paste fallback — pasted ticket text
  becomes the focus. The issue reference is recorded in the run header, the ledger, and the report.
- `lib/issue-ref.mjs` — a standalone, importable + CLI reference parser the skill calls to classify
  input deterministically (resolving `owner/repo` from the git origin for bare `#n`). Installed
  next to the workflow by the `crg-deterministic` enabler.
- Test suite (`node --test`, zero dependencies): `test/issue-ref.test.mjs` covers every reference
  form; `test/helpers.test.mjs` extracts the workflow's pure-helper block from the shipped source
  and tests it directly (no duplication).

### Changed
- The run model now defaults to **haiku**, overridable with `--model <name>` (`--model session`
  inherits the session model). Centralized in a `resolveModel` helper.
- Issue text is untrusted external input — it only ever reaches an agent through the existing
  `fence()` / `UNTRUSTED` guard, so a crafted issue body cannot steer the run.
- Consolidated the workflow's pure helpers (`fence`, `norm`, `keyOf`, `shortFile`, `bugFile`) and
  argument coercion (`resolveModel`, `clampRounds`, `capText`) into one dependency-free, unit-tested
  block.

## [0.2.1] - 2026-06-29

### Added
- Persist the confirmed-bug ledger to `.crg-debug/ledger.json`.
- Coupled-bug prose fallback: when per-bug fix waves stall on bugs that share one validating test,
  a single holistic prose attempt is made before escalating to a human.

## [0.2.0] - 2026-06-29

### Added
- Opt-in loop-until-dry discovery (`discoveryRounds`): re-run the finders, each round told what is
  already found, until a round surfaces nothing new or the cap is hit.

## [0.1.3] - 2026-06-29

### Changed
- `crg-debugger` subagent inherits the caller's model (was pinned to opus).
- Hold conflicted-verdict findings out of the fix queue.
- Namespaced the enabler binary as `crg-deterministic`.

### Added
- Initial release: graph-driven parallel debugging plugin for Claude Code — build the
  code-review-graph, map hotspots, fan out concern-disjoint finders, adversarially verify, and fix
  confirmed bugs in TDD waves over file-disjoint sets. Nothing is committed.

[0.4.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.4.0
[0.3.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.3.0
[0.2.1]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.2.1
[0.2.0]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.2.0
[0.1.3]: https://github.com/CodeBlackwell/crg-debug/releases/tag/v0.1.3
