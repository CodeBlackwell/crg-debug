# 🐛 crg-debug

**A family of graph-driven, harness-enforced engineering workflows for [Claude Code](https://claude.com/claude-code).**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.23.0-informational)](CHANGELOG.md)

One plugin, eight commands, one idea: build a knowledge graph of the codebase, fan out narrow
agents over it, and let **deterministic code — not the model — decide what counts as done**.
Every workflow ends in evidence a script verified: a real exit code, a checksum-sealed
measurement, a diff confined to an allowlist. Nothing is ever pushed on your behalf.

| Command | What it does |
|---|---|
| [`/crg-debug`](#-crg-debug--find-and-fix-real-bugs) | Find real bugs with adversarial verification, fix them in test-first waves |
| [`/crg-farm`](#-crg-farm--the-bug-farming-loop) | Farm open bugs across GitHub into draft PRs, human-gated |
| [`/crg-build`](#-crg-build--launch-readiness-campaigns) | Survey an app's launch readiness across 7 dimensions, build the approved gaps |
| [`/crg-ralph`](#-crg-ralph--graph-compiled-feature-armies) | Compile a feature request (or Army PRD) into graph-verified parallel build waves |
| [`/crg-ui`](#-crg-ui--converge-the-ui-to-its-figma-design) | Measure pixel drift against Figma with a numeric oracle, fix approved deltas |
| [`/crg-ui-prep`](#-crg-ui-prep--become-the-perfect-crg-ui-user) | Audit + close every setup gap so `/crg-ui` starts with zero questions |
| [`/crg-integrations`](#-crg-integrations--triage--repair-an-integration-matrix) | Triage a host × scenario test matrix (regression/drift/flake), repair approved clusters |
| [`/crg-agentsmd`](#-crg-agentsmd--mine-a-measured-agentsmd) | Mine a repo's review history into an AGENTS.md scored against held-out corrections |

---

## 📖 Contents

- [How it works](#-how-it-works-in-five-sentences)
- [Why it works so well](#-why-it-works-so-well)
  - [The code-review-graph advantage](#the-code-review-graph-advantage-per-workflow)
  - [Context & harness engineering](#context--harness-engineering-per-workflow)
- [Requirements](#-requirements)
- [Install](#-install)
- [Prose vs deterministic mode](#-prose-vs-deterministic-mode)
- [The workflows](#-the-workflows)
- [The safety model](#-the-safety-model)
- [Repo layout](#-repo-layout)
- [Testing](#-testing)
- [License](#-license)

---

## 🧠 How it works, in five sentences

1. **Graph first.** Each run builds or refreshes a [code-review-graph](https://pypi.org/project/code-review-graph-codeblackwell/)
   of the repo — functions, callers, flows, hubs, communities, test links — so agents can *ask*
   where things are instead of grepping for them.
2. **Narrow agents, wide fan-out.** Work is partitioned into disjoint slices (concerns, files,
   screens, matrix cells, stories) and each slice gets its own agent with a small, fenced brief —
   no agent ever holds the whole problem.
3. **Adversarial verification.** Nothing an agent claims is trusted: findings face independent
   refuters and reproducers, fixes face blind gate agents that report raw exit codes, and
   measurements travel under checksums.
4. **Deterministic enforcement.** A JS harness (or a strict methodology in prose mode) owns phase
   order, wave packing, fences, commit checks, and every pass/fail verdict — the model supplies
   judgment, the script supplies discipline.
5. **Human gates at every consequential boundary.** Profiles, fix approvals, commits, and PR
   submission all stop for you; the automation's job is to arrive at those gates with evidence,
   not to blow through them.

## 🚀 Why it works so well

Two engineering choices do most of the lifting, and every `crg-*` workflow leans on both.

### The code-review-graph advantage, per workflow

An LLM's scarcest resource is attention. The graph converts "read half the repo to find the thing"
into one cheap query, so each agent's context window is spent on *judgment* instead of *search* —
and the graph is **re-ingested after every commit**, so later phases reason about the tree as it
actually is, not as it was when the run started.

| Workflow | What the graph buys it |
|---|---|
| `/crg-debug` | Scope resolution (`semantic_search` + `impact_radius`), hotspot maps (hubs, large functions, knowledge gaps), discovery via flows/callers instead of grep, and **blast-radius test selection** — the close gate runs only the tests that exercise touched files |
| `/crg-farm` | Per-bug complexity scoring: `impact_radius` per file feeds the recommended starting model tier, so cheap models get cheap bugs |
| `/crg-build` | Survey agents map the app from `architecture_overview` + hubs at minimal detail; wave gates scope regression tests via `tests_for` |
| `/crg-ralph` | The graph **compiles the plan**: `impact_radius` predicts each story's touch set (then an adversarial critic re-checks it), communities become lanes, hubs rank stories into the earliest waves, and overlapping radii force serialization |
| `/crg-ui` / `/crg-ui-prep` | Fix and proposal agents locate a component's source via `semantic_search` / `minimal_context` instead of scanning the frontend tree |
| `/crg-integrations` | The repair diagnosis (opus) walks the host-adapter seam, its callers, and the blast radius through graph queries at minimal detail |
| `/crg-agentsmd` | **The honest exception** — it mines the GitHub review record, not the graph. Its edge comes from the harness side: structural holdout + evidence-gated schemas |

### Context & harness engineering, per workflow

The second half is refusing to trust model output. Agents *claim*; gates *observe*; the **script
decides** — with pure, unit-tested JS helpers rendering every verdict. Shared machinery across the
family: `fence()` wraps every piece of repo/issue/Figma text as untrusted data (prompt-injection
neutralized at the interpolation site), commit messages are gate-checked (no AI attribution, ever),
committed files must be a subset of a declared allowlist, and model escalation ladders climb
strictly upward — one shot per tier, with the failed attempt's evidence carried into the next brief.

| Workflow | Signature harness mechanisms |
|---|---|
| `/crg-debug` | TDD RED→GREEN where an *independent* gate re-runs the test and the script reads the exit code; file-disjoint fix waves with fixed-point and thrash guards; allowlist-verified commits (strays auto-uncommitted) |
| `/crg-farm` | The candidate cap, tier ladder, security-channel decision, and draft-only PR rule are all literal JS, not prompts; a lossless append-only farm DB records every gate and wait |
| `/crg-build` | Blind command gates + a **serialized** browser gate (one shared Playwright, script-judged verdict); criterion polarity (assert the *built* behavior); tokens minted per session, never stored |
| `/crg-ralph` | Deterministic dependency-layered wave packer with cycle-breaking; prefix-aware fences; wave gates judge the **delta vs baseline** failures; porcelain accounting catches every stray edit |
| `/crg-ui` | The numeric oracle: a CLI computes every delta, and **FNV-1a seals** prove agents relayed its output verbatim (a paraphrased relay fails the checksum); node-matched verify judge; diff-tree post-commit check; porcelain baseline restore |
| `/crg-ui-prep` | Every scorecard status is tool-computed and sealed; approved diffs applied byte-exact inside a file fence; the final packet re-verifies against live files so stale prep can't sneak through |
| `/crg-integrations` | Deterministic matrix ingest (an agent once silently truncated 1400 rows to "all green" — never again); pixel stats can only *veto* drift, never confirm it; verify = exit 0 **and** ≥1 test actually ran |
| `/crg-agentsmd` | Miners physically cannot see the holdout (train-only files); every rule needs a verbatim evidence quote at the schema boundary; the A/B harness throws on workspace contamination |

The pattern compounds: the graph makes each agent cheap and precise, the harness makes each agent's
output verifiable, and the gates make the whole run auditable. That's why a weak model under the
deterministic harness holds a usable floor that prompt-only orchestration can't guarantee.

## 🔧 Requirements

- **Claude Code** — provides the skill / agent / MCP / Workflow runtime.
- **[`code-review-graph-codeblackwell`](https://pypi.org/project/code-review-graph-codeblackwell/)** —
  the graph engine, declared in `.mcp.json` as
  `uvx --from 'code-review-graph-codeblackwell>=2.4.0' code-review-graph serve`, so you need
  [`uv`](https://docs.astral.sh/uv/) on your `PATH`. It is a community fork of
  [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) (Tirth Kanani, MIT);
  the CLI and MCP tool names are unchanged.
- **Optional:** Docker (for `/crg-farm --env container` buildability provisioning), `gh` (for
  `/crg-farm` sourcing and `/crg-agentsmd` corpus fetch), the Figma + Playwright MCP servers (for
  `/crg-ui` and `/crg-ui-prep`).

## 📦 Install

```
/plugin marketplace add CodeBlackwell/crg-debug
/plugin install crg-debug
```

That gives you every command in **prose mode**: Claude's main loop orchestrates the methodology
directly. Works on every model tier. ✅

### 🎛️ Recommended: the deterministic enabler

Claude Code plugins cannot package Workflows, so a one-time enabler installs them:

```
crg-deterministic
```

This copies all eight JS Workflows, their methodologies, and the deterministic tool CLIs into
`~/.claude/workflows/` (idempotent — re-run it after plugin updates). Afterward every `crg-*`
command automatically prefers its Workflow; pass `--prose` to any command to force prose mode.
Watch live runs with `/workflows`. 📡

## 🧭 Prose vs deterministic mode

Both modes execute the same `methodology.md`; they differ in **who enforces it**.

| | 📝 Prose | 🔒 Deterministic |
|---|---|---|
| Enforcement | advisory — the model follows the protocol | in code — binds on any model |
| Cost / latency | one context, fast | many parallel agents, minutes |
| Coverage | one attention budget | parallel sweep, scales past one context |
| Best for | strong models; small or tightly-coupled code | weak models; large repos; auditable runs |

> **Rule of thumb:** prose gives you the model's native ceiling cheaply; deterministic buys a
> floor on any model at a token and wall-clock cost. In eval runs, a prose pass went from 0.33
> precision on a weak model to 1.00 on a strong one, while the deterministic Workflow held the weak
> model at a usable floor regardless of tier.

Two bundled agents cover a third shape — a **sequential single-context run** for orchestrators that
can't nest subagents: `crg-debugger` and `crg-ui-converger`.

## 🧰 The workflows

### 🐛 `/crg-debug` — find and fix real bugs

Builds/refreshes the graph, maps hotspots, fans out concern-disjoint discovery agents, and
adversarially verifies every candidate (one refuter + one reproducer; a finding survives only if
confirmed and never refuted). With fix mode (the default) it then repairs confirmed bugs in
**file-disjoint TDD waves** — RED observed before any edit, GREEN verified by an independent gate
whose exit code the script reads — committing each validated wave on a `crg-debug/fix-*` branch
(never pushed, never your branch) and re-ingesting the graph.

```
/crg-debug                       # full-repo sweep, detect + fix
/crg-debug src/auth              # scope to an area/file
/crg-debug --issue owner/repo#123  # symptom-directed sweep from a GitHub issue
/crg-debug --detect-only         # read-only: confirmed-bug ledger, no edits
/crg-debug --from-ledger .crg-debug/ledger.json   # fix-only over a prior ledger
/crg-debug --model haiku         # model for the run (default haiku)
/crg-debug --prose               # force prose orchestration
```

Deliverable: a severity-ranked ledger at `.crg-debug/ledger.json` plus fix commits to review and
merge (or ship with `/cpdv`).

### 🌾 `/crg-farm` — the bug-farming loop

Wraps `/crg-debug` in a sourcing loop over real open bugs. Direction decides sourcing: a repo name
gets a scoped `/xplore` sweep, free text runs a themed cross-repo GitHub search, no direction
wildcard-searches all of GitHub. Candidates are deduped, ranked by impact × review-likelihood,
triaged with detect-only runs, fixed with a strictly-upward model ladder (haiku→sonnet→opus, one
shot per tier, failures carried as evidence into the next tier), and staged as **draft PRs**.

```
/crg-farm                          # wildcard: search all of GitHub for open bugs
/crg-farm memory leaks in async rust cli tools   # themed cross-repo search
/crg-farm owner/repo               # scoped sweep of one repo
/crg-farm --issue owner/repo#123   # farm one reported issue
/crg-farm --auto                   # auto-pass soft gates; commit + submit still block
/crg-farm --auto-bypass            # unattended through commit + draft PR (top 3); submit stays human
/crg-farm --max-tier sonnet        # cap the escalation ladder
/crg-farm --env container|none     # per-repo cached Docker env, or host as-is
```

Three things distinguish it:

- **Buildability.** Before triage, `--env container` (the harness default) provisions a dedicated,
  fingerprint-cached Docker environment per repo, so baseline failures reflect the *code*, not a
  missing toolchain. Failures are classified `code` (→ a real bug) vs `env`; a repo that can't be
  made buildable is `unfarmable` and handed off cleanly — the verdict is remembered so future runs
  demote it before spending a slot.
- **Security routing.** A security-sensitive finding never flows silently into a public PR: a
  quick actually-run PoC, an exploit-path trace, and the repo's own SECURITY/CONTRIBUTING policy
  feed one deliberately asymmetric decision — a short human-voiced PR only when the fix is
  mechanical, marginal risk is small, *and* policy allows it; otherwise a concise, disk-only
  advisory report that is **never transmitted**. Disclosure stays your call, always.
- **The audit trail.** Every run, candidate, gate ask, decision, fix attempt, and PR is appended to
  `~/.claude/crg-farm/history.jsonl` (losslessly compacted, never deleted) for cross-run dedup.

`GATE-DIFF` (working tree → commit) and `GATE-SUBMIT` (draft → ready) are hard stops that `--auto`
never crosses. `--auto-bypass` runs unattended through commit and an opened **draft** PR — but no
flag, ever, flips a draft to ready-for-review. That last click is yours.

### 🧱 `/crg-build` — launch-readiness campaigns

Points the engine at *shipping an app* rather than debugging it. Operates on a multi-subrepo
umbrella app: an optional first-run `/crg-debug` stabilize pass, then repeated campaign loops of
**SURVEY** (dimension-disjoint agents grade `stability, completeness, consistency, polish,
reachability, docs, launch-blockers` against the live, booted app) → **GATE-SPEC** (you pick the
buildable subset; launch-blockers are never auto-recommended) → **BUILD** (dependency-ordered,
file-disjoint waves; every acceptance criterion asserts the *corrected* behavior and must fail
before the build and pass after) → **UX-REVIEW** (two scorers + merge).

```
/crg-build                        # full campaign on the current app
/crg-build --dimensions polish,docs   # narrow the survey
/crg-build --skip-stabilize       # skip the first-run crg-debug pass
/crg-build --headed               # add a qualitative in-browser UX pass
/crg-build --auto-bypass          # compute GATE-SPEC; profile + stabilize gates still block
/crg-build --max-waves 6 --model haiku --prose
```

The skill owns daemons (the Workflow never starts or stops a server) and auth tokens are minted
fresh per session — never stored, never embedded in criteria. Commits land per subrepo, per green
wave; never pushed.

### 🪖 `/crg-ralph` — graph-compiled feature armies

The constructive sibling of `/crg-debug`: instead of finding bugs, it **plans and builds a
feature** as dependency-layered waves of parallel lane agents. In feature mode it decomposes your
request into Army-sized stories; in PRD-ingest mode it reads an existing hand-authored
Army-of-Ralph PRD dir (`PRD.md` + `agents/`) verbatim — and in both, every story's
predicted touch set is attacked by an adversarial critic, then packed by deterministic JS into
fence-disjoint waves (graph communities become lanes, hub-touching stories build first, overlapping
blast radii serialize).

```
/crg-ralph add rate limiting to the API           # feature mode: decompose → plan → build
/crg-ralph PRDs/32-forex-phase1                   # ingest an existing Army PRD dir
/crg-ralph <input> --plan-only                    # stop at GATE-PLAN; emit the Army PRD dir
/crg-ralph --from-plan .crg-ralph/plan.json --stories US-001,US-003   # cross-session build entry
/crg-ralph <input> --max-tier sonnet --max-waves 8 --prose
```

GATE-PLAN is a hard human gate showing waves × lanes, forced serializations, broken cycles, and
baseline failures. BUILD runs blind exit-code criteria gates, a strictly-upward model ladder with
evidence-carrying escalation, JS-enforced prefix fences, and porcelain accounting — then a scoped
`/crg-debug` sweep over the run's own diff closes the loop. Feature mode also emits a standard Army
PRD dir the `ralph` CLI can run unchanged, so the planner is useful even without the builder.

### 🎨 `/crg-ui` — converge the UI to its Figma design

The Figma file is the oracle, the live app is the subject, and a deterministic measure tool is the
judge. MEASURE captures each screen × breakpoint cell — Figma frame geometry + variables
(transcribed verbatim), live DOM via a shipped collector script (one shared browser, strictly
sequential) — and the tool computes every geometry/token/typography delta, assembling a keyed,
ranked discrepancy ledger. **An agent never eyeballs a screenshot or does coordinate math**; every
relay is checksum-sealed, so a mangled transcription fails loudly instead of lying quietly.

```
/crg-ui https://figma.com/design/<key>/...        # measure + gated repair
/crg-ui <figma-url> path/to/repo --measure-only   # read-only ranked ledger
/crg-ui --from-ledger .crg-ui/ledger.json --ids d-001,d-004   # cross-session repair
/crg-ui <figma-url> --max-tier sonnet --model haiku --prose
```

GATE-LEDGER approves fixes or blesses items as intentional deviations (persisted and filtered
forever after — never re-litigated). REPAIR groups approved items into containment units (a missing
container absorbs its children — one root cause, one fix, one verify), routes each through a
class-based model ladder, verifies by **re-capturing and re-measuring the exact cells** with a
node-matched judge (breaking a neighbor is a red), post-verifies every commit's diff-tree against
the fence, and restores the tree to its porcelain baseline after red units. Commits on
`crg-ui/fix-*`; never pushed. No Figma file → a bootstrap gate, never a guessed oracle.

### 🧰 `/crg-ui-prep` — become the perfect `/crg-ui` user

Walks you gap-by-gap to the "Story 9" user in `docs/crg-ui/perfect-user.md` — the one whose
`/crg-ui` run opens with **zero questions**. It audits the Figma file, repo, and environment
against the full checklist (every status computed by `lib/ui-prep.mjs`, sealed), then closes gaps
in dependency-sorted leverage order: Figma-side assets via the figma MCP (frame renames, variable
binding, componentization), repo-side assets as approved diffs (`data-component` codemod, render
seams), environment items as verified guide steps. Every item gets the same three-door gate —
*supply it / let me apply it / descope it explicitly* — and every answer persists.

```
/crg-ui-prep https://figma.com/design/<key>/...   # full audit → gated gap loop → draft profile → packet
/crg-ui-prep <figma-url> --audit-only             # just the sealed scorecard
/crg-ui-prep <figma-url> --top5                   # five highest-leverage items (+ deps)
```

Deliverable: a validated draft `.crg-ui/profile.json` plus a sealed `.crg-ui/prep-packet.json`.
`/crg-ui`'s Stage 0 verifies the packet by exit code against the **live** files — a green packet
skips intake entirely; a stale or hand-edited one fails the seal and falls back to the normal gate.

### 🧩 `/crg-integrations` — triage & repair an integration matrix

For projects whose test surface is a **host × scenario matrix** (a docs widget, SDK, or embed run
against many host frameworks). TRIAGE (read-only) ingests the red cells with a deterministic tool,
retries away flakes, clusters by normalized failure signature, and classifies each cluster
`regression | drift | under-dev | flake` — a JS prefilter first, a model only for the residue, and
an unclassifiable cluster defaults conservatively to regression.

```
/crg-integrations                                   # triage, stop at GATE-CLUSTERS
/crg-integrations path/to/repo --triage-only        # read-only triage ledger
/crg-integrations --from-ledger <path> --clusters cl-001,cl-004   # repair approved clusters
/crg-integrations --from-matrix results.json --no-regen           # triage an existing matrix
```

Screenshot failures pass through a calibrated **pixel-stat drift veto** (71 real drift golden
pairs showed drift and small-element regressions are numerically inseparable — so the numbers only
ever rule drift *out*; only a vision agent may confirm it), because a regression misread as drift
silently corrupts the golden oracle. Drift is **never auto-re-baked**: the exact
`--update-snapshots` command is emitted into a human-gated queue. REPAIR (approved regression
clusters only) diagnoses against the graph, fixes inside per-host fenced worktrees (shared-file
fixes are `needs-human`, never auto-edited), verifies by re-running the exact cell — exit 0 **and**
at least one test actually ran — and gates the run branch against new reds. Never pushes. Projects
with a different runner supply a one-line `matrixAdapter` convert command; everything downstream is
identical.

### 📜 `/crg-agentsmd` — mine a measured AGENTS.md

An instrument, not a generator. It mines a repo's review fossil record — PR review threads, diff
evolution, git archaeology — for the tacit rules maintainers actually enforce, adversarially
verifies every rule (counterexample hunt in the live tree, fabricated-evidence check, restatement
detection, command executability), then **scores survivors against a held-out slice of real review
corrections the miners never saw**. Rules no correction credits are cut; the draft is ordered by
measured predictive value and written beside its evidence ledger — never committed, never posted.

```
/crg-agentsmd                      # current repo: mine → verify → score → draft
/crg-agentsmd path/to/repo         # explicit repo
/crg-agentsmd --mine-only          # stop at the verified rules ledger
/crg-agentsmd --score-only         # re-score an existing ledger
/crg-agentsmd --score-sample 60    # judge a stride sample of the holdout (cheap iteration)
/crg-agentsmd --ab                 # three-arm implementation A/B (expensive; asks first)
```

Honest calibration (pilot: NixOS/nix-security-tracker, 749 PRs, 183 held-out comments): the mined
draft preempted **24%** of held-out corrections vs **12%** for a length-matched generic placebo —
the gap is exactly the repo-specific rules nobody could guess. A 3-PR implementation A/B showed
**no lift over placebo**: this documents measured reviewer norms; it is not demonstrated to make
agents build better code. Repos under ~30 reviewed PRs return `thin-corpus`, not a padded guess.

## 🔒 The safety model

Constant across the whole family:

- **Never pushes.** Fixes land on dedicated local branches (`crg-debug/fix-*`, `crg-ui/fix-*`,
  `crg-integrations/fix-*`, `crg-ralph/build-*`) off your current HEAD — review, then merge.
- **Never past draft.** `/crg-farm` opens PRs as drafts; no flag flips one to ready-for-review.
- **Never discloses.** Security advisories are written to local disk only; filing them is yours.
- **Never re-bakes an oracle.** Golden snapshots and Figma deviations change only by explicit
  human approval, and blessed decisions persist so they're never re-litigated.
- **No AI attribution.** Commit messages are gate-checked against any Claude/Anthropic/co-author
  trailer, in code.
- **Untrusted by default.** Issue bodies, repo source, and design payloads are fenced as data —
  a prompt injection in a README being audited can't steer the run.

## 📁 Repo layout

```
.claude-plugin/           plugin manifest + self-hosted marketplace catalog
.mcp.json                 declares the code-review-graph MCP server (uvx)
bin/crg-deterministic     the enabler: installs Workflows + tools into ~/.claude/workflows/
skills/<name>/SKILL.md    each command's entry point — flags, gates, prose-vs-workflow routing
skills/<name>/methodology.md   the single source of truth both modes execute
workflows/*.js            the deterministic JS Workflows (one per command, + farm-bypass harness)
agents/                   crg-debugger + crg-ui-converger (sequential single-context variants)
lib/                      deterministic tool cores, all unit-tested:
  ui-measure.mjs            the crg-ui numeric oracle (normalize / measure / assemble / slice)
  ui-collect.js             browser-side DOM collector (evaluated verbatim, never re-derived)
  ui-map.mjs                crg-ui profile validator + Figma frame pairing + waitup + bless
  ui-prep.mjs               crg-ui-prep audits, sealed scorecard, item verify, ready packet
  ralph-plan.mjs            crg-ralph plan/profile validator + Army PRD renderer
  build-profile.mjs         crg-build profile validator + autoApprove + UX scoring
  integrations-profile.mjs  matrix-profile validator (placeholders, fences, drift knobs)
  integrations-ingest.mjs   deterministic matrix ingest (red-cell grouping, anti-truncation)
  corpus.mjs                crg-agentsmd review-corpus fetcher + stratified holdout splitter
  agentsmd-score.mjs        retrodictive holdout scorer
  agentsmd-ab.mjs           contamination-clean three-arm A/B harness
  ledger-slice.mjs          narrow a bug ledger to a subset (triage + escalation)
  issue-ref.mjs             GitHub issue-ref + remote parsing
  farm-db.mjs               append-only farm/campaign history with lossless compaction
docs/crg-ui/, docs/crg-ralph/   design docs (perfect-user stories, army-compilation design)
test/                     node --test suite over every pure helper and tool CLI
```

## 🧪 Testing

```
node --test        # 225 tests across 20 files, ~3s
```

Every Workflow keeps its pure logic in a marked `pure-helpers` block that tests eval-extract and
exercise directly — the tested code *is* the shipped code. The one skipped test is a live Docker
provisioning check that only runs when Docker is up.

## 📄 License

MIT — see [LICENSE](LICENSE). Depends on code-review-graph (MIT, © Tirth Kanani).
