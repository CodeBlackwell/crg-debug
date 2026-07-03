---
name: crg-agentsmd
description: Farm a measured AGENTS.md draft from a repo's review history. Mines the fossil record (PR review threads, diff evolution, git archaeology) for the tacit rules maintainers actually enforce, adversarially verifies every rule, scores the survivors against a held-out slice of real review corrections, and synthesizes a draft ordered by measured predictive value. Never commits, never posts. Use for /crg-agentsmd, "mine an AGENTS.md", "what do this repo's reviewers actually enforce".
argument-hint: "[repo path] [--score-only] [--mine-only] [--from-corpus] [--score-sample <n>] [--ab] [--model <name>] [--prose]"
user_invocable: true
---

# CRG AgentsMD

An instrument, not a generator: it mines what a repo's reviewers actually enforce and **measures**
which parts a generic guide wouldn't cover. Accuracy gates rules (verbatim cited evidence at the
schema boundary, counterexample hunt, restatement detection, executability); effectiveness gates
the file (a stratified ~20% of reviewed PRs is held out at corpus time — miners never see it — and
judges replay every held-out human review correction against the surviving rules; zero-predictive
rules are cut). Pilot calibration, one repo: mined draft covered 24% of held-out corrections vs 12%
for a length-matched generic placebo; a 3-PR implementation A/B showed **no** lift over placebo.
Sell it as "documents measured reviewer norms", never as "makes agents build better code".

A repo with fewer than ~30 reviewed PRs returns `thin-corpus` — an honest "not enough fossil
record", not a padded guess.

Two orchestration modes over one methodology (`methodology.md`, this directory): the deterministic
Workflow (`crg-agentsmd.js`, installed by the bundled `crg-deterministic` enabler) or prose
execution of the methodology by the main loop.

## Parse `$ARGUMENTS`

- **repoRoot**: explicit path wins; else `git rev-parse --show-toplevel`. Not a git repo and no
  path → STOP and ask.
- **stages**: default = both stages chained (mine, then score + draft). `--mine-only` stops at the
  verified ledger; `--score-only` skips mining and scores the existing
  `<repoRoot>/.crg-agentsmd/ledger.json`.
- **--from-corpus**: reuse an existing `<repoRoot>/.crg-agentsmd/corpus/` instead of re-fetching.
- **--score-sample <n>**: judge an unbiased stride sample of n held-out comments (cheap iteration;
  default = the full holdout).
- **--ab**: after a scored draft exists, run the three-arm implementation A/B (no-file / placebo /
  mined over 3 held-out PRs). EXPENSIVE — ~25 agents, arm agents are full implementation runs;
  confirm with the user before launching unless they asked for it explicitly.
- **model**: defaults to `sonnet`. `--model <name>` overrides; `--model session` inherits.

## Route

Installed paths (all under `$HOME/.claude/workflows/`): `crg-agentsmd.methodology.md`,
`crg-agentsmd.corpus.mjs`, `crg-agentsmd.score.mjs`, `crg-agentsmd.ab.mjs`.

1. If `~/.claude/workflows/crg-agentsmd.js` exists AND `--prose` was NOT passed:

   **Mine stage** (skip under `--score-only`):
   ```
   Workflow({ name: 'crg-agentsmd', args: { repoRoot, methodologyPath, corpusToolPath, model, fromCorpus } })
   ```
   It ends at status `mined` with `<repoRoot>/.crg-agentsmd/ledger.json` (or `thin-corpus`). Runs in
   the background — the user can watch with `/workflows`.

   **Score stage** (after `mined`; skip under `--mine-only`):
   ```
   Workflow({ name: 'crg-agentsmd', args: { repoRoot, methodologyPath, corpusToolPath, scoreToolPath,
     fromLedger: `${repoRoot}/.crg-agentsmd/ledger.json`, model, scoreSample } })
   ```
   Ends at status `scored` with `scores.json` + the draft at `<repoRoot>/.crg-agentsmd/AGENTS.md`.

   **A/B stage** (only with `--ab`, after `scored`): same call plus
   `{ abEval: true, abOnly: true, abIssues: 3, abToolPath }`.

2. Otherwise (no workflow installed, or `--prose`) → read `methodology.md` from this skill's
   directory and execute it as the main-loop orchestrator: run the corpus/score CLIs directly with
   Bash, dispatch miners/verifiers/judges as parallel `Agent` waves per phase, honoring every
   judgment rule (miner discipline, verification attacks, mechanism-match scoring, synthesis
   budget) verbatim. Keep the structural holdout: miners read ONLY the train-split files.

To upgrade prose → deterministic, run the bundled `crg-deterministic` command once.

## After it returns

Relay: coverage (`fileCoverage` over applicable held-out corrections), kept vs cut-zero-predictive
counts, the top rules with their coverage, and the draft path. **The draft is never committed,
never PR'd, never posted by this tool** — it sits beside its ledger for a human to review, and any
upstream contribution is the user's own, with the holdout scores quoted honestly (including the
placebo comparison and the A/B null where available).
