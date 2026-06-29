---
name: crg-debug
description: CRG-driven parallel debug + fix sweep. Builds/refreshes the code-review-graph, maps hotspots, fans out parallel discovery over disjoint concerns, verifies adversarially, and fixes confirmed bugs in TDD waves over file-disjoint sets. Nothing is committed. Use for /crg-debug, "debug this repo with CRG", "graph-driven bug sweep".
argument-hint: "[repo path] [focus area/file/issue] [--detect-only] [--prose] [--model <name>]"
user_invocable: true
---

# CRG Debug

Graph-driven debugging in one invocation: build the graph → map hotspots → find bugs in parallel →
fix them in disjoint waves → verify → document. Fixes land in the working tree; **nothing is
committed unless the user asks.**

This skill has two orchestration modes over **one shared methodology** (`methodology.md`, in this
skill's directory):

- **Deterministic (preferred when available)** — the `crg-debug` Workflow (`crg-debug.js`), where the
  JS owns every gate (phase order, concern partitioning, dedup, wave packing, loop termination,
  per-bug close gates as exit codes it reads). Installed by the bundled enabler (see below).
- **Prose (always available)** — you, the main loop, execute `methodology.md` directly: dispatch each
  phase's work items as ONE parallel wave of `Agent` calls, barrier, then proceed.

## Parse `$ARGUMENTS`

- **repoRoot**: an explicit path or `--repo <path>` wins; else the current `git rev-parse --show-toplevel`.
  If cwd is not a git repo and no path was given, STOP and ask for the repo path.
- **scope**: any non-flag text — the focus area, file, or issue. Empty = full-repo sweep.
- **model**: `--model <name>` (e.g. `--model haiku`). Omit to inherit the session model.
- **fix**: `true` by default. `--detect-only` sets `fix=false` (read-only ledger, no edits).

## Route

1. If `~/.claude/workflows/crg-debug.js` exists AND `--prose` was NOT passed → run the deterministic
   Workflow (this instruction is the explicit opt-in):

   ```
   Workflow({ name: 'crg-debug', args: { repoRoot, scope, model, fix } })
   ```

   Omit `model` when unspecified. It runs in the background; tell the user they can watch live
   progress with `/workflows`.

2. Otherwise (no workflow installed, or `--prose`) → **read `methodology.md` from this skill's
   directory and execute it as the main-loop orchestrator** — parallel `Agent` waves per its
   *Execution mode* section, honoring every cross-cutting rule (TDD discipline, false-positive guard,
   fail-safe-defaults lens, git & safety policy, report layout) verbatim.

To upgrade prose → deterministic, run the bundled `crg-deterministic` command once.

## After it returns

Relay the ledger: confirmed bugs by severity, deferred (intentional), rejected false positives, the
fix-wave outcome (fixed / unfixed / needs-human), and the final gate status. Nothing was committed —
fixes are in the working tree. Offer to commit (named files only) or run `/cpdv`.
