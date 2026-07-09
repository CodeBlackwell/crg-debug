# crg-ui — Implementation Plan

Status: planning (2026-07-08). Companion docs: `user-stories.md`, `perfect-user.md`.
Target: new `/crg-ui` skill in this plugin, converging a live implementation toward a
Figma design. Every version gate below validates against a real production app with an
active Figma design (the "reference target") before it ships — never against synthetic
fixtures alone.

## 0. Architecture summary (decisions already made in planning)

- **Layered oracle, cheapest-first:** geometry (Figma `get_metadata` bounds vs DOM
  `getBoundingClientRect`) → tokens (`get_variable_defs` vs computed styles) → pixels
  (per-element crops, asymmetric bar — veto, never confirmation, per the
  crg-integrations calibration on 71 golden pairs) → vision (referee only; the sole
  layer that can *clear* a discrepancy).
- **The crux join:** diff region → DOM element (`elementFromPoint`) → owning component
  (adapter ladder) → CRG node → `get_minimal_context` + `get_impact_radius` → fix brief.
- **Stack variance behind an adapter** (`detect()`, `ownerOf(domNode)`, `tokenSources()`,
  `isolationRunner()`), crg-integrations `matrixAdapter`-style. React first; web
  frameworks only in v1 (React Native/Expo is a named non-goal with a seam).
- **Responsive = matrix:** screens × breakpoints, cells at exact frame viewports with
  Playwright device descriptors. Interpolation gap covered by a deterministic
  **no-breakage invariant sweep** (no overflow/overlap/clipping) — never a fake oracle
  between designed breakpoints. Adaptive mode skips cross-boundary comparison.
- **Ledger classes:** `layout | token | typography | asset | missing-element |
  responsive-breakage | intentional-deviation` — the last is the drift analog:
  human-gated, allowlisted, never auto-accepted.
- **Gates:** GATE-PROFILE (one conversation, pre-filled), GATE-MISSING-BREAKPOINT
  (three-door: supply / propose-into-Figma / descope), GATE-LEDGER, GATE-DONE. All
  descopes and approvals persist to the profile. Oracle is never invented silently.
- **House pattern:** SKILL.md routes prose vs deterministic; methodology.md is the
  single judgment contract; workflows/crg-ui.js owns enforcement (phase order, wave
  packing, close gates read real numbers); commits per green wave on `crg-ui/fix-*`,
  never pushed.

## 1. Model assignment (decided)

| Phase | Tier | Rationale |
|---|---|---|
| MEASURE (all three numeric layers) | none | Pure JS — the oracle is token-free |
| Wave verify (re-measure) | none | Code reads numbers; agents can't talk past it |
| Frame pairing | haiku | Human confirms at gate; errors die there |
| Ledger classification | none / haiku residue | Class falls out of which layer flagged |
| Owner resolution (last rung) | sonnet | A wrong mapping poisons everything downstream |
| Vision referee | sonnet floor; **opus to clear** | Tier asymmetry mirrors drift asymmetry: any tier may uphold, only a strong model may clear. Calibrate tier on labeled crops before pinning |
| Fix: `token`/`typography`/`asset` | haiku | One-line fixes, free verifier |
| Fix: `layout`/`missing-element`/`responsive-breakage` | sonnet | Flex/grid + cross-breakpoint constraints |
| Escalation | next strictly higher tier, one shot each | crg-farm ladder verbatim; max-tier regression → `needs-human` |
| Breakpoint proposals into Figma | opus | Permanent, human-reviewed artifact |
| Generate-first (greenfield) | sonnet, opus on escalation | Converge loop cleans up after it |

Flags: `--model`, `--max-tier` — identical semantics to crg-farm.

## 2. Phase 0 — Spikes (before any methodology text is final)

Cheap, throwaway, each answers one architecture-threatening question:

- **S1: Owner resolution on a real repo** (~half day, the reference target). Fiber walk
  vs `data-testid` vs Code Connect on 20 sampled DOM nodes. If reliability < ~90%, the
  `data-component` convention gets promoted from "nice" to "required" in perfect-user.md
  and the methodology.
- **S2: Frame pairing on a real Figma file** (the reference target's). If designer naming
  is too inconsistent for convention-matching, the explicit-mapping table at
  GATE-PROFILE becomes the main path and gets real UX design.
- **S3: Geometry join fidelity.** One screen, Figma bounds vs DOM bounds end-to-end at
  matched viewport. Establishes the achievable px tolerance (target ±1px; fonts and
  scrollbars will test this) and the DPR/font discipline the methodology must mandate.

Spike outcomes are written back into this plan before v0.1 starts.

## 3. v0.1 — Converge core (single breakpoint, React, geometry+token)

The smallest run that earns its keep: Stories 2, 3, and 9-shaped runs, desktop-only.

Deliverables (house layout):

```
skills/crg-ui/SKILL.md            /crg-ui entry — parse args, route prose vs deterministic,
                                  own BOOT (reuse crg-build profile/boot/token machinery),
                                  own GATE-PROFILE + GATE-LEDGER + GATE-DONE
skills/crg-ui/methodology.md      judgment contract: layered oracle, class definitions,
                                  render-determinism mandates (viewport=frame, DPR pinned,
                                  fonts.ready, animations off, mocked data), three-door
                                  rule, profile persistence rule
workflows/crg-ui.js               deterministic Workflow: MAP → MEASURE → (ledger out) /
                                  REPAIR waves in file-disjoint sets, close gates on
                                  re-measured numbers, commits per green wave
lib/ui-measure.mjs                the numeric oracle: geometry join, token diff,
                                  invariant checks — plain node, no model, unit-tested
lib/ui-map.mjs                    sidecar ui-map.json build/refresh (Figma tree ↔ DOM ↔
                                  component ↔ file), adapter ladder for ownerOf
bin/crg-deterministic             += install crg-ui.js + crg-ui.methodology.md + libs
```

Scope fences for v0.1: React adapter only; sidecar `ui-map.json` (no CRG fork changes);
no pixel layer, no vision referee (geometry+token likely resolves ~80% of real
discrepancies deterministically); single breakpoint; converge mode only (no
generate-first). Ledger shape and profile shape are final in v0.1 — later versions add
cells and classes, not schema breaks.

Exit criterion: a full converge run on the reference target reaches GATE-DONE with
geometry ±1px and exact tokens on the approved scope, waves committed on
`crg-ui/fix-*`, zero pushes.

## 4. v0.2 — Pixel + vision + the responsive matrix

- **Pixel layer:** per-element crops, pixelmatch/odiff, asymmetric bar ported from
  crg-integrations' Drift-Screen (reuse its calibration approach, recalibrate thresholds
  for element crops vs full screenshots).
- **Vision referee** with the tier asymmetry from §1, calibrated on a labeled crop set
  before the tier is pinned in the methodology.
- **Breakpoint matrix:** frame pairing across breakpoints, device descriptors, per-cell
  measurement, cross-breakpoint no-regression in wave verify, interpolation invariant
  sweep (`responsive-breakage` class goes live), adaptive-mode boundary rule.
- **GATE-MISSING-BREAKPOINT** (Stories 4/5) with the propose-into-Figma door
  (`generate_figma_design`, opus, approval in Figma before it ever becomes an oracle).
- **Intentional-deviation allowlist** persistence.

Exit criterion: Stories 4–7 all runnable end-to-end on the reference target.

## 5. v0.3 — Generate-first + bootstrap

- **Story 8:** greenfield screens scaffolded from `get_design_context`, then fed into
  the standard converge loop; mixed repos handled per-screen in one ledger.
- **Story 1(b):** oracle bootstrap — reverse-generate frames from the live app into
  Figma for human blessing.
- Second stack adapter (Vue, or whatever a real target demands — an adapter without a
  real repo behind it is YAGNI).

## 6. CRG fork extensions (tier 2 — only after v0.1 proves the join is hot)

Promote from sidecar into `code-review-graph-codeblackwell` in value order, keeping it
to node types + properties + one tool:

1. **Component nodes** from Tree-sitter (JSX/TSX/Vue SFC) with edges to defining
   files/functions — benefits every crg skill.
2. **Design-token nodes** (CSS custom props / Tailwind config) with `USES_TOKEN` edges —
   one query returns every usage site of a wrong token.
3. **`figma_node_id` property** on component nodes (persisted Code Connect map) + one
   MCP tool: `get_component_for_design_node_tool`.

No parallel UI-graph subsystem. Each lands as a normal fork release; the plugin's
`.mcp.json` floor (currently `>=2.4.0`) bumps with the first release crg-ui depends on.

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Font mismatch drowns the pixel layer | Geometry/token layers carry v0.1; fonts mandate in methodology; pixel layer stays a veto |
| Owner resolution unreliable per framework version | S1 spike first; `data-component` convention promotable to requirement; ladder degrades gracefully to CRG heuristic |
| Figma MCP rate limits / DPI fights on screenshots | REST `GET /v1/images/:file_key` fallback documented in methodology |
| Oracle staleness (design moved after mapping) | ui-map records Figma `lastModified`; MEASURE refuses stale maps, MAP refreshes incrementally |
| Fix waves thrash (fixing A moves B) | No-regression rule spans every measured element and every breakpoint; a wave that worsens any other score reverts |
| Misclassification burns the cheap tier's one shot | Acceptable by design — the ladder absorbs it; if two-rung climbs are frequent, fix classification determinism, not starting tiers |

## 8. Order of work

1. Phase 0 spikes (S1–S3) → write results back here
2. v0.1 build → validate on the reference target → exit criterion
3. README + CHANGELOG entry; `crg-deterministic` enabler update ships with v0.1
4. v0.2 → v0.3 as above; CRG fork tier-2 work only after the v0.1 exit criterion,
   informed by which joins actually ran hot
