---
name: crg-integrations
description: Graph-driven repair harness for a project's host/scenario integration matrix — register/refresh the code-review-graph, ingest the red cells, retry away flakes, cluster by failure signature, classify each cluster (regression | drift | under-dev | flake) deterministic-first, and screen drift by asymmetric pixel stats into a human-gated re-bake queue, stopping with a triage ledger. Human-approved regression clusters are then diagnosed against the graph, fixed in fenced worktrees, verified by re-running the exact cell (exit code AND ran-test count), and gated against regressions. Never pushes; drift is never auto-re-baked. Use for /crg-integrations, "triage my integration matrix", "fix the docs-host matrix".
argument-hint: "[repo path] [--profile <path>] [--triage-only] [--from-ledger <path> --clusters <id,...>] [--from-matrix <path>] [--no-regen] [--model <name>] [--max-attempts <n>] [--prose]"
user_invocable: true
---

# CRG Integrations

Turns the crg core toward a project's **integration test matrix** — the host × scenario grid a docs
widget, SDK, or embed runs against. Two machines over one shared methodology
(`methodology.md`, in this skill's directory):

```
PROFILE (first run, GATE-PROFILE) → TRIAGE (crg-integrations.js phases 0-5) → GATE-CLUSTERS
  → REPAIR (crg-integrations.js phases 6-10) → GATE-REBAKE (drift queue) → report
```

**TRIAGE is read-only and stops on its own.** It classifies every red cell and persists a ledger;
it never edits code and never re-bakes a golden. REPAIR runs ONLY over clusters a human approved at
GATE-CLUSTERS, fixes them in isolated worktrees, and gates the run branch against regressions —
**never pushing**. The Graph phase is unconditional: there is no CRG opt-out.

**Prerequisite (deterministic mode):** `$HOME/.claude/workflows/crg-integrations.js` installed by
the bundled `crg-deterministic` enabler. Absent, or `--prose` passed → execute `methodology.md`
directly in the main loop (its *Execution mode* section), honoring every rule verbatim. The
Workflow's JS owns enforcement (signature normalization, clustering, grep building, the pixel bar,
the verify judge, the fence checks); `methodology.md` is the judgment contract.

## Parse `$ARGUMENTS`

- **repoRoot**: an explicit path wins; else the current `git rev-parse --show-toplevel`; else STOP
  and ask.
- **profile**: `--profile <path>` overrides the default `<repoRoot>/.crg-integrations/profile.json`.
- **triageOnly**: `--triage-only` forces a stop after TRIAGE even if you would otherwise loop (the
  default already stops at GATE-CLUSTERS; this is explicit intent for a read-only run).
- **fromLedger / clusters**: `--from-ledger <path> --clusters <id,...>` is the REPAIR entry — the
  gated output of a prior TRIAGE. Both are required together; pass the ledger's absolute path.
- **fromMatrix / noRegen**: `--from-matrix <path>` reads an existing matrix instead of regenerating;
  `--no-regen` skips the regen command and reads the profile's `artifacts.matrix`.
- **model** / **maxAttempts**: forwarded to the Workflow (`haiku` triage default; 2 fix attempts).

## Stage 0 — PROFILE (first run) → GATE-PROFILE (HARD)

Validate `<repoRoot>/.crg-integrations/profile.json` with
`node $HOME/.claude/workflows/crg-integrations.profile.mjs validate <path>` — fix-or-stop on errors.

If absent: dispatch ONE profiler agent to draft it — read the project's test config (Playwright
`playwright.config.*`, the runner's project/host definitions), its matrix/report artifacts, and its
per-host directories; produce the reference-schema shape in `methodology.md`'s terms (`schemaVersion:
1`, `commands{fullRun, singleCell, bootHost, regenMatrix, rebake, fingerprint}` with the required
placeholders, `grepTemplate`, `artifacts`, `matrixAdapter`, `oracleHost`, `hosts`, `fences`,
`concurrency`, `flakePolicy`, `drift`). Then **GATE-PROFILE**: show the draft (commands, oracle host,
fences, under-dev hosts) — approve / edit / abort. Only on approval write the file. Never auto-passed.

## Stage 1 — TRIAGE

```
Workflow({ name: 'crg-integrations',
  args: { repoRoot, profile, model, noRegen, fromMatrix,
          profilePath: '<the validated profile path>',
          validatorPath: '$HOME/.claude/workflows/crg-integrations.profile.mjs',
          methodologyPath: '$HOME/.claude/workflows/crg-integrations.methodology.md' } })
```

It runs in the background (`/workflows` to watch). Await the return. Early-bail statuses are handed
back for YOU to resolve — do not proceed past them:

- `profile-invalid` → the validator failed inside the run; re-open GATE-PROFILE.
- `graph-failed` → `code-review-graph build/update` returned non-zero; fix the graph, re-invoke.
- `oracle-red` → the golden oracle host is red; nothing downstream is trustworthy. Report it and
  STOP — the oracle must be green before any triage means anything.
- `matrix-invalid` / `fingerprint-missing` / `no-red-cells` / `all-flakes` → report and stop
  (the last two are clean outcomes: nothing to repair).

On `status:'triaged'` you get `{ledgerPath, clusters, regressionClusterIds, rebakeQueue, flakes}`.

## Stage 2 — GATE-CLUSTERS (HARD)

Show the triage ledger grouped by class: **regression** clusters (candidates for REPAIR, with their
signature, hosts, and confidence), **drift** clusters (with their queued re-bake commands — shown at
GATE-REBAKE, never here), **under-dev** and **flake** (informational). Ask which regression clusters
to repair (approve-all / select-subset / triage-only). `--triage-only` or an empty selection ends
the run here with the ledger as the deliverable.

## Stage 3 — REPAIR (approved clusters only)

```
Workflow({ name: 'crg-integrations',
  args: { repoRoot, profile, model, maxAttempts,
          fromLedger: '<ledgerPath>', approvedClusterIds: [...],
          methodologyPath: '$HOME/.claude/workflows/crg-integrations.methodology.md' } })
```

Await `{fixed, unfixed, needsHuman, branch, rebakeQueue}`. Fixes landed on a `crg-integrations/fix-*`
run branch inside the Workflow, each behind a re-run verify (exit code AND ran-test count) and a
full-matrix regression gate; the graph was re-`update`d. `needsHuman` clusters wanted a
`fences.sharedNeedsGate` file (e.g. `_shared/**`) — that is correct v1 behavior, not a failure:
shared-file fixes break host-local parallelism and are never auto-edited. Verify nothing was pushed
(`git -C <repoRoot> log @{push}..` non-empty, or no upstream).

## Stage 4 — GATE-REBAKE (HARD; always human)

If the ledger's `rebakeQueue` is non-empty, show each queued command (host, test, the exact
`--update-snapshots` command the Workflow EMITTED but never ran). Ask which goldens to re-bake
(none / select / all). Drift is never auto-re-baked — a re-bake overwrites the golden oracle's
reference, so it is always an explicit human act. Run only the approved commands yourself.

## After it returns

Report per the methodology's layout: the class breakdown, regression clusters fixed (with the run
branch + files) vs unfixed (with the stall reason), needs-human clusters, the drift re-bake queue
and what was baked, flakes dropped, and the explicit line that nothing was pushed. Flag any
under-dev host whose cells all came back green ("promote?"). Point at `<repoRoot>/.crg-integrations/`
(profile, ledger) for the durable record.
