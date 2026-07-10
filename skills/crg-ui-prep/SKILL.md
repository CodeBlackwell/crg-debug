---
name: crg-ui-prep
description: Walk a user gap-by-gap to crg-ui's Story 9 ("perfect user") — audit the Figma file, repo, and environment against the perfect-user checklist, then close each gap in dependency-sorted leverage order with a three-door gate per item (supply it yourself / let me apply it / descope explicitly), generating Figma-side assets via the figma MCP and repo-side assets as approved diffs. Deliverable: a validated draft .crg-ui/profile.json so the next /crg-ui run has a zero-question GATE-PROFILE. Use for /crg-ui-prep, "prep for crg-ui", "make me a perfect crg-ui user", "audit my design file against the checklist".
argument-hint: "[figma-url] [repo path] [--audit-only] [--top5]"
user_invocable: true
---

# CRG UI Prep

Converts any user into `perfect-user.md`'s Story 9 user: every checklist item either
passes or was descoped on purpose, so `/crg-ui`'s GATE-PROFILE degenerates to a single
zero-question confirmation. Read `checklist.md` (this skill's directory) first — it is
the item contract: audit check, fix path, mode, effort, and dependency per item, plus
the loop order. This skill runs in the main loop (it is conversation-shaped, a gate per
item); there is no Workflow for it.

Three rules inherited from crg-ui, never bent:

1. **Compute before asking.** The audit measures everything measurable; gates only ever
   present findings and doors, never open-ended questions the scans could have answered.
2. **Three doors on every missing thing**: *supply it yourself / let me apply it (shown
   in full first) / descope it explicitly (reason recorded)*. Same shape every time.
3. **Every answer persists.** `.crg-ui/prep.json` records each item's outcome; re-runs
   skip anything done or descoped and never re-ask. Descopes are decisions, not gaps.

And one of its own: **never mutate the Figma file silently.** Every `use_figma` write is
preceded by the complete change table (renames, bindings, resizes) and an approval. A
view-only file downgrades every §1 apply-door to a generated designer brief (a markdown
handoff the user sends to whoever owns the file).

**Tooling:** pairer/validator is `$HOME/.claude/workflows/crg-ui.map.mjs` if the
`crg-deterministic` enabler installed it, else `lib/ui-map.mjs` two levels up from this
skill's directory. Before ANY `use_figma` call, load the `figma-use` skill (mandatory
prerequisite); for variable/component creation also load `figma-generate-library`.

## Parse `$ARGUMENTS`

- **figmaUrl**: a figma.com URL anywhere in the args → extract the file key. Absent →
  item 1.1's bootstrap gate is the first stop (unless prep.json already has the key).
- **repoRoot**: explicit path wins; else `git rev-parse --show-toplevel`; else STOP and ask.
- **auditOnly**: `--audit-only` ends the run after Stage 0 — the scorecard is the deliverable.
- **top5**: `--top5` pre-scopes GATE-PLAN to checklist steps 3–8 (the five ★ items plus
  their hard dependencies).

## Stage 0 — AUDIT (silent, computed)

Load `<repoRoot>/.crg-ui/prep.json` if present — items already `done`/`descoped` are
settled. Then, in order:

1. **Env scan** (inline, cheap): E1 `command -v uv` · E2 figma `whoami` · E3
   `npx playwright --version` · E5 note the host DPR. E2 failing blocks the Figma scan —
   surface it as the first gap instead of proceeding blind.
2. **Repo scan** (one agent): manifest/stack (2.1), dev command + URL (2.2),
   `data-component`/`data-testid` coverage (2.3), token sources + raw-literal count
   (2.4), render seams (2.5), routes (2.6), `.storybook/` (2.7), CRG graph freshness
   (2.8), auth seams (2.9). Returns findings keyed by item ID.
3. **Figma scan** (only with a URL + E2 green): `get_metadata` → frames.json, run the
   pairer against a draft screen list from the repo scan's routes; `get_variable_defs`;
   `get_code_connect_map`; component-vs-group census; export marks; font families
   (checked against installed fonts → 1.9/E4).

Emit the **SCORECARD**: every checklist item → `pass` / `gap` / `descoped` / `n/a`, with
the measured evidence (e.g. "1.2: pairer matched 4/11 frames — 7 unmatched"), effort
label, and the ★ markers, ordered by the checklist's loop order. `--audit-only` stops
here and writes the scorecard into prep.json.

## Stage 1 — GATE-PLAN (HARD, the one scoping conversation)

Show the scorecard. Ask once: work **all gaps** / **top-5** (★ + deps) / **select a
subset** / **stop at audit**. Items scoped out here are marked `skipped` (soft — a
re-run re-offers them), distinct from `descoped` (hard — reason recorded, never
re-offered, and §1/§2 descopes that crg-ui would trip over are queued for the draft
profile's `intentionalDeviations`). Never auto-passed.

## Stage 2 — GAP LOOP (resumable; checklist loop order, gaps only)

For each in-scope gap, one iteration, five beats:

1. **EXPLAIN** — one short paragraph: what this buys / what it costs when absent
   (checklist's source columns; quote perfect-user.md's numbers where it has them).
2. **PROPOSE** — the concrete artifact, in full: a rename table (1.2), a variable
   name-map (1.5), a codemod diff (2.3), install commands (E*), a `generate_figma_design`
   bootstrap plan (1.1). Never "I would rename some frames" — the actual list.
3. **GATE** — the three doors via AskUserQuestion. Door 1 (user does it) → give exact
   instructions, then wait and verify. Door 2 (apply) → proceed. Door 3 (descope) →
   record the reason, move on.
4. **APPLY** — figma-gen items: load `figma-use` first, mutate exactly what the proposal
   showed. Code items: apply the shown diff, nothing more. Guide items: hand over the
   commands, verify when the user says done.
5. **VERIFY + PERSIST** — empirical, per the checklist's audit-check column: re-run the
   pairer after 1.2, re-grep after 2.3, `list_graph_stats` after 2.8, two identical
   screenshots after 2.5. Only a green check marks the item `done` in prep.json (with
   the evidence string). Persist after every item — an interrupted run resumes here.

Paired step 1.2+2.6 is a single iteration: build the routes manifest and the frame
rename table together so screen names agree by construction. 2.4 at `project` size gets
a fourth honest framing inside door 1: run it as its own delegated refactor session and
resume prep afterward.

## Stage 3 — EXIT TEST + HANDOFF

1. Re-run Stage 0's scans (cheap; most items just re-verify). Show the before/after
   scorecard.
2. Assemble the **draft profile** from prep.json's accumulated answers — schema exactly
   per the validator: `schemaVersion: 1`, `project`, `figma.fileKey`,
   `stack {framework, devCommand, devUrl, readyTimeoutSec}`, `mode` (inferred from which
   breakpoints the frames cover), `breakpoints[]`, `screens[{name, route, frames}]` (from
   the pairer's output), `tolerance.geometryPx: 1`, `fences {allow, forbid}`,
   `intentionalDeviations[]` (the queued descopes), plus `dpr` (E5). Validate with
   `crg-ui.map.mjs validate` — fix-or-stop on errors. Write it to
   `<repoRoot>/.crg-ui/profile.json` ONLY on the user's approval (it is crg-ui's
   GATE-PROFILE artifact; prep pre-fills it, the human still blesses it). Mirror
   `intentionalDeviations` into `allowlist.json`.
3. **The exit test**: state it plainly — with this profile, `/crg-ui`'s GATE-PROFILE has
   zero open questions (or list exactly which questions remain and which skipped items
   cause them).
4. Offer: launch `/crg-ui <figma-url>` now / show the remaining-gaps list / done. The
   durable record is `<repoRoot>/.crg-ui/` (prep.json, profile.json, allowlist.json).

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

`items` is the loop's memory (statuses: `pass` · `gap` · `done` · `descoped` ·
`skipped`); `answers` accumulates the draft-profile fields as items close. prep.json
never duplicates a finished profile — once profile.json is written and validated, it is
the source of truth and re-runs of prep treat its fields as settled.
