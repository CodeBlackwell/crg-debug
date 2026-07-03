# Changelog

All notable changes to the crg-debug plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.17.0] - 2026-07-03

### Added
- **`/crg-agentsmd` packaged (M4): SKILL.md + README + enabler complete.** The skill routes the
  two-stage run (mine → score+draft, chained; `--mine-only` / `--score-only` / `--score-sample` /
  `--ab` flags) to the installed Workflow with a prose fallback, and carries the honest instrument
  framing the pilot earned: measured on one repo, the mined draft covered 24% of held-out review
  corrections vs 12% for a length-matched generic placebo, and a 3-PR implementation A/B showed no
  lift over placebo — it documents measured reviewer norms; it is not demonstrated to make agents
  build better code. The enabler now also installs the A/B harness lib. The draft is never
  committed, never posted; upstream contribution stays a human act, scores quoted honestly.
- **Validation rerun of the condensed pipeline** (same repo, same corpus): 19 agents total vs the
  pilot's ~43, score leg 731k → 441k tokens, and holdout coverage improved to 24.1% (kept 10 rules,
  39-line draft). Honest miss: mine-leg tokens barely moved (930k) — mining cost tracks corpus
  volume, not miner count.

### Changed
- **`/crg-agentsmd` condensed to measured yield — roughly half the agents and tokens of the
  pilot runs, same invariants.** The pilot paid for the measurements; this spends to them:
  - *Miners 12 → 5, modalities 5 → 3.* Code-invariants and docs miners produced zero rules that
    survived scoring across twelve runs; they are context for verification and synthesis now, not
    rule sources. Review-comments (7 of 9 kept rules), diff-evolution, and git-archaeology remain.
  - *Verify's two judgment fleets merged into one.* Counterexample hunt and restatement detection
    need the same rule text and repo neighborhood; one attacker per scope-batch (8 rules) now
    answers both, halving the judgment agents and the duplicate context reads.
  - *Holdout judges 10 → 3* (64-comment batches; the cost is per-comment reasoning, per-agent
    setup was pure overhead), judges take explicit index lists, and `reason` text is only emitted
    when credit is given. New `scoreSample` arg judges an unbiased stride sample for cheap
    iteration runs. A deterministic drop-replies prefilter was evaluated and rejected: 6 of the
    pilot's 21 covered comments were replies.
  - *Ceremony agents collapsed.* rules-fragment persist + ledger assemble, ledger ingest + holdout
    extraction, and score + stamp each run as one gate agent instead of two (score-path ceremony
    5 agents → 3). Ingest validates the rule list per-line by index instead of trusting the
    agent's self-reported count.
  Estimated clean full run: ~1.4M tokens / ~45 agents → ~700–900k / ~20; score-only rerun 16
  agents → 7.

## [0.16.0] - 2026-07-03

### Changed
- **Per-wave branch commits are now the DEFAULT for `/crg-debug` fix runs — universally, in every
  flow (Workflow, prose mode, `/crg-build` STABILIZE, `/crg-farm --auto-bypass`).** The old
  never-commit contract left validated waves as one undifferentiated working-tree blob: no rollback
  point when wave N regresses wave 1, no fix→bug attribution in the diff, dirty trees that block
  chained runs — and, decisively, the TDD tests each wave writes stayed **untracked and therefore
  invisible to the graph** (CRG indexes only git-tracked files), so `tests_for`/blast-radius gate
  queries could never see them. Now the fix phase:
  - creates (or reuses) a `crg-debug/fix-<slug>` branch off the current HEAD — the slug is a
    deterministic hash of the bug set, so resumes and farm tier-retries land on the same branch;
    the user's own branch is never committed to, and pre-existing uncommitted changes stay
    untouched in the tree (waves stage only their own files by explicit path);
  - commits each wave only after its per-bug close gates are green, restricted to the closed bugs'
    own source + test files, and verifies in JS what actually landed (`commitFilesOk` allowlist
    subset + `commitMessageOk` no-attribution gate — messages are built from file names only, so
    bug prose citing e.g. CLAUDE.md can never trip or leak into them); a bad commit is un-committed
    (`reset --mixed HEAD~1`) with the work left in the tree;
  - **re-ingests the graph (`code-review-graph update`) after every wave commit**, so later waves,
    per-bug gates, and the final blast-radius gate query a graph that matches the tree — this also
    closes the gap where `fromLedger` runs never refreshed the graph at all (the branch-setup agent
    now does status/build/update up front);
  - never pushes, ever. `commit:false` opts back into the legacy working-tree-only mode; branch
    setup failure degrades to it automatically rather than committing on the user's branch.
- `/crg-build` wave commits now also re-ingest the graph after each commit, and its
  GATE-STABILIZE-COMMIT reflects the new reality (review/merge the fix branch instead of committing
  loose dirt).
- `/crg-farm --auto-bypass`: tier-escalation reset now hard-resets the throwaway clone and deletes
  `crg-debug/fix-*` branches (a dirty-file checkout alone no longer suffices); PR-prep squashes the
  wave commits into the one clean human-sounding commit it always shipped (with a fallback for
  `commit:false`/legacy trees).

## [0.15.0] - 2026-07-03

### Added
- **`/crg-agentsmd` — farm a demonstrably accurate AGENTS.md from a repo's review history
  (`workflows/crg-agentsmd.js`, `lib/corpus.mjs`, `lib/agentsmd-score.mjs`,
  `skills/crg-agentsmd/methodology.md`).** Existing AGENTS.md generators read the code and emit
  plausible-sounding rules; maintainers dismiss them because they restate what any reader sees
  instead of the tacit properties that shape the code. This pipeline mines where tacit knowledge
  actually fossilizes — PR review threads (a maintainer correcting a contributor is a labeled rule
  violation), first-push-vs-merged diff evolution, revert/fixup git archaeology, code invariants,
  and existing docs — then makes every rule earn its place twice:
  - *Accuracy gates rules*: every candidate needs verbatim cited evidence at the JSON-schema
    boundary, then survives three adversarial attacks — a counterexample hunt over the current
    tree (which also refutes any rule whose quoted evidence doesn't exist at its ref), an
    executability check whose exit codes the script reads, and a restatement detector that demotes
    exactly the derivable-from-one-file failure mode.
  - *Effectiveness gates the file*: a stratified ~20% of reviewed PRs is held out at corpus time
    (enforced structurally — miners only ever see train-split files), and batched judges replay
    every held-out human review correction against the surviving rules ("would an agent that had
    READ this rule have avoided the code that drew this comment?" — mechanism match, not topic
    overlap). Zero-predictive rules are cut; the synthesized draft orders rules by measured
    coverage. The deterministic scorer (`agentsmd-score.mjs`) owns all math; judges only emit
    structured credit rows.
  A thin fossil record returns `thin-corpus` instead of padding with guesses. The draft is written
  beside the ledger and never committed or posted. No SKILL.md yet, but the `crg-deterministic`
  enabler installs the workflow, methodology, and helper modules (stamped with the plugin commit);
  runs via `Workflow({scriptPath})` with explicit `methodologyPath`/`corpusToolPath`/`scoreToolPath`.
  The `fromLedger` seam re-runs Score+Compress from a persisted ledger without re-mining.
- **Fan-out cost gates (`assertFleet`).** The first pilot ballooned to ~90 verify agents because
  per-rule attack agents multiplied by a data-dependent rule count nobody evaluated before
  spawning. Every fan-out now logs its agent arithmetic (`8 cx + 3 rs + 2 cmd = 13 agents`) and
  throws past `maxPhaseAgents` (default 40) — a phase can no longer scale its fleet silently.
  Verification is batched by design: ~6 same-scope rules per counterexample attacker, ~20 rules
  per restatement judge, ~20 holdout comments per scoring judge.
- **Per-role model tiers.** `minerModel`/`judgeModel` default to `model`, `mechModel` (persists,
  executability, corpus prep, score gate) defaults to haiku, and `synthModel` inherits the session
  model — the permanent synthesized artifact gets the strongest leg while mechanical steps run cheap.
- **`corpus.mjs` hardening.** A one-result `gh pr list` probe fails bad field names in seconds
  before any long paginated pull; raw `--slurp` pages land on disk before parsing so a parse
  failure never costs a re-download; `write-file` writes stdin to disk verbatim so persist agents
  heredoc large JSON instead of a model re-typing it as output.
- **A/B effectiveness eval (`lib/agentsmd-ab.mjs`, behind `abEval:true`).** The retrodictive score
  asks whether the rules would have prevented past corrections; the A/B asks whether the FILE
  changes what an agent produces. Three blinded arms — no file, a length-matched generic placebo,
  the mined AGENTS.md — implement K held-out merged PRs (default 3, richest review threads first)
  from the base commit; lift = mined − placebo. Built to five constraints two production retros
  paid for: arm workspaces are contamination-clean by construction (`git archive` of the base tree
  into a fresh single-commit repo — the merged fix and the `.crg-agentsmd/` answer key are
  structurally unreachable, and prep throws otherwise); fleet arithmetic is asserted before both
  the smoke and the grid; every diff lives on disk with agents relaying only compact numbers;
  a script-owned smoke gate (1 PR × mined arm, non-empty diff + finite similarity) must pass
  before the full grid may launch; and arm/judge agents never run the cheap tier. Scoring is
  CLI-owned Jaccard diff-similarity to the merged human diff plus a rubric judge anchored only to
  that PR's real review comments; the seeded-sham property (placebo fed as "mined" ⇒ ~zero lift)
  is unit-tested. `abOnly:true` evaluates the AGENTS.md already on disk without re-scoring.
- **Fragment persistence + install stamp.** The mined ledger is assembled deterministically on
  disk (`corpus.mjs assemble`: inventory + rules fragments → ledger.json) with a script-side count
  invariant, and `bin/crg-deterministic` now installs `/crg-agentsmd` stamped with the plugin
  commit — a stale `~/.claude/workflows/` install is visible in any run's first log line.

### Fixed
- **Score-phase data transport: heavy JSON never transits an agent.** The first scored pilot was
  invalidated silently — an ingest agent asked to "return the ledger exactly" truncated 43 rules
  to 2 in its structured return, and every holdout judge credited against the 2-rule list. The
  scorer CLI now owns the judged-rule index space (`rules`/`stamp` subcommands, summary-only
  `score` stdout); agents relay compact summaries guarded by count invariants that throw on any
  truncation, and the synthesis agent reads `scores.json` from disk.
- **Environment gaps no longer disprove command claims.** The pilot cut three real rules because
  `nix-shell`/`pre-commit` don't exist on the host — the same code-vs-env failure class crg-debug's
  baseline already classifies. The executability gate now returns `failureKind: code|env` (with a
  script-side stderr override that doesn't trust the agent's classification); env failures keep the
  rule flagged `unverifiedCommand`, and the scorer rescues previously env-cut rules into the judged
  list, where they survive only on earned holdout coverage. `judgedRules()` preserves the flag so
  workflow and scorer stay index-aligned.

## [0.14.2] - 2026-07-02

### Fixed
- **`/crg-farm --auto-bypass` no longer races same-repo candidates over one working tree.** The
  bypass harness fanned every capped candidate through a single flat pipeline, but the clone cache
  is keyed by repo — so in scoped mode (all candidates one repo) three pipelines shared one working
  tree and one git HEAD. Concurrent branch/commit/push stomped each other: only one PR survived and
  the rest reported phantom success (one run shipped a fix its own gate had rejected). Candidates
  are now grouped by repo and run sequentially within a repo, still concurrently across distinct
  repos. The shipped result reports the branch the harness computed, never an agent's self-report,
  so a candidate's PR can't be misattributed. In scoped mode this also drops peak concurrent
  container builds from three to one.
- **Farm runs now close themselves.** Every run appended a `run` record but never a `run-end`, on
  either exit path (early RECON bail or normal completion), leaving every run permanently "open".
  Both paths now append the `run-end` so history compaction can archive a finished run's telemetry.

### Added
- **Lossless history compaction (`lib/farm-db.mjs`: `compact` + `reconcile`).** The farm history is
  one append-only JSONL scanned on every query, and ~3/4 of its bytes are write-only telemetry
  (`candidate`, `gate`, `stage`) the hot path never reads. `compact` moves a closed run's telemetry
  to an append-only `history-archive.jsonl`, keeping only the cross-run records (`pr`, `buildability`)
  and any open run live — so dedup and demotion still resolve against a lean live file. It never
  deletes: a pre-commit guard aborts unless every original record is either kept or archived, and
  `reconcile` proves `live ∪ archive` equals everything ever written. `gate-waits` reads across the
  archive so audits survive. Maintenance incantation when the live file grows: `backfill-run-ends &&
  compact`.

## [0.14.1] - 2026-07-02

### Added
- **AI-welcome contribution greenlist (`skills/crg-farm/greenlist.json`, reference only).** A
  curated list of projects whose own docs welcome AI-agent contributions, as a human aid for
  choosing where to point `/crg-farm`. Each entry tags its `evidenceType` — an *explicit-welcome*
  (docs state AI contributions are welcome) is real consent; an *agent-file* (repo merely ships
  `AGENTS.md`/`copilot-instructions.md`) is a strong implicit signal but not consent (`libsdl-org/SDL`
  ships an `AGENTS.md` that *bans* AI PRs). Carries two authoritative registries to cross-check
  against and an `avoid` list of explicit bans. Nothing in the harness reads it — RECON, ranking,
  and the PR channel are unchanged; it stays reference-only until a real need to weight or gate on
  it appears.

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
