---
name: crg-debug
description: CRG-driven parallel debug + fix sweep. Builds/refreshes the code-review-graph, maps hotspots, fans out parallel discovery over disjoint concerns, verifies adversarially, and fixes confirmed bugs in TDD waves over file-disjoint sets. Nothing is committed. Use for /crg-debug, "debug this repo with CRG", "graph-driven bug sweep".
argument-hint: "[repo path] [focus area/file/issue] [--issue <ref>] [--detect-only] [--prose] [--model <name>]"
user_invocable: true
---

# CRG Debug

Graph-driven debugging in one invocation: build the graph → map hotspots → find bugs in parallel →
fix them in disjoint waves → verify → document. Fixes land in the working tree; **nothing is
committed unless the user asks.**

This skill has two orchestration modes over **one shared methodology** (`methodology.md`, in this
skill's directory):

- **Deterministic (preferred when available)** — the `crg-debug` Workflow (`crg-debug.js`), where the
  JS owns every gate (phase order, concern partitioning, dedup, wave packing, loop termination,
  per-bug close gates as exit codes it reads). Installed by the bundled enabler (see below).
- **Prose (always available)** — you, the main loop, execute `methodology.md` directly: dispatch each
  phase's work items as ONE parallel wave of `Agent` calls, barrier, then proceed.

## Parse `$ARGUMENTS`

- **repoRoot**: an explicit path or `--repo <path>` wins; else the current `git rev-parse --show-toplevel`.
  If cwd is not a git repo and no path was given, STOP and ask for the repo path.
- **scope**: any non-flag text — the focus area, file, or issue. Empty = full-repo sweep.
- **issue**: `--issue <ref>`, OR a GitHub issue auto-detected in the non-flag text — a full
  `https://github.com/<owner>/<repo>/issues/<n>` URL, `<owner>/<repo>#<n>`, or a bare `#<n>`
  (bare resolves against the repo's `origin` remote). See *Resolve the issue* below.
- **model**: defaults to `haiku`. `--model <name>` overrides it (e.g. `--model opus`); `--model session` inherits the session model.
- **fix**: `true` by default. `--detect-only` sets `fix=false` (read-only ledger, no edits).

## Resolve the issue (only if an issue ref was given)

Classify the input with the bundled parser (installed by the enabler), then set `issueContext`
(issue body → fed to the sweep) and `issueRef` (short provenance):

```
node ~/.claude/workflows/crg-debug.issue-ref.mjs "<input>" "$(git -C <repoRoot> remote get-url origin 2>/dev/null)"
```

It prints JSON `{kind, ref, owner, repo, number, url}`. (If that file is absent — prose-only
install — classify by the same rules: `#n` / `owner/repo#n` / an `…/issues/<n>` URL → GitHub,
else paste.)

- **kind `github`** → fetch it:
  `gh issue view <number> -R <owner>/<repo> --json title,body,state,labels,url,comments`
  (omit `-R` when `owner`/`repo` are absent — `gh` resolves against the repo's origin). Assemble
  `issueContext` from title + state + labels + body (+ the most relevant comments), trimmed to
  ~4 KB; set `issueRef` to the parser's `ref` (+ `url`). If `gh` fails (not authed, issue/repo
  not found) **STOP and report the error** — do not silently fall back to a full sweep.
- **kind `paste`** → use the parser's `text` verbatim as `issueContext`, a short label as
  `issueRef`. No `gh` call. Covers Jira/Linear/etc. by pasting the ticket text.
- **kind `empty`** → no issue; leave `issueContext`/`issueRef` unset.

When `issueContext` is set it is the focus: an empty `scope` is resolved from the issue; a given
`scope` narrows while the issue describes the symptom.

## Route

1. If `~/.claude/workflows/crg-debug.js` exists AND `--prose` was NOT passed → run the deterministic
   Workflow (this instruction is the explicit opt-in):

   ```
   Workflow({ name: 'crg-debug', args: { repoRoot, scope, model, fix, issueContext, issueRef } })
   ```

   Pass the resolved `model` (`haiku` unless overridden); pass `issueContext`/`issueRef` only when
   an issue was given. It runs in the background; tell the user they can watch live progress with
   `/workflows`.

2. Otherwise (no workflow installed, or `--prose`) → **read `methodology.md` from this skill's
   directory and execute it as the main-loop orchestrator** — parallel `Agent` waves per its
   *Execution mode* section (each `Agent` call on the resolved `model` — `haiku` unless overridden),
   honoring every cross-cutting rule (TDD discipline, false-positive guard, fail-safe-defaults lens,
   git & safety policy, report layout) verbatim.

To upgrade prose → deterministic, run the bundled `crg-deterministic` command once.

## After it returns

Relay the ledger: confirmed bugs by severity, deferred (intentional), rejected false positives, the
fix-wave outcome (fixed / unfixed / needs-human), and the final gate status. Nothing was committed —
fixes are in the working tree. Offer to commit (named files only) or run `/cpdv`.
