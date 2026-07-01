# 🐛 crg-debug

**Graph-driven parallel debugging for [Claude Code](https://claude.com/claude-code).**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.4.0-informational)](CHANGELOG.md)

`/crg-debug` builds a code knowledge graph 🕸️, fans out concern-disjoint discovery agents over it,
adversarially verifies every candidate 🔍, then fixes confirmed bugs in test-first waves over
file-disjoint sets. It applies fixes to the working tree and **never commits**.

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

The run ends with a severity-ranked bug ledger 📋 and a timestamped report at the repo root. Nothing
is committed — review the diff, then ask to commit (named files only) or run `/cpdv`.

### 🌾 `/crg-farm` — the bug-farming loop

`/crg-farm` wraps `/crg-debug` in a repeatable loop that sources real open bugs, triages them
cheaply, escalates the model only where repair struggles, and ships draft PRs — pausing for your
approval at every boundary that matters.

```
/crg-farm                        # source + triage + fix bugs in this repo, interactive
/crg-farm --issue owner/repo#123 # farm a specific reported issue
/crg-farm --auto                 # auto-pass soft gates; still HARD-stops at commit + PR submit
/crg-farm --max-tier sonnet      # cap model escalation below opus
```

RECON (`/xplore`) → **GATE-RECON** → triage (`--detect-only`) → **GATE-TRIAGE** → fix
(`--from-ledger`, escalating haiku→sonnet→opus over only the unfixed bugs) → **GATE-ESCALATE** →
**GATE-DIFF** → PR-prep → **GATE-SUBMIT**. `GATE-DIFF` (working-tree→commit) and `GATE-SUBMIT`
(fork→upstream) always block for an explicit human "yes" — `--auto` never bypasses them. Every run,
candidate, gate decision, fix attempt, and PR is recorded to `~/.claude/crg-farm/history.jsonl` for
cross-run dedup and audit.

## 🗂️ Layout

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   self-hosted marketplace catalog
skills/crg-debug/SKILL.md         /crg-debug entry — routes prose vs deterministic
skills/crg-debug/methodology.md   single source of truth (phases + judgment rules)
skills/crg-farm/SKILL.md          /crg-farm entry — the bug-farming loop orchestrator
skills/crg-farm/methodology.md    Named-Gate Protocol + escalation + PR-prep + farm-DB shapes
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
