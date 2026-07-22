# /crg-ralph — design sketch

*Status: built 2026-07-18 — `workflows/crg-ralph.js`, `lib/ralph-plan.mjs`, `skills/crg-ralph/`.
Deviations from this sketch: the wave packer lives inline in the workflow's pure-helpers block
(the crg-build `packWaves` precedent — tested by extraction), while `lib/ralph-plan.mjs` owns plan/
profile validation + Army-PRD emission; fences are prefix-aware (Army owned paths are directories);
ingested PRDs keep their declared waves as implicit prior-wave deps the packer verifies; the sweep
is composed by the skill, not the workflow. First dogfood target: SPICE `PRDs/32-forex-phase1`.*

## One sentence

Point the crg core at **feature construction**: the graph plans the army (stories → verified-disjoint
waves, lanes, fences), a deterministic Workflow runs the army (exit-code gates, JS-enforced fences,
per-wave commits, graph re-ingest), and a scoped crg-debug sweep closes the loop — the constructive
sibling of `/crg-debug`, and the graph-compiled successor to hand-authored Army PRDs.

## Why it exists

Ralph's Army and crg-debug are mirror images of one machine:

| | Ralph's Army | crg-debug |
|---|---|---|
| Direction | constructive (build from PRD) | corrective (find + fix bugs) |
| Work units | stories per agent | confirmed bugs per wave |
| Parallelism boundary | hand-authored owned paths | computed file-disjoint sets |
| Gate | static commands in the PRD | real exit codes + graph re-ingest |
| Verification | a second Claude reads the work | adversarial verify + affected flows |

The weak link in an Army PRD is exactly what the graph computes: wave assignments and domain
isolation are *guesses* made at authoring time. Nobody checked that two lanes actually touch
disjoint code, that the foundation wave holds the load-bearing files, or that wave 1's stories can
really parallelize. Communities are natural lanes; hub/bridge nodes belong in wave 0; overlapping
impact radii mean two stories serialize; fences become computed file allowlists.

Positioning vs siblings: `/crg-build` surveys a **live app** for readiness gaps and builds the
approved ones; `/crg-ralph` builds a **specified feature** from a request or PRD. Input differs
(spec vs survey); the wave execution machinery rhymes and is shared where possible.

## Pipeline

```
PROFILE (first run, GATE-PROFILE)
  → PLAN   (workflow, read-only: graph → stories → predicted file sets → JS wave packer
            → emitted Army PRD dir + plan ledger)
  → GATE-PLAN (HARD: approve / edit / re-plan / abort — never auto-passed)
  → BUILD  (workflow: parallel lanes per wave, JS fences, exit-code gates,
            model-ladder retries, commit per green wave, graph re-ingest)
  → SWEEP  (compose crg-debug --detect-only scoped to the run's diff)
  → GATE-SWEEP (approve fix waves → crg-debug fromLedger fix mode)
  → ACCEPT (acceptance criteria re-checked by harness-owned verification)
```

### Stage 0 — PROFILE (skill, first run) → GATE-PROFILE (HARD)

`<repoRoot>/.crg-ralph/profile.json`: build/typecheck/test commands, optional dev-server runtime
(browser gate is opt-in per profile — features without UI skip it), off-limits paths, default model
ladder. Drafted by one profiler agent, approved by the human, persisted. Re-runs never re-ask.

### Stage 1 — PLAN (workflow, read-only)

1. Build/refresh the graph (unconditional, like every crg harness).
2. Decompose the feature request into stories — planner agents briefed with
   `get_architecture_overview` + `semantic_search`. If the input is an *existing* Army PRD dir,
   ingest its stories instead of decomposing.
3. Per story, predict the touched-file set: semantic search + `get_impact_radius` over the symbols
   the story names. Greenfield stories declare **claimed new paths** (disjointness runs on claims;
   shared scaffolding is forced into wave 0).
4. An adversarial critic per story attacks the prediction (files exist, symbols real, radius not
   understated).
5. **`lib/ralph-plan.mjs` — the deterministic wave packer** (the heart, and the only genuinely new
   machine): takes `{story → predicted file set}` and the graph's community/hub data, computes wave
   packing (overlapping sets or radii ⇒ serialize), lane assignment (communities ⇒ lanes), and
   per-agent fence allowlists. Pure JS, testable, no model in the loop. Agents predict; the tool
   packs; the gate decides; JS enforces.
6. Emit a **standard Army PRD dir** (`PRD.md` + `agents/*.md` + `progress/`) with computed
   owned-paths, plus `.crg-ralph/plan.json` (the ledger). The PRD dir is runnable by the `ralph`
   CLI unchanged — `--plan-only` stops here and hands it over, so the planner-only mode falls out
   of the full harness for free.

### GATE-PLAN (HARD)

Show waves, lanes, per-agent fences, which stories serialized and why, and each story's prediction
confidence. Approve / edit stories / re-plan / abort. Never auto-passed — a plan is a spec-level
decision, same class as GATE-PROFILE.

### Stage 2 — BUILD (workflow)

Per wave:

- Lane agents launch in parallel. Each brief = story + acceptance criteria +
  `get_minimal_context` for its fence + the fence allowlist + test-first discipline where criteria
  are testable.
- Per-agent close gate **in JS**: `git diff` confined to the fence (diff-tree vs allowlist — the
  crg-ui post-verify pattern), then profile build/typecheck exit codes.
- Wave gate: full gate command, real exit code; 0 tests ran = red (crg-integrations rule).
- Red lane → model ladder: next strictly-higher tier, one shot per tier, escalation brief carries
  the failed attempt's verify evidence (house pattern). Fence violation = red + tree restored to
  the wave's porcelain baseline.
- Green wave → commit on `crg-ralph/build-<slug>` (allowlist-verified), graph re-ingested so later
  waves plan against reality, not the pre-run graph. **Never pushed.**

### Stage 3 — SWEEP → GATE-SWEEP

Compose the existing engine, don't rebuild it: `crg-debug.js` with `fix:false`, scoped to the run's
diff (the file set actually committed). Confirmed regressions → GATE-SWEEP → approved ones fixed
via the existing `fromLedger` fix mode. This is crg-build's STABILIZE inverted: stabilize *after*
construction instead of before.

### Stage 4 — ACCEPT + report

Acceptance criteria re-checked by harness-owned verification (Ralph's three-layer completion, but
"verified" is exit codes + a fresh agent the *harness* dispatches, not one the builder self-reports
to). Report: stories built with commit hashes, unbuilt with stall reasons, sweep results, the
explicit nothing-was-pushed line. Campaign records via the farm-db machinery
(`CRG_FARM_DB=<repoRoot>/.crg-ralph/campaign.jsonl`).

## Entry points

```
/crg-ralph "add multi-tenant billing"       # full: plan → gate → build → sweep → accept
/crg-ralph path/to/army-prd-dir             # ingest an existing Army PRD, graph-verify its plan, build
/crg-ralph "..." --plan-only                # stop after GATE-PLAN; emit the PRD dir for the ralph CLI
/crg-ralph --from-plan .crg-ralph/plan.json --stories s1,s3   # cross-session build entry
/crg-ralph "..." --max-tier sonnet          # cap the lane escalation ladder
/crg-ralph "..." --prose                    # force prose orchestration
```

## Reused vs new

| Reused | New |
|---|---|
| graph MCP, `crg-deterministic` enabler, farm-db, ledger-slice | `lib/ralph-plan.mjs` — deterministic wave packer |
| fence enforcement via diff-tree (crg-ui), porcelain restore | `skills/crg-ralph/SKILL.md` + `methodology.md` |
| wave commit + re-ingest machinery (crg-debug / crg-build) | `workflows/crg-ralph.js` |
| crg-debug composition for the sweep (`fix:false` → `fromLedger`) | Army-PRD ingester (existing-PRD entry point) |
| model ladder + escalation-evidence pattern | |

## Interop contract with army-of-ralph

The emitted PRD dir is **standard Army format** — `ralph` runs it with zero knowledge of CRG. The
graph extras (fences as explicit file lists in owned-paths, per-lane context briefs) are additive.
army-of-ralph takes no dependency on crg-debug; crg-ralph takes none on the `ralph` CLI (the
Workflow is its own runner; the CLI is an alternative consumer of the plan).

## Open questions

- **Story decomposition**: reuse the `/prd` skill's story format verbatim (interop for free) vs a
  leaner internal shape the packer prefers. Leaning: `/prd` format, since the PRD dir is the seam.
- **Greenfield-heavy features**: when most stories create new files, the graph contributes less to
  packing — claims dominate. Acceptable; the fence enforcement still holds the disjointness.
- **Wave packer inputs**: predicted file sets are fallible. Mitigation is already in the design —
  a wrong prediction becomes a loud fence violation at build time, never silent corruption.
