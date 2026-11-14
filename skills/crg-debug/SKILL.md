---
name: crg-debug
description: CRG-driven parallel debug + fix sweep. Builds/refreshes the code-review-graph, maps hotspots, fans out parallel discovery over disjoint concerns, verifies adversarially, and fixes confirmed bugs in TDD waves over file-disjoint sets. Each validated wave is committed on a crg-debug/fix-* branch and the graph re-ingested; never pushed. Use for /crg-debug, "debug this repo with CRG", "graph-driven bug sweep".
argument-hint: "[repo path] [focus area/file/issue] [--issue <ref>] [--detect-only] [--from-ledger <path>] [--prose] [--model <name>] [--discover-model <name>] [--verify-model <name>] [--fix-model <name>]"
user_invocable: true
---

# CRG Debug

Graph-driven debugging in one invocation: build the graph → map hotspots → find bugs in parallel →
fix them in disjoint waves → verify → document. Each validated wave is committed on a
`crg-debug/fix-*` branch off the current HEAD (only that wave's own files) and the graph
re-ingested. **Never push**; the user's own branch is never committed to.

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
- **stageModels**: `--discover-model <name>`, `--verify-model <name>` and `--fix-model <name>` each put
  one stage on its own model (`session` inherits the session model). Collect the flags that were given
  into `stageModels`, keyed `discover` / `verify` / `fix`: `--discover-model haiku --verify-model sonnet`
  is `stageModels: { discover: 'haiku', verify: 'sonnet' }`. A stage with no flag gets no key and runs on
  `model`, which stays the fallback for every stage. Discover is the finders and the merge of what they
  found, Verify the two reviewers of each finding and the ledger write, Fix everything from the first
  fix to the final gate.
- **fix**: `true` by default. `--detect-only` sets `fix=false` (read-only ledger, no edits).
- **fromLedger**: `--from-ledger <path>` ingests a prior run's `.crg-debug/ledger.json` and skips
  Discover. If the ledger lists findings as `unreviewed`, the run reviews those first and saves the
  ledger again; then Phase 4 fixes the confirmed bugs. Implies `fix=true`; pass the absolute path.
  With `--detect-only` as well (`fix=false`) it only finishes the review.

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
   Workflow({ name: 'crg-debug', args: { repoRoot, scope, model, stageModels, fix, issueContext, issueRef, methodologyPath, fromLedger } })
   ```

   Pass the resolved `model` (`haiku` unless overridden); pass `stageModels` only when a stage flag
   was given, with exactly the keys of the flags given (the Workflow refuses a key it does not know
   rather than run a stage on the wrong model); pass `issueContext`/`issueRef` only when
   an issue was given; set `methodologyPath` to the installed methodology's absolute path
   (`$HOME/.claude/workflows/crg-debug.methodology.md`) so the workflow's agents can read it. It
   runs in the background; tell the user they can watch live progress with `/workflows`.
   The Workflow writes and reads the ledger with a `node` command, so `node` must be on the PATH.

2. Otherwise (no workflow installed, or `--prose`) → **read `methodology.md` from this skill's
   directory and execute it as the main-loop orchestrator** — parallel `Agent` waves per its
   *Execution mode* section (each `Agent` call on its stage's model: the stage's flag when one was
   given, else the resolved `model` — `haiku` unless overridden),
   honoring every cross-cutting rule (TDD discipline, false-positive guard, fail-safe-defaults lens,
   git & safety policy, report layout) verbatim.

To upgrade prose → deterministic, run the bundled `crg-deterministic` command once.

## After it returns

Relay the ledger: confirmed bugs by severity, deferred (intentional), rejected false positives,
findings left unreviewed, the fix-wave outcome (fixed / unfixed / needs-human), the fix branch + wave commits, and the final gate
status. When a stage flag was given, say which model each stage ran on (`models` in the return).
Nothing was pushed. Offer to merge the fix branch back (or run `/cpdv`), and note any
leftover uncommitted work (a failed or opted-out commit) still sitting in the tree.

**Findings nobody reviewed.** A Workflow run may start 1,000 agents. When that is not enough to give
every finding its two reviewers, the highest-ranked are reviewed and the others come back in
`unreviewed`, each with an `unreviewedReason`: `agent limit`, or `no verdict` when both of its
reviewers returned nothing. They are in no other bucket: not confirmed, not rejected, not deferred.
When `unreviewed` is not empty, say how many there are and why, and that
`/crg-debug --from-ledger <ledgerPath> --detect-only` reviews them (without `--detect-only` it then
fixes what is confirmed). A fix run from a ledger reviews them first on its own. Bugs in
`fix.unfixed` whose `reason` is `agent limit` were not attempted, not failed: the same
`--from-ledger` run fixes them. When `ledgerSaved` is `false`, say first that the ledger was not
written, with the reason from the run's log: there is then no file to run again from, and whatever
is at `ledgerPath` may be a prior run's.

**A ledger that is not what it says.** The ledger carries `counts`, the number of rows in each of
its four buckets, written by the Workflow. A `--from-ledger` run stops before any work, with
`fix-from-ledger: could not read/parse ledger at <path> — <why>`, when the file does not hold the
rows its `counts` say, when a row in any bucket has no `file` or no `rootCause` (that is a note, not
a finding), or when the read did not come back whole after one more try. Relay the reason as given;
do not retry with an edited file. To fix only some confirmed bugs, narrow the ledger with
`crg-debug.ledger-slice.mjs`, which keeps `counts` true; rows deleted by hand leave it false. A
ledger written before `counts` existed is accepted, and the run logs that it could not be checked.

**Tests that were already failing.** When `fix.finalGate.alreadyFailing` is not empty, name every
test in it, with its command, beside the final gate status, as failing before the first fix. A
green final gate does not cover them: a test that was already failing cannot show that a fix broke
it in a new way. Say also what `fix.finalGate.notChecked` lists, and for a red gate what
`newFailures` and `fewerPassed` hold.

**Fixes that need a decision.** End the report with every row of `fix.needsDecision`. These are
fixes that passed their own test but could only stand by changing or breaking a test that already
existed. The Workflow never changes an existing test on its own: it took each of these fixes back
and saved it as a commit on no branch. For each row show the bugs, the `reason`, the existing
test's changed lines (`existingTests[].changed`, old and new; when that is `null`, read them with
`git show <ref> -- <path>`), the `failingTests`, and the `apply` command exactly as given. Show
`fixerClaim` under the words "the fix agent's claim" — it is the agent's stated ground, not a
checked fact. Do not run `apply` yourself and do not count these as fixed or as unfixed: the
person decides whether the test or the fix is wrong.
