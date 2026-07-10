---
name: crg-ui-prep
description: Walk a user gap-by-gap to crg-ui's Story 9 ("perfect user") — audit the Figma file, repo, and environment against the perfect-user checklist with a deterministic prep tool (every status a computed fact, sealed), then close each gap in dependency-sorted leverage order with a three-door gate per item (supply it yourself / let me apply it / descope explicitly), generating Figma-side assets via the figma MCP and repo-side assets as approved diffs. Deliverable: a validated draft .crg-ui/profile.json plus a sealed prep-packet.json that /crg-ui's Stage 0 verifies by exit code — zero-question GATE-PROFILE as a machine check. Use for /crg-ui-prep, "prep for crg-ui", "make me a perfect crg-ui user", "audit my design file against the checklist".
argument-hint: "[figma-url] [repo path] [--audit-only] [--top5] [--prose]"
user_invocable: true
---

# CRG UI Prep

Converts any user into `perfect-user.md`'s Story 9 user: every checklist item either
passes or was descoped on purpose, so `/crg-ui`'s GATE-PROFILE degenerates to a single
zero-question confirmation. Read `checklist.md` (this skill's directory) first — it is
the item contract: audit check, fix path, mode, effort, and dependency per item, plus
the loop order. This skill runs its GATES in the main loop (it is conversation-shaped);
everything between gates is harnessed.

**Prerequisite (deterministic mode):** `$HOME/.claude/workflows/crg-ui-prep.js`
installed by the bundled `crg-deterministic` enabler. Absent, or `--prose` passed →
**prose mode**: run the same stages yourself in the main loop, executing the prep tool
directly via Bash and reading its output (no agent relays, so no seals needed) — every
status still comes out of the tool, never out of you.

**Tooling:** the prep tool is `$HOME/.claude/workflows/crg-ui.prep.mjs` if the enabler
installed it, else `lib/ui-prep.mjs` two levels up from this skill's directory (the
pairer/validator `ui-map.mjs` sits beside it). Before ANY `use_figma` call, load the
`figma-use` skill (mandatory prerequisite); for variable/component creation also load
`figma-generate-library`.

Three rules inherited from crg-ui, never bent:

1. **Compute before asking.** The audit measures everything measurable; gates only ever
   present findings and doors, never open-ended questions the scans could have answered.
   Whatever the tool cannot compute it reports as `unknown` with raw evidence — the gate
   decides, nothing is guessed.
2. **Three doors on every missing thing**: *supply it yourself / let me apply it (shown
   in full first) / descope it explicitly (reason recorded)*. Same shape every time.
3. **Every answer persists.** `.crg-ui/prep.json` records each item's outcome; re-runs
   skip anything done or descoped and never re-ask. Descopes are decisions, not gaps.

And two of its own:

- **Never mutate the Figma file silently.** Every `use_figma` write is preceded by the
  complete change table (renames, bindings, resizes) and an approval. A view-only file
  downgrades every §1 apply-door to a generated designer brief.
- **Gates speak plain language.** Door labels and proposal summaries name what changes
  and where in words a non-engineer can approve — never tool jargon ("codemod",
  "seam", "normalize"). The full technical artifact is shown below the summary, not
  instead of it.

## Parse `$ARGUMENTS`

- **figmaUrl**: a figma.com URL anywhere in the args → extract the file key. Absent →
  item 1.1's bootstrap gate is the first stop (unless prep.json already has the key).
- **repoRoot**: explicit path wins; else `git rev-parse --show-toplevel`; else STOP and ask.
- **auditOnly**: `--audit-only` ends the run after Stage 0 — the scorecard is the deliverable.
- **top5**: `--top5` pre-scopes GATE-PLAN to checklist steps 3–8 (the five ★ items plus
  their hard dependencies).
- **prose**: `--prose` forces prose mode even with the Workflow installed.

## Stage 0 — AUDIT (silent, computed)

Deterministic mode — one Workflow call does the whole audit:

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-ui-prep.js',
  args: { repoRoot, figmaFileKey, scope,
          prepToolPath: '$HOME/.claude/workflows/crg-ui.prep.mjs',
          checklistPath: '$HOME/.claude/workflows/crg-ui-prep.checklist.md' } })
```

`scope` (optional, comma-separated dirs/files relative to repoRoot) narrows the repo
audit to the app under prep — when the user scopes to part of a monorepo, pass the
same paths the profile's `fences.allow` will use. The workflow fans out repo + env
audits, transcribes the Figma dumps verbatim, and returns
`{status:'audited', items, gaps, unknowns, seal}` with every status computed by the
prep tool and the scorecard relay proven by its seal. Early bails come back for YOU:
`figma-unreachable` (check `whoami` / file access, then re-invoke) · `audit-failed` /
`audit-mismatch` (show the reason, stop).

Prose mode: run the tool directly — `audit-repo`, `audit-env` (E2 from figma `whoami`,
E5 from the host display), `normalize-figma-audit` over verbatim `get_metadata` /
`get_variable_defs` / `get_code_connect_map` dumps (also write the top-level frames to
`.crg-ui/frames.json`), then `scorecard`.

Either way the scorecard lands in `<repoRoot>/.crg-ui/prep.json` — items already
`done`/`descoped` there are settled and never downgraded. Show every item →
`pass` / `gap` / `unknown` / `descoped` / `n/a` with the measured evidence, effort
label, and ★ markers, in the checklist's loop order. `--audit-only` stops here.

## Stage 1 — GATE-PLAN (HARD, the one scoping conversation)

Show the scorecard. Ask once: work **all gaps** / **top-5** (★ + deps) / **select a
subset** / **stop at audit**. `unknown` items are gated here too (they are questions
the tool could not answer, e.g. the auth seam). Items scoped out are marked `skipped`
(soft — a re-run re-offers them), distinct from `descoped` (hard — reason recorded,
never re-offered, and §1/§2 descopes that crg-ui would trip over are queued for the
draft profile's `intentionalDeviations`). Never auto-passed.

## Stage 2 — GAP LOOP (resumable; checklist loop order, gaps only)

**Item 1.1 (bootstrap) is skill-owned end to end** — the harness never generates a
design. Its gate offers explicit doors: paste an existing file / **mirror the current
app** into Figma (`generate_figma_design` from the live app) / **design something new**
(a redesign brief gated BEFORE any canvas work — density, screen count, expanded
states are decisions, not defaults) / exit to `/crg-build`'s rubric review. Generation
at scale uses the parallel pattern: serial foundation (file, variables, skeleton with
assigned node IDs) → one shared spec file → parallel panel agents → an assembly QA
pass over the seams (frame bounds, overflow, spacing) before the design gate. Only a
file the human **blessed in Figma** becomes the oracle.

For everything else, deterministic mode runs in waves:

1. **PROPOSE** — `Workflow({..., args: {..., proposeGaps: [<in-scope gap ids>],
   scorecard: {items: <the audit return's items, verbatim>}}})`. Returns one concrete,
   structured proposal per gap: a rename table (1.2), a variable map (1.5), a complete
   unified diff + file list (2.3/2.4/2.5), exact commands (E*). Read-only — nothing was
   touched.
2. **GATE** — one wizard screen per gap, in loop order: the plain-language summary,
   what the item buys (quote perfect-user.md's numbers), the full artifact, then the
   three doors via AskUserQuestion. Door 1 (user does it) → exact instructions, wait,
   verify with the tool. Door 3 (descope) → record the reason via the `record` command,
   move on.
3. **APPLY** — `Workflow({..., args: {..., apply: [{gapId, proposal}, ...]}})` with the
   approved proposals passed back **byte-exact** — never retyped, never summarized. The
   workflow executes exactly each proposal (touched files fenced to it), verifies each
   with the prep tool's exit code, records green items in prep.json, and reverts red
   code edits. Show the per-gap outcomes; `needs-gate` items (no deterministic
   verifier, e.g. fonts) come back to you — verify per the checklist's audit-check
   column and record the result yourself.

Prose mode runs the same beats inline: propose → gate → apply exactly what was shown →
`ui-prep.mjs verify <id>` → `ui-prep.mjs record`. In BOTH modes `record` is prep.json's
only writer — never hand-edit it.

Paired step 1.2+2.6 is a single iteration: build the routes manifest and the frame
rename table together so screen names agree by construction. 2.4 at `project` size gets
a fourth honest framing inside door 1: run it as its own delegated refactor session and
resume prep afterward.

## Stage 3 — EXIT TEST + PACKET

1. Re-run Stage 0 (cheap; settled items are preserved). Show the before/after scorecard.
2. Assemble the **draft profile** from prep.json's accumulated answers — schema exactly
   per the validator: `schemaVersion: 1`, `project`, `figma.fileKey`,
   `stack {framework, devCommand, devUrl, readyTimeoutSec}`, `mode`, `breakpoints[]`,
   `screens[{name, route, frames}]` (from the pairer's output), `tolerance.geometryPx: 1`,
   `fences {allow, forbid}`, `intentionalDeviations[]` (the queued descopes), plus `dpr`
   (E5). Validate with `ui-map.mjs validate` — fix-or-stop on errors. Write it to
   `<repoRoot>/.crg-ui/profile.json` ONLY on the user's approval (prep pre-fills it, the
   human still blesses it). Mirror `intentionalDeviations` into `allowlist.json`.
3. **GATE-PACKET**: state the exit test plainly — with this profile, `/crg-ui`'s
   GATE-PROFILE has zero open questions (or list exactly which remain and why). On
   approval, assemble the ready packet:
   `Workflow({..., args: {..., packet: true}})` (prose:
   `ui-prep.mjs packet <repoRoot>` then `verify-packet`). The tool writes
   `.crg-ui/prep-packet.json` — profile + attestations + pairing under ONE seal — and
   `verify-packet` must exit 0. Profile-critical items still open block the packet;
   cosmetic gaps (1.6, 1.7, …) ride along as `openGaps`, visible to /crg-ui.
4. Offer: launch `/crg-ui <figma-url>` now (its Stage 0 verifies the packet and skips
   intake entirely) / show the remaining-gaps list / done. The durable record is
   `<repoRoot>/.crg-ui/` (prep.json, profile.json, allowlist.json, prep-packet.json).

## prep.json

```json
{
  "schemaVersion": 1,
  "figmaFileKey": "abc123",
  "items": {
    "1.2": { "status": "done", "evidence": "pairer 11/11 frames", "at": "2026-07-09" },
    "2.7": { "status": "descoped", "reason": "no Storybook appetite", "at": "2026-07-09" },
    "2.4": { "status": "skipped" }
  },
  "answers": { "stack": { "framework": "react", "devCommand": "npm run dev",
               "devUrl": "http://localhost:5173", "readyTimeoutSec": 60 },
               "breakpoints": [ { "name": "desktop", "width": 1440, "height": 900 } ],
               "screens": [ { "name": "Home", "route": "/", "frames": { "desktop": "1:23" } } ],
               "mode": "desktop-only", "dpr": 2 }
}
```

`items` is the loop's memory (statuses: `pass` · `gap` · `unknown` · `done` ·
`descoped` · `skipped` · `n/a`); `answers` accumulates the draft-profile fields as
items close. The `scorecard` and `record` tool commands are its only writers. prep.json
never duplicates a finished profile — once profile.json is written and validated, it is
the source of truth and re-runs of prep treat its fields as settled.
