# crg-ui-prep — Item Contract

The per-item contract for the prep loop. Source of truth for *what each item buys* is
`docs/crg-ui/perfect-user.md`; this file adds what the skill needs to act: the audit
check, the fix path, who executes it, effort, and dependencies.

**Fix modes:** `figma-gen` = the skill mutates the Figma file via the figma MCP (always
gated, never bulk-silent) · `code` = the skill edits the repo (always shown as a diff
first) · `guide` = human-only (licensing, auth, installs); the skill supplies exact
commands and verifies afterward.

**Effort labels:** `min` (< 15 min) · `hour` (one sitting) · `project` (real refactor —
descoping or delegating is a legitimate door).

## §1 Figma file

| ID | Item | Audit check | Fix path | Mode | Effort | Needs |
|----|------|-------------|----------|------|--------|-------|
| 1.1 | Design file covers every in-scope screen | `get_metadata` returns top-level frames; frame count vs route count | Bootstrap gate: paste a URL / `generate_figma_design` from the live app (bless in Figma before it becomes the oracle) / exit to `/crg-build` | figma-gen | hour | E2 |
| 1.2 | Frame names follow `<Screen> / <Breakpoint>` | Run the pairer (`ui-map.mjs pair`) against the draft profile; report paired/unmatched | Propose a full rename table (old → new, from routes + frame widths); apply via `use_figma` batch rename only on approval | figma-gen | min | 1.1, 2.6 |
| 1.3 | Frames at exact device sizes, one frame = one screen state | Every paired frame's width ∈ the breakpoint set exactly | Propose resize list; apply via `use_figma` | figma-gen | min | 1.2 |
| 1.4 | All colors/type/spacing bound to Figma variables | `get_variable_defs` non-empty; spot-check `get_design_context` on 2–3 frames for detached hex/px literals | Create variables from the observed styles and bind fills/type/spacing (`figma-generate-library` flow); show the variable table before applying | figma-gen | hour | 1.1 |
| 1.5 | Variable names mirror the code's tokens | String-map coverage: each Figma variable ↔ a code token (`--color-primary` ↔ `color/primary`) | Read the code's token file, propose the rename map, apply via `use_figma` variable renames | figma-gen | min | 1.4, 2.4 |
| 1.6 | Real components for repeated elements | `get_metadata`: repeated same-name GROUPs where COMPONENT/INSTANCE expected | Propose componentization list; convert via `use_figma` | figma-gen | hour | 1.1 |
| 1.7 | Code Connect map published | `get_code_connect_map` non-empty for the file | `get_code_connect_suggestions` → confirm pairs → `add_code_connect_map` | figma-gen | min | 1.6, 2.3 |
| 1.8 | Icons/images marked for export | Export settings present on asset nodes (read via `use_figma`) | Propose asset list; set export settings via `use_figma` | figma-gen | min | 1.1 |
| 1.9 | Fonts identified and licensed for local install | Enumerate font families used in the file; check `~/Library/Fonts`, `/Library/Fonts` (or `fc-list`) | List missing fonts + where to license them; verify after the human installs (→ E4) | guide | min–$ | 1.1 |

## §2 Repository

| ID | Item | Audit check | Fix path | Mode | Effort | Needs |
|----|------|-------------|----------|------|--------|-------|
| 2.1 | Unambiguous stack (v0.1: react in one clean manifest) | Manifest scan; multiple app manifests → ambiguous | Usually audit-only; monorepo → record the target app path in the draft profile | code | min | — |
| 2.2 | Documented dev command that boots in dev mode | justfile / package.json script exists; curl the dev URL after boot | Write the script; record `devCommand` + `devUrl` + `readyTimeoutSec` in the draft profile | code | min | — |
| 2.3 | `data-component` (or `data-testid`) on component roots | Grep component files for the attribute; coverage % over the CRG component list | Codemod: add `data-component="<Name>"` to each root (CRG graph supplies the component list); show the diff | code | hour | 2.8 |
| 2.4 | Centralized design tokens, one source of truth | Token file exists (CSS custom props / Tailwind config); count raw hex/px literals in components | Scoped refactor: hoist literals into the token file. `project`-sized → offer delegation (its own run) or explicit descope | code | project | — |
| 2.5 | Deterministic render seams: mock/seed data, animation-disable, frozen clock | Grep for the flags; two identical screenshots of the busiest screen | Add the three seams behind env flags; record them in the draft profile fences | code | hour | 2.2 |
| 2.6 | Routes manifest (route → screen name) | Manifest file or router source parseable into the list | Write the manifest; feeds `screens[]` in the draft profile and the 1.2 rename table | code | min | — |
| 2.7 | Storybook (optional) | `.storybook/` exists | Offer `storybook init` scoped to the paired components. Never pushed — optional means optional | code | project | 2.3 |
| 2.8 | CRG graph built and fresh | `.code-review-graph/` exists; `list_graph_stats` fresh vs HEAD | `code-review-graph build` (or `update`) | code | min | — |
| 2.9 | Auth seam for protected routes | Protected routes in the manifest have a `tokenCmd` | Document the `tokenCmd` pattern (crg-build parity); token minted at run time, never stored | code | hour | 2.6 |

## §3 Environment

| ID | Item | Audit check | Fix path | Mode | Effort |
|----|------|-------------|----------|------|--------|
| E1 | `uv` on PATH | `command -v uv` | Install command (`brew install uv` / official script) | guide | min |
| E2 | Figma MCP authenticated with file access | `whoami` succeeds; `get_metadata` on the file succeeds | Walk through MCP auth; re-verify | guide | min |
| E3 | Playwright browsers + device descriptors | `npx playwright --version`; browsers dir present | `npx playwright install` | guide | min |
| E4 | Design fonts installed locally (the files, not lookalikes) | 1.9's font list vs installed fonts | Human installs (licensing is theirs); skill re-verifies | guide | min |
| E5 | Fixed display scale for measurement runs | DPR recorded in the draft profile | Record `dpr` in the draft profile (not inherited from the host display) | code | min |

## Loop order (dependency-sorted leverage)

```
 0. 1.1  oracle exists            (bootstrap gate — nothing else matters without it)
 1. E1–E3, E5                     (blockers: the audit itself needs E2)
 2. 2.2  dev command   · 2.8 CRG graph        (quick wins; 2.8 unlocks 2.3)
 3. 2.5  render seams             ★
 4. 2.3  data-component           ★
 5. 2.4  centralize tokens        (project-sized; delegate or descope explicitly)
 6. 1.4  bind to variables        ★
 7. 1.5  mirror token names       ★  (needs 1.4 + 2.4)
 8. 1.2 + 2.6  frame naming + routes manifest ★ (ONE paired step — same screen names)
 9. 1.3  exact frame sizes
10. 1.6  componentize
11. 1.7  Code Connect
12. 1.8  export marks
13. 2.9  auth seam
14. 1.9 → E4  fonts (identify, license, install)
15. 2.7  Storybook (optional — offer once, drop it)
```

★ = the five highest-leverage items (perfect-user.md): they convert the noisiest
model-dependent steps into deterministic lookups. `--top5` scope = steps 3–8.
