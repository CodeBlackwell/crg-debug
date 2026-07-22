# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

The `crg-debug` Claude Code plugin: eight graph-driven, harness-enforced workflows
(`/crg-debug`, `/crg-farm`, `/crg-build`, `/crg-ralph`, `/crg-ui`, `/crg-ui-prep`,
`/crg-integrations`, `/crg-agentsmd`). Each command is a **skill** (entry point + human gates)
over a **methodology** (the single source of truth) executed either in prose mode or by a
deterministic **JS Workflow** whose script — not the model — owns control flow and every
pass/fail verdict. See README.md for the full user-facing picture.

## Commands

```
node --test                 # full suite (225 tests, ~3s); run before any commit
bin/crg-deterministic       # installs Workflows + tools into ~/.claude/workflows/
```

## Architecture map

One command = up to five pieces, wired by naming convention:

| Piece | Location | Role |
|---|---|---|
| Skill | `skills/<name>/SKILL.md` | flag parsing, prose-vs-workflow routing, ALL human gates, daemon ownership |
| Methodology | `skills/<name>/methodology.md` | judgment rules both modes execute — the source of truth |
| Workflow | `workflows/<name>.js` | deterministic orchestration: phases, fences, exit-code gates, commits |
| Tool core | `lib/*.mjs` / `lib/ui-collect.js` | deterministic CLIs that compute every number/status |
| Agent | `agents/*.md` | sequential single-context variants (crg-debugger, crg-ui-converger) |

The enabler copies these into `~/.claude/workflows/` under dotted names
(`lib/ui-measure.mjs` → `crg-ui.measure.mjs`, `skills/crg-farm/methodology.md` →
`crg-debug.farm-methodology.md`, etc.) and rewrites some relative imports with `sed`.
**If you add a lib file or change an import path, update `bin/crg-deterministic` to match.**

## Invariants — do not break

- **Workflow sandbox limits.** Workflow scripts have no filesystem, no `Date.now()` /
  `Math.random()`, and cannot nest skills or call `AskUserQuestion`. That is *why* gates,
  daemons, and file reads live in skills, and why profiles/ledgers travel as inline args
  (`approvedClusters`, `approvedDiscrepancies`) rather than paths an agent re-reads.
- **Pure-helpers blocks.** Each workflow's testable logic sits between
  `// >>> pure-helpers` and `// <<< pure-helpers` markers; tests eval-extract that block
  directly, so the tested code IS the shipped code. Keep the block dependency-free and the
  markers intact; add a test for any helper you add.
- **Agents claim, the script decides.** Never move a verdict (exit-code judgment, seal
  check, fence check, commit validation) from JS into an agent prompt. Agents transcribe
  verbatim and relay tool output; every relay that matters is schema-shaped and, where
  mangling would lie silently, checksum-sealed.
- **Byte-identical twins.** `sealOf` (FNV-1a) is defined in both `lib/ui-measure.mjs` and
  `workflows/crg-ui.js`; `itemsSeal` in `lib/ui-prep.mjs` and `workflows/crg-ui-prep.js`;
  `keyOf` in `lib/ledger-slice.mjs` must match `workflows/crg-debug.js`. Parity tests
  exist — change one copy, change all.
- **`fence()` everything untrusted.** Any repo source, issue body, PRD text, or Figma
  payload interpolated into an agent brief goes through `fence()`. Never interpolate raw.
- **No AI attribution.** Commit messages and PR bodies must read human — no
  Claude/Anthropic/Co-Authored-By trailers. The workflows gate-check this in code
  (`commitMessageOk`); it applies to this repo's own commits too.
- **Safety rails are product features.** Never-push, draft-PRs-only, never-transmit
  advisories, never-auto-re-bake, hard human gates: these are load-bearing guarantees.
  Do not "streamline" one away.

## Release & sync discipline

- **Version source of truth is `.claude-plugin/plugin.json`.**
  `package.json` is test-runner metadata only. CHANGELOG follows Keep a Changelog; new
  work goes under `[Unreleased]` until released.
- After pushing this repo, `git pull` the marketplace clone at
  `~/.claude/plugins/marketplaces/crg-debug`, and re-run `bin/crg-deterministic` if
  workflows/libs/methodologies changed — installed copies do not update themselves.
- Always make changes in THIS source repo, never directly in `~/.claude/` installs.
