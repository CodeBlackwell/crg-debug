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
node --test                 # full suite (395 tests, ~15s); run before any commit
bin/crg-deterministic       # installs Workflows + tools into ~/.claude/workflows/
```

## Architecture map

One command = up to five pieces, wired by naming convention:

| Piece | Location | Role |
|---|---|---|
| Skill | `skills/<name>/SKILL.md` | flag parsing, prose-vs-workflow routing, ALL human gates, daemon ownership |
| Methodology | `skills/<name>/methodology.md` | judgment rules both modes execute — the source of truth |
| Workflow | `workflows/<name>.js` | deterministic orchestration: phases, fences, exit-code gates, commits |
| Tool core | `lib/*.mjs` / `lib/crg-ui.collect.js` | deterministic CLIs that compute every number/status |
| Agent | `agents/*.md` | sequential single-context variants (crg-debugger, crg-ui-converger) |

The enabler flattens all of these into `~/.claude/workflows/`. Methodologies and
checklists get a dotted, command-scoped name (`skills/crg-farm/methodology.md` →
`crg-debug.farm-methodology.md`), but **every `lib/` filename already IS its installed
filename** — `lib/crg-ui.measure.mjs` installs as `crg-ui.measure.mjs`. That is why
`bin/crg-deterministic` can copy `lib/` with a single glob and no `sed` import rewriting,
and why adding or splitting a lib file needs no enabler change at all. Keep it that way:
a lib file whose name does not survive the flattening reintroduces the rewrite step and
the stale-install bug class it used to cause.

## Invariants — do not break

- **Workflow sandbox limits.** Workflow scripts have no filesystem, no `Date.now()` /
  `Math.random()`, and cannot nest skills or call `AskUserQuestion`. That is *why* gates,
  daemons, and file reads live in skills, and why profiles/ledgers travel as inline args
  (`approvedClusters`, `approvedDiscrepancies`) rather than paths an agent re-reads.
- **Pure-helpers blocks.** Each workflow's testable logic sits between
  `// >>> pure-helpers` and `// <<< pure-helpers` markers; tests eval-extract that block
  directly, so the tested code IS the shipped code. Keep the block dependency-free and the
  markers intact; add a test for any helper you add.
- **`agent()` failures must be contained, not assumed away.** `agent()` returns `null` for
  some failures but **throws** for others — notably a schema-gated call that exhausts its
  StructuredOutput retry cap. Guards written for the null shape (`if (!x) throw`,
  `.filter(Boolean)`) are silently bypassed by a throw, which then destroys phases that
  already succeeded. Every workflow routes its top-level calls through `tryAgent`, and
  per-workflow guard tests enforce that no bare call survives outside it. **Match the call,
  not the `await`:** a probe for `await agent(` cannot see `const diagnose = cl => agent(`,
  and three unguarded arrow-thunk calls hid behind exactly that regex while the test
  reported clean. Calls inside `parallel()`/`pipeline()` thunks are already safe — the
  runtime resolves a throwing thunk to `null`. Relatedly: **prefer single-property submit schemas for any agent
  whose output is load-bearing.** A model that mis-serializes a multi-parameter tool call
  leaks the raw `<parameter name="…">` wire format into the first property's string value,
  and the validator's "missing property X" feedback never tells it so — it repeats the same
  shape until the cap. One property means there is no second tag to leak.
- **A null verdict is not a passing verdict.** `tryAgent` converts a dead agent into `null`,
  which then flows into code that reads it as "no problems reported". A dead gate is not a
  green gate; a dead commit relay is not a failed commit (the agent runs `add`/`commit`/
  `rev-parse` *before* it reports, so the likely shape is a commit that landed unverified);
  an un-commit that never reported is not an un-commit; a write agent that never reported
  leaves a *prior* run's file at the path. Every one of these shipped at least once. When a
  fallback exists for "nothing to do" — zero gate rows, an empty scope — the dead case must
  be split out **before** it reaches that fallback, because both look like silence and only
  one is evidence. Stop the run and name the branch or path to inspect.
- **Agents claim, the script decides.** Never move a verdict (exit-code judgment, seal
  check, fence check, commit validation) from JS into an agent prompt. Agents transcribe
  verbatim and relay tool output; every relay that matters is schema-shaped and, where
  mangling would lie silently, checksum-sealed.
- **Byte-identical twins.** Both crg-ui seals live in one module, `lib/crg-ui.seal.mjs`:
  `sealOf` (FNV-1a) must match `workflows/crg-ui.js`, and `itemsSeal` must match
  `workflows/crg-ui-prep.js`. `bugKeyOf` in `lib/crg-debug.ledger-slice.mjs` must match
  `workflows/crg-debug.js`. Parity tests exist — change one copy, change all. A twin's two
  halves also keep the same NAME: rename both together or neither, so the pair stays greppable.
- **One exported name, one meaning.** `lib/` is flat and its files are read by grep as often
  as by import. Two different functions must never share an exported name across it — hence
  `validateAppProfile` / `validateMatrixProfile` / `validateRalphProfile` / `validateUiProfile`,
  `bugKeyOf` vs `cellKeyOf`, and `assembleRulesLedger` vs `assembleUiLedger`.
  This is the same rule the workflow prelude already follows; it binds `lib/` too.
- **Cross-workflow structure is tested, not assumed** (`test/workflow-structure.test.mjs`).
  The shared prelude (`fence`, `capText`, `norm`, `normPath`, `isSafeAbs`,
  `commitMessageOk`, `TIERS`, `tryAgent`, `uncommitOk`, `underFence`) and `GATE_SCHEMA`
  must stay byte-identical across every
  workflow that declares them; the sandbox forbids imports, so copies are the mechanism
  and the parity test is what keeps them honest. Two divergences are deliberate and
  named in the test: `crg-agentsmd`'s `resolveModel` (falls through to the session model,
  never `haiku`) and its `GATE_KIND_SCHEMA` (a superset carrying a code-vs-env
  discriminator). If a copy genuinely must differ, give it a different name rather than
  hiding a second meaning behind a shared one.
- **`meta.phases` titles must match `phase()` calls exactly.** The runtime matches on the
  string; a mismatch silently orphans the progress group instead of erroring. Tested.
- **Schemas live inside the `pure-helpers` block.** They are static literals, so they
  belong where the structure tests can reach them — along with any constant they
  reference (`CONCERN_KEYS`, `GAP_ROW`, `CRITERION`, …). The block must still evaluate
  standalone; that test is what catches a schema reaching outside it.
- **`fence()` everything untrusted.** Any repo source, issue body, PRD text, or Figma
  payload interpolated into an agent brief goes through `fence()`. Never interpolate raw.
- **No AI attribution.** Commit messages and PR bodies must read human — no
  Claude/Anthropic/Co-Authored-By trailers. The workflows gate-check this in code
  (`commitMessageOk`); it applies to this repo's own commits too.
- **Safety rails are product features.** Never-push, draft-PRs-only, never-transmit
  advisories, never-auto-re-bake, hard human gates: these are load-bearing guarantees.
  Do not "streamline" one away.

## Eval program (in progress)

An eval loop is improving the `crg-debug` Workflow stage by stage and measuring it against
stock Claude Code. The owner's success test (2026-11-13): **"capable of more autonomously,
and not monstrously inefficient"**. One unattended Workflow run has to resolve more than one
unattended stock run; it does not have to match stock's usage, but usage is reported as a
multiple of stock beside every result. It lives outside this repo, in `../farm-tasks/bench-runs/`
(untracked). Read `writeups/INDEX.md` there first, then `LADDER.md` and `LOG.md`.

- **Problem register: `../farm-tasks/bench-runs/PROBLEMS.md`.** One entry per kind of problem
  the loop has met (ids `DET-nn`, later `FIX-nn`, `HAR-nn`): its class, whose limit it is, what
  was tried, its status, and the engineering that overcame it. **Keep it current.** When a run
  or a records study moves a planted bug to another class, changes a status or meets a new kind
  of problem, update it in the same turn as the `LOG.md` entry. Classify a new miss with its
  six-step procedure before proposing a fix, and check its failed-levers table first.

- **Roadmap artifact: https://claude.ai/artifact/23raAiKctsj69oV74E3rqs** ("crg-debug Eval
  Roadmap", private to the owner). Its source is `../farm-tasks/bench-runs/roadmap.html`.
  **Keep it current.** Whenever a stage's status, a rung, the repo set or the next step
  changes, edit that file and republish to the same URL in the same turn as the `LOG.md`
  entry. A page that lags the log is a defect.
- **The model is part of every result.** Evals pass `model: "sonnet"` to the Workflow and
  stock Claude Code runs on the same model. The Workflow has no escalation of its own: it
  runs every agent on the one model it is given, default `haiku`. The haiku, sonnet, opus
  ladder is `/crg-farm`'s. `tally.py` and `collect.py` record `model`, `wf_model` and
  `agent_models` for every run; a writeup names all three, and a run whose agents ran on an
  unexpected model is reported apart.
- Variant changes go on an eval branch and are frozen under `variants/<TAG>/` before any
  trial. Nothing from the eval loop merges, pushes or ships without the owner's separate yes.

## Release & sync discipline

- **Version source of truth is `.claude-plugin/plugin.json`.**
  `package.json` is test-runner metadata only. CHANGELOG follows Keep a Changelog; new
  work goes under `[Unreleased]` until released.
- After pushing this repo, run `claude plugin marketplace update crg-debug`, then re-run
  `bin/crg-deterministic` if workflows/libs/methodologies changed — installed copies do
  not update themselves. **Do not just `git pull` the clone at
  `~/.claude/plugins/marketplaces/crg-debug`.** The clone and Claude Code's registry are
  separate state: pulling by hand moves the checkout but leaves `lastUpdated` in
  `~/.claude/plugins/known_marketplaces.json` stale and the catalog cache unrefreshed.
  The `marketplace update` command does both.
- **`Workflow({name: "crg-debug"})` resolves from the PLUGIN CACHE**
  (`~/.claude/plugins/cache/crg-debug/crg-debug/<version>/workflows/`), *not* from
  `~/.claude/workflows/`. Verified 2026-08-13 by diffing a launched run's persisted script
  against all three copies. So `bin/crg-deterministic` alone does **not** make a workflow fix
  live — a run launched by name will silently execute the last released version. To exercise
  an unreleased fix, launch with `{scriptPath: "~/.claude/workflows/crg-debug.js"}`; to make
  it the default, it has to be committed, pushed, and pulled through
  `claude plugin marketplace update`.
- Always make changes in THIS source repo, never directly in `~/.claude/` installs. A
  stray edit in the clone silently blocks the next update — `git pull` refuses to merge
  over a dirty tree, and the failure surfaces as a release that appears to have shipped.
