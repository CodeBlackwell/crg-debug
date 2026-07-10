# crg-ui — The Perfect User Checklist

Status: planning (2026-07-08). Companion docs: `user-stories.md` (Story 9 is this
document made real), `implementation-plan.md`. The `/crg-ui-prep` skill
(`skills/crg-ui-prep/`) walks a user through this checklist item by item, and Story 9
is machine-checked: prep emits a sealed `.crg-ui/prep-packet.json` that `/crg-ui`'s
Stage 0 verifies with `ui-prep.mjs verify-packet` (exit 0 = zero-question intake).

Everything a user prepares so that launching `/crg-ui` hits the north-star path: intake
computes everything, GATE-PROFILE is a single zero-question confirmation, and the whole
run has exactly two human touchpoints (profile confirm + ledger approval).

Each item lists what intake does with it when present, and what it costs when absent.

## 1. Figma file preparation

| # | Item | When present | When absent |
|---|------|--------------|-------------|
| 1.1 | **One design file (or a known set) covering every in-scope screen** | Intake enumerates frames via `get_metadata` | Story 1: bootstrap-or-exit gate |
| 1.2 | **Frame naming convention: `<Screen> / <Breakpoint>`** (e.g. "Home / Desktop 1440", "Home / Mobile 375") | Pairer auto-matches frames to routes and breakpoints; mode is inferred from which breakpoints exist | Story 2: hand-pairing table at GATE-PROFILE |
| 1.3 | **Frames at exact device sizes** (1440, 768, 375 — whatever the set is), one frame = one screen state | Viewport per matrix cell is read straight off the frame; geometry layer compares like-for-like | Scaled/odd-size frames force normalization guesses and degrade the geometry layer |
| 1.4 | **All colors, type, and spacing bound to Figma variables** — no detached hex values or hand-typed sizes | `get_variable_defs` yields the token oracle; token layer runs deterministically | Token layer degrades to per-element style comparison — noisier, less fixable |
| 1.5 | **Token names that mirror the code's tokens** (`color/primary` ↔ `--color-primary`) | Token mismatches resolve to a *named* variable fix, routed to the cheapest fix tier | Fix agent must first discover which CSS var maps to which Figma variable |
| 1.6 | **Real Figma components for repeated elements** (not flattened groups or pasted copies) | Component instances give clean per-element identity; one discrepancy per component, not per instance | Duplicate findings per instance; noisier ledger |
| 1.7 | **Code Connect map published** (Figma node-id ↔ code component) | The diff→code join is a lookup; the mapping ladder's top rung | MAP falls down the ladder: devtools hook → `data-*` convention → CRG heuristic |
| 1.8 | **Exportable assets** (icons/images marked for export) | `download_assets` supplies exact assets for `asset`-class fixes | Asset discrepancies become needs-human |
| 1.9 | **Fonts identified and licensed for local install** | Matched font rendering; the #1 pixel-layer false positive eliminated | Pixel layer noise; geometry still works |

## 2. Repository preparation

| # | Item | When present | When absent |
|---|------|--------------|-------------|
| 2.1 | **Unambiguous stack** (single framework, clean manifest) | `detect()` answers; no stack question asked | Ambiguous monorepo → stack question at GATE-PROFILE |
| 2.2 | **Documented dev command** (justfile/package script) that boots in **dev mode** | BOOT is scripted; dev mode enables runtime component-owner resolution | Profiler agent must guess the boot command; prod builds break owner resolution |
| 2.3 | **`data-component` (or `data-testid`) convention on component roots** | Owner resolution is deterministic even where devtools hooks fail | Resolution relies on framework internals (React fiber walk etc.) — works, but fragile across versions |
| 2.4 | **Centralized design tokens** (CSS custom properties / Tailwind config), one source of truth | Token layer reads one file; fixes are one-line; CRG impact radius shows every usage | Scattered literals → each token discrepancy becomes a multi-file hunt |
| 2.5 | **Deterministic render seams**: mock/seed data flag, animation-disable flag, frozen clock | Screenshots and geometry are reproducible run-to-run; no flake retries | Dynamic content shows up as phantom discrepancies |
| 2.6 | **Routes manifest** (crg-build profile parity: route → screen name) | Screens × breakpoints matrix assembles itself; frame pairing gets its screen list | Route discovery agent pass; more pairing ambiguity |
| 2.7 | **Storybook (optional but ideal)** | Per-component isolation rendering at exact frame size — the cleanest oracle, no layout interference | Full-page screenshots with per-element crops; still correct, more cross-talk |
| 2.8 | **CRG graph built and fresh** (`code-review-graph build`) | MAP joins straight into `get_minimal_context` / `get_impact_radius` | First run pays the graph build |
| 2.9 | **Auth seam for protected routes** (crg-build's `tokenCmd` pattern; tokens never stored) | Measurement covers authed screens unattended | Authed screens are `unmeasurable` in the ledger |

## 3. Environment preparation

- **`uv` on PATH** — the plugin's `.mcp.json` launches
  `uvx --from 'code-review-graph-codeblackwell>=2.4.0' code-review-graph serve`.
- **Figma MCP authenticated** (`whoami` succeeds) with access to the design file.
- **Playwright browsers installed** (measurement driver), including device descriptors
  for the mobile cells.
- **Design fonts installed locally** (the files, not lookalikes) — see 1.9.
- **Fixed display scale for measurement runs** (DPR pinned in the profile, not inherited
  from the host display).

## 4. Persisted state (earned, not prepared)

These accumulate from prior runs; the perfect user's *second* run is cheaper than their
first:

- `ui-profile.json` — stack, mode, breakpoints, frame pairing, boot command, DPR. Every
  answered question is recorded; re-runs never re-ask.
- `ui-map.json` — Figma node × breakpoint × component × file join, refreshed
  incrementally like the graph itself.
- **Intentional-deviation allowlist** — every human-blessed "close enough" persists so
  it never re-flags (the drift-queue analog).

## What all of it buys

| Prepared state | Gates before measurement | Questions asked | Run shape |
|---|---|---|---|
| Nothing (Story 1) | 1 + bootstrap round-trip | many | oracle creation, then converge |
| Typical (Stories 2–5) | 1 | a few (pairing, mode, gaps) | converge with gap resolutions |
| Perfect (Story 9) | 1 (zero-question confirm) | 0 | measure → ledger → waves → done |

The checklist is front-loaded: 1.2, 1.4, 1.5, 2.3, 2.5 are the five highest-leverage
items — they convert the noisiest, most model-dependent steps into deterministic
lookups, which is exactly where crg-ui's cost and reliability come from.
