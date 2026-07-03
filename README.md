# 🐛 crg-debug

**Graph-driven parallel debugging for [Claude Code](https://claude.com/claude-code).**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.16.0-informational)](CHANGELOG.md)

`/crg-debug` builds a code knowledge graph 🕸️, fans out concern-disjoint discovery agents over it,
adversarially verifies every candidate 🔍, then fixes confirmed bugs in test-first waves over
file-disjoint sets. Each validated wave is committed on a `crg-debug/fix-*` branch off the current
HEAD (only that wave's own files, allowlist-verified) and the graph re-ingested — **never pushed**,
and never committed to your own branch.

`/crg-farm` 🌾 wraps that engine in a bug-farming loop: it sources real open bugs — a named repo
gets a scoped `/xplore` sweep, a topic runs a themed cross-repo GitHub search, and no direction at
all wildcard-searches all of GitHub — verifies none are already fixed or in-flight upstream,
triages them, escalates the model only where repair struggles, and ships **draft PRs**, pausing for
your approval at every consequential boundary (commit and upstream submit are always hard stops).
See **Usage** below.

---

## ⚙️ Requirements

- **Claude Code** — provides the skill/agent/MCP runtime.
- **[`code-review-graph-codeblackwell`](https://pypi.org/project/code-review-graph-codeblackwell/)** —
  the graph engine, exposed to Claude as an MCP server. This plugin declares it in `.mcp.json` as
  `uvx --from code-review-graph-codeblackwell code-review-graph serve`, so you need
  [`uv`](https://docs.astral.sh/uv/) on your `PATH`. It is a community fork of
  [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) (Tirth Kanani, MIT),
  maintained so fixes ship without waiting on upstream review. The CLI command and MCP tools are still
  named `code-review-graph`, so the methodology and tool references are unchanged.

## 📦 Install

```
/plugin marketplace add CodeBlackwell/crg-debug
/plugin install crg-debug
```

That gives you `/crg-debug` in **prose mode**: Claude's main loop orchestrates the methodology,
dispatching parallel `Agent` waves per phase. Works on every model tier. ✅

### 🎛️ Optional: deterministic mode

Prose orchestration relies on the model following the protocol. For the strongest guarantees, upgrade
to the **deterministic JS Workflow**, where the script — not the model — owns phase order, wave
packing, loop termination, and the per-bug close gates (it reads real exit codes). Claude Code plugins
cannot package workflows, so a one-time enabler installs it:

```
crg-deterministic
```

This copies the bundled workflow and its methodology into `~/.claude/workflows/`. Afterward
`/crg-debug` automatically prefers the Workflow; pass `--prose` to force prose mode. Watch a live run
with `/workflows`. 📡

## 🧭 Choosing a mode

Both modes run the same `methodology.md`; they differ in **who enforces it**. In prose mode the model
follows the protocol, so compliance tracks model strength. In deterministic mode the script owns phase
order, verification, and the per-bug close gates, so the floor holds on any model.

| | 📝 Prose | 🔒 Deterministic |
|---|---|---|
| Enforcement | advisory — model may skip phases | in code — binds on any model |
| Cost / latency | one context, fast | many parallel agents, minutes |
| Coverage | one attention budget | parallel sweep, scales past one context |
| Best for | strong models; small or tightly-coupled code | weak models; large multi-file repos; auditable runs |

> **Rule of thumb:** prose gives you the model's native ceiling cheaply; deterministic buys a floor on
> a weak model at a token and wall-clock cost.

Eval runs bear this out: on one repo a prose pass went from 0.33 precision on a weak model to 1.00 on a
strong one, while the deterministic Workflow held the weak model at a usable floor regardless of tier.
Shape matters too — breadth (many independent bugs across files) favors the Workflow's parallel
discovery; depth (a few interacting bugs in one place) can favor prose's single-context reasoning.

## 🚀 Usage

```
/crg-debug                       # full-repo sweep, detect + fix
/crg-debug src/auth              # scope to an area/file/issue
/crg-debug --detect-only         # read-only: confirmed bug ledger, no edits
/crg-debug --model haiku         # override the model for the run
/crg-debug --prose               # force prose orchestration even if the Workflow is installed
```

The run ends with a severity-ranked bug ledger 📋 and a timestamped report at the repo root. Fix
waves land as commits on a `crg-debug/fix-*` branch (never pushed) — review them, then merge or run
`/cpdv`. Pass `commit: false` (Workflow arg) for the legacy working-tree-only mode.

### 🌾 `/crg-farm` — the bug-farming loop

`/crg-farm` wraps `/crg-debug` in a repeatable loop that sources real open bugs, triages them
cheaply, escalates the model only where repair struggles, and ships draft PRs — pausing for your
approval at every boundary that matters. It never assumes "the current repo" — what it sources
depends on the direction you give it:

```
/crg-farm                          # no direction: wildcard-search all of GitHub for open bugs (gh search issues)
/crg-farm memory leaks in async rust cli tools   # topic: themed cross-repo GitHub search
/crg-farm owner/repo               # scoped: /xplore sweep of that one repo
/crg-farm --issue owner/repo#123   # scoped: farm a specific reported issue
/crg-farm --auto                   # auto-pass soft gates; still HARD-stops at commit + PR submit
/crg-farm --auto-bypass            # fully unattended through commit + a draft PR, top-3 candidates; GATE-SUBMIT stays human
/crg-farm --max-tier sonnet        # cap model escalation below opus
/crg-farm --env container          # provision a dedicated cached Docker env per repo (default under the harness)
/crg-farm --env none               # skip provisioning; baseline against the host as-is (no Docker)
```

RECON (scoped `/xplore`, or a themed/wildcard `gh search issues`) → dedup → rank candidates by
impact × review-likelihood (stars, issue severity, merge cadence) → **GATE-RECON** → triage
(`--detect-only`) → **GATE-TRIAGE** → fix (`--from-ledger`, escalating haiku→sonnet→opus over only
the unfixed bugs) → **GATE-ESCALATE** → **GATE-DIFF** → PR-prep → **GATE-SUBMIT**. `GATE-DIFF`
(working-tree→commit) and `GATE-SUBMIT` (fork→upstream) always block for an explicit human "yes" —
`--auto` never bypasses them. Every candidate repo is cloned/synced into a persistent cache at
`~/.claude/crg-farm/repos/<owner>/<repo>`, and every run, candidate, gate decision, fix attempt, and
PR is recorded to `~/.claude/crg-farm/history.jsonl` for cross-run dedup and audit.

`--auto-bypass` is a **separate flag from `--auto`**, never implied by it: it auto-passes every
gate through commit (`GATE-DIFF`), so a run goes end-to-end unattended — top 3 ranked candidates,
fixed concurrently (capped at 3 in-flight), committed, and opened as **draft** PRs, ending in a
report of what opened. It never touches `GATE-SUBMIT` — nothing is ever flipped to
ready-for-review automatically, no matter what flags were passed; a human still has to submit each
draft. On a regression, escalation climbs to the next, strictly higher tier — never a retry of the
tier that just failed, every tier gets exactly one shot — so a `haiku` start can climb through two
regressions before running out of ladder; a regression at `maxTier` itself is dropped from PR-prep
and handed to a human instead of being committed. Prefers a code-enforced harness Workflow
(`workflows/crg-debug.farm-bypass.js`, installed by `crg-deterministic`) when available — `--prose`
forces the prompt-driven path instead. See `skills/crg-farm/methodology.md` §Auto-bypass mode
before using it.

**Buildability (`--env`).** Before triaging a candidate, the harness makes its repo genuinely
buildable so the baseline reflects the *code*, not a missing toolchain. `--env container` (the
default) provisions a **dedicated, cached Docker environment per repo** — a slim base image,
hand-installed system deps, language deps in a persistent named volume, source bind-mounted, and
every build/typecheck/test command run inside it. The image is fingerprinted by the repo's
manifests and reused as-is unless deps change, so an env is built once per repo, not once per run.
Each baseline failure is then classified **`code`** (a real source defect → seeded as a bug) or
**`env`** (a missing tool/dep/system library, or a build not applicable to the project); a repo that
can't be made buildable is **`unfarmable`** and hands off cleanly rather than being mistaken for a
bug. `--env none` (the standalone `/crg-debug` default) skips provisioning entirely. See
`skills/crg-farm/methodology.md` §Environment provisioning.

A bug flagged security-sensitive (injection, auth bypass, secrets exposure, SSRF/traversal,
insecure deserialization, crypto misuse, memory-safety) never enters that pipeline silently —
**`GATE-SECURITY-ROUTE`** diverts it to the advisory track instead: a quick, actually-run PoC, a
hop-by-hop exploit-path trace, and a check of the target repo's own `CONTRIBUTING.md`/`SECURITY.md`,
then **`GATE-DISPATCH-CHANNEL`** picks the channel from what that evidence actually showed — a
short, human-voiced PR (`pr-with-motivation`) when the fix is mechanical, the marginal risk beyond
the bug's own precondition is genuinely small, and the repo's own policy doesn't demand private
reporting, or a short, conservatively-worded, disk-only report (`advisory-report`, gated by
**`GATE-ADVISORY-REVIEW`**, never transmitted) the moment any of that isn't true. This exists
because a live run once escalated a one-line-fixable bug into a multi-page formal report a
maintainer rightly rejected as disproportionate — most security-sensitive bugs are worth fixing
exactly like any other bug, just with the channel decided first, deliberately biased toward the
safe fallback whenever anything is ambiguous. Whichever channel is chosen, this tool never files,
emails, or discloses anything on your behalf under any option — disclosure stays your call, and no
flag ever crosses `GATE-SUBMIT` unattended. `--auto-bypass`'s harness runs this whole check itself,
unattended, using the same conservative computed default — a mechanical PR still only ever opens as
a **draft**, same as any other bug. See `skills/crg-farm/methodology.md` §Security classification &
the advisory track.

### 📜 `/crg-agentsmd` — mine a measured AGENTS.md

An instrument, not a generator: it mines a repo's review fossil record (PR review threads, diff
evolution, git archaeology) for the tacit rules maintainers actually enforce, adversarially
verifies every rule (counterexample hunt, restatement detection, executability), then **scores the
survivors against a held-out slice of real review corrections** the miners never saw. Rules no
held-out correction credits are cut; the draft is ordered by measured predictive value and written
beside its evidence ledger — never committed, never posted.

```
/crg-agentsmd                      # current repo: mine -> verify -> score -> draft
/crg-agentsmd path/to/repo         # explicit repo
/crg-agentsmd --mine-only          # stop at the verified rules ledger
/crg-agentsmd --score-only         # re-score an existing ledger (skip mining)
/crg-agentsmd --score-sample 60    # judge a stride sample of the holdout (cheap iteration)
/crg-agentsmd --ab                 # add the three-arm implementation A/B (expensive; asks first)
```

Honest calibration from the pilot (NixOS/nix-security-tracker, 749 PRs, 183 held-out comments):
the mined draft would have preempted **24%** of held-out review corrections vs **12%** for a
length-matched generic placebo — the difference is exactly the repo-specific rules nobody could
guess from one file. A 3-PR implementation A/B showed **no lift over placebo**: this documents
measured reviewer norms; it is not demonstrated to make agents build better code. Repos with fewer
than ~30 reviewed PRs return `thin-corpus` instead of a padded guess.

## 🗂️ Layout

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   self-hosted marketplace catalog
skills/crg-debug/SKILL.md         /crg-debug entry — routes prose vs deterministic
skills/crg-debug/methodology.md   single source of truth (phases + judgment rules)
skills/crg-farm/SKILL.md          /crg-farm entry — the bug-farming loop orchestrator
skills/crg-farm/methodology.md    Named-Gate Protocol + escalation + PR-prep + farm-DB shapes
skills/crg-agentsmd/SKILL.md      /crg-agentsmd entry — measured AGENTS.md mining
skills/crg-agentsmd/methodology.md  miner discipline + verification attacks + holdout scoring
lib/corpus.mjs                    review-corpus fetcher, holdout splitter, ledger assembler
lib/agentsmd-score.mjs            retrodictive holdout scorer (deterministic)
lib/agentsmd-ab.mjs               three-arm A/B harness CLIs (contamination-clean workspaces)
workflows/crg-agentsmd.js         deterministic AGENTS.md Workflow (installed by the enabler)
agents/crg-debugger.md            sequential single-context variant
lib/ledger-slice.mjs              narrow a ledger to a bug subset (triage + escalation)
lib/farm-db.mjs                   global append-only farm history (JSONL)
.mcp.json                         declares the code-review-graph MCP server
workflows/crg-debug.js            deterministic Workflow (installed by the enabler)
bin/crg-deterministic             installs the Workflow + helpers into ~/.claude/workflows/
```

Both orchestrators read the same `methodology.md`; the only difference is who owns control flow — the
model (prose) or the script (deterministic).

## 📄 License

MIT — see [LICENSE](LICENSE). Depends on code-review-graph (MIT, © Tirth Kanani).
