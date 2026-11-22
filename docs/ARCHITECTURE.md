# Architecture

The anatomy of the `crg-debug` plugin, for an engineer reading it for the first time.
[README.md](../README.md) covers what the commands do for a user; [CLAUDE.md](../CLAUDE.md)
covers the invariants and why each exists. This file covers how the pieces fit.

This repo has no application runtime. It is a Claude Code plugin whose "code" is three kinds
of text: prompts (Markdown), orchestration scripts (JS run inside Claude Code's Workflow
sandbox), and plain Node CLIs. It has zero npm dependencies.

## The stack

| Layer | Where | Size | What it is |
|---|---|---|---|
| Plugin manifest | [.claude-plugin/plugin.json](../.claude-plugin/plugin.json), [.mcp.json](../.mcp.json) | tiny | Version source of truth; declares the `code-review-graph` MCP server (launched via `uvx`) |
| Skills | `skills/<cmd>/SKILL.md` | 8 files | Slash-command entry points, run by the main Claude session |
| Methodologies | `skills/<cmd>/methodology.md` | 7 files, plus one checklist | The judgment rules, written once and read by every execution mode |
| Workflows | `workflows/*.js` | 8 files, ~6,700 lines | Deterministic orchestration scripts |
| Tool cores | `lib/*.mjs` | 24 files, ~2,500 lines | Node CLIs that compute every number, status and seal |
| Agents | `agents/*.md` | 2 files | Single-context, sequential variants for callers that cannot fan out |
| Tests | `test/*.test.mjs` | 32 files | `node --test`, no test framework |
| Enabler | [bin/crg-deterministic](../bin/crg-deterministic) | 70 lines of bash | Copies workflows, libs and methodologies flat into `~/.claude/workflows/` |

## How one command is wired

```
user types /crg-debug
      │
      ▼
SKILL.md  (main session: has filesystem, gh, AskUserQuestion)
  parses flags, fetches the issue, owns every human gate
      │  Workflow({name, args})        or --prose: execute methodology.md itself
      ▼
workflows/crg-debug.js  (sandbox: no fs, no imports, no clock, no randomness)
  owns phase order, partitioning, dedup, wave packing, every pass/fail
      │  agent(prompt, {schema, model})        parallel([...])
      ▼
sub-agents  (have tools: shell, git, the graph MCP, lib CLIs)
  read methodology.md, do the work, return schema-shaped JSON
      │
      ▼
code-review-graph MCP  +  lib/*.mjs CLIs  +  the target repo
```

The sandbox limits explain most of the design. The script cannot read a file, so an agent
reads the ledger and returns it. It cannot ask a human, so gates live in the skill. It cannot
import, so shared helpers are copied into each workflow.

The runtime injects a small set of globals into a workflow script: `args`, `agent()`,
`parallel()`, `pipeline()`, `phase()`, `workflow()` and `log()`. Everything else a script
uses is declared in the script.

## A run of `/crg-debug`, phase by phase

All in [workflows/crg-debug.js](../workflows/crg-debug.js):

1. **Graph**: one agent builds the graph, discovers build/test commands and runs a baseline.
   Failures are classified `code` (a bug) or `env` (not a bug).
2. **Map**: one agent tags every in-scope file with one of six concerns. The script
   partitions by concern.
3. **Discover**: one finder per concern plus a residual finder, in parallel. The script
   dedups by `file::rootCause`; an agent then clusters same-bug-different-wording.
4. **Verify**: two reviewers per finding, one trying to refute and one trying to reproduce.
   The script applies the survivor rule and writes the ledger to `.crg-debug/ledger.json`.
5. **Fix**: one agent per file writes a failing test first, then the fix. A separate gate
   agent re-runs each test and reports raw exit codes. The script closes the bug, commits
   only allowlisted files on a `crg-debug/fix-*` branch, and never pushes.

## The paradigms

- **Agents claim, the script decides.** Agents return `{command, exitCode}` rows;
  `allGreen()` in JS is the only thing that says "passed"
  ([crg-debug.js](../workflows/crg-debug.js#L58)).
- **Every agent reply is schema-shaped.** Each `agent()` call carries a JSON schema, so the
  script reads fields, not prose.
- **A dead agent is not a passing agent.** `agent()` can return `null` or throw; `tryAgent`
  turns both into `null`, and each call site handles it
  ([crg-debug.js](../workflows/crg-debug.js#L445)). `crg-ui` names its wrapper `safeAgent`.
- **Untrusted text is fenced.** Repo source, issue bodies and one agent's output passed to
  another go through `fence()`, which wraps it in `<<<UNTRUSTED … UNTRUSTED>>>`
  ([crg-debug.js](../workflows/crg-debug.js#L19)).
- **Copies kept honest by tests.** The shared prelude (`fence`, `capText`, `tryAgent`,
  `GATE_SCHEMA` and others) is duplicated across workflows;
  [test/workflow-structure.test.mjs](../test/workflow-structure.test.mjs) asserts the copies
  are byte-identical.
- **The tested code is the shipped code.** Each workflow's pure logic sits between
  `// >>> pure-helpers` and `// <<< pure-helpers`. Tests slice that block out of the file
  and eval it ([test/helpers.test.mjs](../test/helpers.test.mjs#L10)).
- **Seals catch mangled relays.** When tool output travels through an agent, the tool emits
  a checksum and the script recomputes it ([lib/crg-ui.seal.mjs](../lib/crg-ui.seal.mjs)).
- **Ledgers are the hand-off.** Detection writes a JSON ledger; a human or another run picks
  a subset; repair takes it back as inline args.
- **Workflows compose.** [crg-debug.farm-bypass.js](../workflows/crg-debug.farm-bypass.js)
  calls `workflow()` to run `crg-debug` as a nested step.

## The eight commands

| Command | What it does | Workflow phases |
|---|---|---|
| `/crg-debug` | Find, verify and fix bugs | Graph, Map, Discover, Verify, Fix |
| `/crg-farm` | Source real open bugs, fix them, open draft PRs | Recon, Triage, Advisory, Fix, PR (workflow used only with `--auto-bypass`) |
| `/crg-build` | Survey readiness gaps and build the approved ones | Verify-Env, Map, Survey, Verify, Build |
| `/crg-ralph` | Compile a PRD into a graph-planned build | Graph, Plan, Build |
| `/crg-ui` | Measure a live app against Figma, then repair | Profile+Graph, Variables, Capture, Measure, then Fix, Verify, Commit |
| `/crg-ui-prep` | Audit and prepare a repo for `/crg-ui` | Audit, Scorecard, Propose, Apply, Verify, Packet |
| `/crg-integrations` | Triage and repair a red test matrix | Six triage phases, then five repair phases |
| `/crg-agentsmd` | Mine a repo's review history into an AGENTS.md | Corpus, Plan, Mine, Merge, Verify, Score, Compress, AB |

## Reading order

1. [skills/crg-debug/SKILL.md](../skills/crg-debug/SKILL.md) (90 lines) for the entry point.
2. [workflows/crg-debug.js](../workflows/crg-debug.js) top to bottom: helpers, schemas, then
   the phases.
3. [test/workflow-structure.test.mjs](../test/workflow-structure.test.mjs) for the
   cross-workflow rules.
4. [CLAUDE.md](../CLAUDE.md) "Invariants" for the reason behind each rule.
