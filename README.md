# crg-debug

Graph-driven parallel debugging for [Claude Code](https://claude.com/claude-code).

`/crg-debug` builds a code knowledge graph, fans out concern-disjoint discovery agents over it,
adversarially verifies every candidate, then fixes confirmed bugs in test-first waves over
file-disjoint sets. It applies fixes to the working tree and **never commits**.

## Requirements

- **Claude Code** (provides the skill/agent/MCP runtime).
- **[`code-review-graph-codeblackwell`](https://pypi.org/project/code-review-graph-codeblackwell/)** —
  the graph engine, exposed to Claude as an MCP server. This plugin declares it in `.mcp.json` as
  `uvx --from code-review-graph-codeblackwell code-review-graph serve`, so you need
  [`uv`](https://docs.astral.sh/uv/) on your PATH. It is a community fork of
  [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) (Tirth Kanani, MIT),
  maintained so fixes ship without waiting on upstream review. The CLI command and MCP tools are still
  named `code-review-graph`, so the methodology and tool references are unchanged.

## Install

```
/plugin marketplace add CodeBlackwell/crg-debug
/plugin install crg-debug
```

That gives you `/crg-debug` in **prose mode**: Claude's main loop orchestrates the methodology,
dispatching parallel `Agent` waves per phase. Works on every model tier.

### Optional: deterministic mode

Prose orchestration relies on the model following the protocol. For the strongest guarantees, upgrade
to the **deterministic JS Workflow**, where the script — not the model — owns phase order, wave
packing, loop termination, and the per-bug close gates (it reads real exit codes). Claude Code plugins
cannot package workflows, so a one-time enabler installs it:

```
crg-deterministic
```

This copies the bundled workflow and its methodology into `~/.claude/workflows/`. Afterward
`/crg-debug` automatically prefers the Workflow; pass `--prose` to force prose mode. Watch a live run
with `/workflows`.

## Usage

```
/crg-debug                       # full-repo sweep, detect + fix
/crg-debug src/auth              # scope to an area/file/issue
/crg-debug --detect-only         # read-only: confirmed bug ledger, no edits
/crg-debug --model haiku         # override the model for the run
/crg-debug --prose               # force prose orchestration even if the Workflow is installed
```

The run ends with a severity-ranked bug ledger and a timestamped report at the repo root. Nothing is
committed — review the diff, then ask to commit (named files only) or run `/cpdv`.

## Layout

```
.claude-plugin/plugin.json        plugin manifest
.claude-plugin/marketplace.json   self-hosted marketplace catalog
skills/crg-debug/SKILL.md         /crg-debug entry — routes prose vs deterministic
skills/crg-debug/methodology.md   single source of truth (phases + judgment rules)
agents/crg-debugger.md            sequential single-context variant
.mcp.json                         declares the code-review-graph MCP server
workflows/crg-debug.js            deterministic Workflow (installed by the enabler)
bin/crg-deterministic             installs the Workflow into ~/.claude/workflows/
```

Both orchestrators read the same `methodology.md`; the only difference is who owns control flow — the
model (prose) or the script (deterministic).

## License

MIT — see [LICENSE](LICENSE). Depends on code-review-graph (MIT, © Tirth Kanani).
