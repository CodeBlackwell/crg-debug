---
name: crg-ui
description: Converge a live implementation toward its Figma design with a deterministic numeric oracle — capture Figma frame geometry + variables and the live DOM at matched viewports, measure geometry/token/typography deltas per element (a tool computes every delta, never an agent), gate the ranked discrepancy ledger with the human, then fix approved discrepancies in sequential verified units committed on a crg-ui/fix-* branch (never pushed). Use for /crg-ui, "pixel-perfect this against Figma", "converge the UI to the design", "measure design drift".
argument-hint: "[figma-url] [repo path] [--measure-only] [--from-ledger <path> --keys <k,...>|--ids <id,...>] [--model <name>] [--max-tier <tier>] [--prose]"
user_invocable: true
---

# CRG UI

Turns the crg core toward **design convergence**: the Figma file is the oracle, the live
app is the subject, and a deterministic measure tool is the judge. Two machines over one
methodology (`methodology.md`, in this skill's directory):

```
PROFILE (first run, GATE-PROFILE) → BOOT (skill-owned dev server)
  → MEASURE (crg-ui.js) → GATE-LEDGER → REPAIR (crg-ui.js, sequential verified units)
  → GATE-DONE (report; commits on crg-ui/fix-*, never pushed)
```

**MEASURE is read-only and stops on its own.** REPAIR runs ONLY over discrepancies a
human approved at GATE-LEDGER. The oracle is never invented silently: no Figma input →
the bootstrap gate below, never a guess. Read `methodology.md` first — it is the
judgment contract; the Workflow's JS owns enforcement.

**Prerequisite (deterministic mode):** `$HOME/.claude/workflows/crg-ui.js` installed by
the bundled `crg-deterministic` enabler. Absent, or `--prose` passed → **prose mode**:
execute `methodology.md` phase by phase in the main loop, running the lib tools
directly via Bash and reading their output yourself (no agent relays), honoring every
non-negotiable verbatim — the methodology's *Execution mode* section is the dispatch.

## Parse `$ARGUMENTS`

- **figmaUrl**: a figma.com URL anywhere in the args → extract the file key (and node id
  if present). Absent on a first run → the bootstrap gate in Stage 0.
- **repoRoot**: an explicit path wins; else `git rev-parse --show-toplevel`; else STOP and ask.
- **measureOnly**: `--measure-only` ends the run at GATE-LEDGER with the ledger as the
  deliverable.
- **fromLedger / keys / ids**: `--from-ledger <path> --keys <k,...>` (or `--ids
  <slug.d-nnn,...>` — ledger ids are cell-qualified) is the cross-session REPAIR entry;
  the slice tool resolves the selection, never an agent. Same-session, pass the measure
  return's discrepancy objects verbatim instead.
- **model / maxTier**: forwarded to the Workflow (`haiku` run default; `opus` maxTier
  default). Same semantics as /crg-farm.

## Stage 0 — PROFILE (first run) → GATE-PROFILE (HARD)

Load `<repoRoot>/.crg-ui/profile.json`; validate with
`node $HOME/.claude/workflows/crg-ui.map.mjs validate <path>` — fix-or-stop on errors.
If valid, show a one-line summary and proceed (re-runs never re-ask answered questions).

If absent, INTAKE computes everything computable, then ONE gate resolves the rest:

1. **Repo scan** (one agent): stack from the manifest (v0.1 requires `react`; anything
   else → report the adapter gap and STOP), dev command + URL from
   justfile/package.json, routes, whether a `data-component`/`data-testid` convention
   exists, token sources.
2. **Figma scan** (one agent, only if a URL was given): `get_metadata` for the file's
   top-level frames → write `frames.json`, then
   `node $HOME/.claude/workflows/crg-ui.map.mjs pair frames.json <draft-profile>` for
   the convention pairing (`<Screen> / <Breakpoint>`).
3. **GATE-PROFILE**: show the pre-filled draft — stack, dev command, mode (inferred
   from which breakpoints the frames cover; ask only if ambiguous), the pairing table
   with confidence + orphans, fences, tolerance (default 1px). Every missing thing gets
   the three doors: **supply / propose-for-approval / descope-explicitly**. Approve /
   edit / abort — only on approval write the file. Never auto-passed.

**No Figma URL at all** → the bootstrap gate: (a) paste one, (b) propose frames INTO
Figma from the live app (`generate_figma_design`, opus) for the human to bless in Figma
first — only a blessed file becomes an oracle, or (c) exit, pointing at `/crg-build`'s
rubric UX review as the no-oracle alternative.

Also write `<repoRoot>/.crg-ui/allowlist.json` = the profile's `intentionalDeviations`
(the measure tool reads it; keep the two in sync whenever the gate blesses a deviation).

## Stage 1 — BOOT (skill-owned)

The Workflow never starts or stops a daemon. `Bash(stack.devCommand, run_in_background:
true)` with cwd `repoRoot`, then
`node $HOME/.claude/workflows/crg-ui.map.mjs waitup <stack.devUrl> --timeout <readyTimeoutSec>`
— exit 0 is ready; exit 1 → show the boot log tail, STOP.
On a later `status:'app-down'` return: restart, re-invoke ONCE; a second app-down stops
the run with the reason.

## Stage 2 — MEASURE

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-ui.js',
  args: { repoRoot, profile, runtime: { devUrl: stack.devUrl }, model, maxTier,
          profilePath: '<repoRoot>/.crg-ui/profile.json',
          allowlistPath: '<repoRoot>/.crg-ui/allowlist.json',
          validatorPath: '$HOME/.claude/workflows/crg-ui.map.mjs',
          measureToolPath: '$HOME/.claude/workflows/crg-ui.measure.mjs',
          collectToolPath: '$HOME/.claude/workflows/crg-ui.collect.js',
          methodologyPath: '$HOME/.claude/workflows/crg-ui.methodology.md' } })
```

Await the return. Early-bail statuses are handed back for YOU to resolve — never
proceed past them: `profile-invalid` (re-open GATE-PROFILE) · `graph-failed` (fix the
graph, re-invoke) · `app-down` (Stage 1 restart rule) · `figma-unreachable` (check
`whoami` / file access) · `no-cells` / `capture-failed` (report and stop). On
`status:'measured'` you get `{ledgerPath, discrepancies, allKeys, unmatched, stats}`.

## Stage 3 — GATE-LEDGER (HARD)

Show the ledger grouped by class, then screen — per discrepancy: id, severity,
component/token, expected vs actual, delta. Show `unmatched` as mapping debt
(remedy: naming, not fixes) and a font-mismatch epidemic as ONE environment finding.
Options: approve-all / select-subset / mark-intentional / measure-only. Marking
intentional runs
`node $HOME/.claude/workflows/crg-ui.map.mjs bless <profile.json> --entry '<json>' --allowlist <allowlist.json>`
with `{screen, class, figmaNodeId|token, reason}` — ONE command writes the profile and
rewrites `allowlist.json` from it (never edit the two separately). `--measure-only` or
an empty approval ends the run here.

## Stage 4 — REPAIR (approved only)

```
Workflow({ scriptPath: '$HOME/.claude/workflows/crg-ui.js',
  args: { repoRoot, profile, runtime, model, maxTier,
          approvedDiscrepancies: [<the measure return's objects, verbatim>],
          allKeys: [<the measure return's allKeys, verbatim>],
          allowlistPath, measureToolPath, collectToolPath, methodologyPath } })
```

Pass the discrepancy objects and `allKeys` byte-exact through args — a ledger re-read
through agents gets transcription-mangled. `--from-ledger <path> --keys <k,...>` (or
`--ids`) is the cross-session fallback, forwarded as `fromLedger` + `approvedKeys` /
`approvedIds`: the workflow resolves it with the slice tool under a seal check. Await
`{fixed, unfixed, branch}`. Units were verified by re-measure (keys resolved AND no
regressions, seal-checked relays), committed per green unit on the `crg-ui/fix-*`
branch, and each commit post-verified against the fence allowlist via `git diff-tree`.
A `status:'tree-dirty'` return means the run stopped because the working tree could
not be restored to its baseline — show the reason and hand the branch to the human.
Verify nothing was pushed (`git log @{push}..` non-empty, or no upstream).

## Stage 5 — GATE-DONE

Report per the methodology's layout. Offer: re-measure (a second convergence pass over
what remains), merge guidance for the fix branch (or `/cpdv`), or done. Leave the app
running and tell the user how to stop it. The durable record lives in
`<repoRoot>/.crg-ui/` (profile, allowlist, captures, ledger).
