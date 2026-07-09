# crg-ui — UX Flow & Permutative User Stories

Status: planning (2026-07-08). Companion docs: `perfect-user.md`, `implementation-plan.md`.

crg-ui converges a live implementation toward a Figma design using a layered oracle
(geometry → tokens → pixels → vision) over the code-review-graph. This document is the UX
contract: every input permutation a user can arrive with, and what the tool does about it.

Two invariants govern every story:

1. **crg-ui never invents its own oracle silently.** A missing design is always a gate,
   never a guess. Nothing is measured until an oracle exists that a human approved.
2. **Every run enters the same spine and differs only in which gaps the profile gate
   surfaces.** The user never picks a "mode" — they answer the questions their inputs
   left open.

## The spine (every story passes through this)

```
/crg-ui [figma-url] [path]
   │
   ▼
INTAKE (silent, computed)
   ├─ repo scan: stack? existing UI code? CRG graph fresh?
   └─ figma scan: frames found? breakpoint pairing guessable from names?
   ▼
GATE-PROFILE (the one conversation — pre-filled, asks ONLY what intake couldn't compute)
   ├─ confirm: stack, dev command
   ├─ ask if unknown: target mode (desktop-only / mobile-only / responsive / adaptive)
   └─ resolve: oracle gaps (missing file, missing breakpoints, unpaired frames)
   ▼
MAP → MEASURE → GATE-LEDGER → REPAIR waves → GATE-DONE
   (converged report; commits on crg-ui/fix-* branch, never pushed)
```

## The stories

### Story 1 — User runs with no Figma designs at all

*As a user with an app but no design file, I run `/crg-ui` bare.*

Intake finds code but no oracle. GATE-PROFILE says so plainly and offers exactly three
doors: **(a)** paste a Figma URL I forgot to provide, **(b)** *bootstrap the oracle* —
crg-ui reverse-generates Figma frames from my live app via `generate_figma_design`, I
review and edit them **in Figma**, and once I bless them they become the reference for
all future runs, or **(c)** exit, with a pointer to `/crg-build`'s rubric-based UX review
as the no-oracle alternative.

What (b) really buys: the first converge run scores near-perfect by construction — the
value is that the user now owns a design file that future code changes get graded against.

### Story 2 — User provides a Figma file, but frames the tool can't pair

*As a user whose designers name frames creatively, I run `/crg-ui <url>`.*

Intake finds frames but the name-convention pairer can only match some to routes and
breakpoints. GATE-PROFILE shows its guesses as a pre-filled table — "Home ↔ 'Homepage v3
FINAL' @ 1440, confirm?" — and the user fixes the orphans by hand or drops them from
scope. Unmapped frames are recorded as `unmapped` in the profile, reported, never
silently skipped.

### Story 3 — Desktop designs only, desktop-only intent

*As a user shipping an internal dashboard, I provide desktop frames and answer
"desktop-only" at the profile gate.*

The cleanest path: single-breakpoint matrix, full layered oracle, no interpolation
sweep, no device emulation. Ledger → gate → waves → converged. The profile records
`desktop-only` so no future run nags about mobile.

### Story 4 — Desktop designs only, but requests responsive

*As a user who wants mobile support the designers haven't drawn yet, I provide desktop
frames and answer "responsive."*

Intake flags the oracle gap; **GATE-MISSING-BREAKPOINT** offers three doors per missing
frame set: **(a)** supply real mobile frames and re-run, **(b)** crg-ui proposes mobile
frames via `generate_figma_design` from the desktop ones — *into Figma, for approval,
never straight into code* — or **(c)** descope to desktop-only for now, recorded so it's
a deliberate decision, not an oversight. Once resolved, the run proceeds as Story 7.
The tool never converges code toward a design no human has seen.

### Story 5 — Mobile designs only, but requests desktop/adaptive

*As a user of a mobile-first product, I provide 375px frames and want a desktop
experience.*

Exact mirror of Story 4 — same gate, same three doors, direction flipped. Its own story
because generate-in-the-other-direction (mobile → desktop proposals) is harder for the
generator, so the approval step matters *more*, not less; the methodology says so rather
than pretending symmetry.

### Story 6 — Both breakpoints, adaptive intent

*As a user whose designers drew genuinely different layouts per device, I provide both
frame sets and answer "adaptive."*

Full screens × breakpoints matrix, each cell measured at its frame's exact viewport with
real device descriptors. The no-breakage sweep runs *within* each design's declared
range but **not across the switch boundary** — adaptive layouts are allowed to differ
discontinuously there, so cross-boundary comparison would be a false positive by design.
Cross-breakpoint no-regression discipline still applies to every fix wave.

### Story 7 — Both breakpoints, responsive intent

*As a user with one fluid codebase, I provide both frame sets and answer "responsive."*

Everything in Story 6 **plus** the interpolation invariant sweep between the designed
breakpoints — no overflow, no overlap, no clipped text at widths where no oracle exists.
`responsive-breakage` findings land in the same ledger next to pixel discrepancies,
ranked together. The most complete measurement the tool can do; the profile gate is
still the only conversation before the ledger gate.

### Story 8 — Greenfield: designs exist, code doesn't

*As a user starting a new screen, I provide frames for a route that has no
implementation.*

Intake detects the absence; the gate confirms stack (the one case where "React or
Angular?" is a real question) and routes those screens through **generate-first** —
`get_design_context` scaffolds the implementation — then feeds them into the same
MEASURE → REPAIR loop as everyone else for the last mile. Mixed repos work per-screen:
existing screens converge, missing screens generate-then-converge, one ledger.

### Story 9 — User is great and provides everything as hoped for

*As the ideal user, I provide a Figma file with conventionally named frames for every
screen at every breakpoint, tokens as Figma variables, an existing Code Connect map, and
a repo whose stack detection is unambiguous.*

Intake computes everything; GATE-PROFILE degenerates to a single confirmation screen
with zero open questions — stack ✓, pairing ✓, mode inferred from the frame sets ✓.
Two gates total for the whole run: one "yes, that profile is right," one ledger
approval. Everything else is the machine converging and reporting.

**This story is the UX north star: the gates never get simpler by asking less — they get
simpler because the inputs answered more.** See `perfect-user.md` for the full checklist
that puts a user here.

## Permutation grid

| | No designs | One breakpoint | Both breakpoints |
|---|---|---|---|
| **Matching single-target intent** | Story 1/2 (bootstrap or exit) | Story 3 (clean converge) | — (over-provided: extra frames just descope) |
| **Responsive/adaptive intent** | Story 1 then 4 | Stories 4/5 (gap gate) | Stories 6/7 (full matrix) |
| **No code (greenfield)** | Story 1(b) is meaningless — nothing to reverse-generate; exit | Story 8 + gap gate | Story 8 (generate → converge) |

## UX rules pinned by these stories

1. **Every "missing thing" gate offers the same three-door shape** — *supply it / let me
   propose it for your approval / descope it explicitly* — so users learn the pattern once.
2. **Every descope and every approved proposal is written into the profile**, so re-runs
   never re-ask a question the user already answered. This rule is what turns Story 1's
   user into Story 9's user without ever filling out a form.
