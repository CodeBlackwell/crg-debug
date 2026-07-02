# crg-agentsmd methodology

Judgment guidance for the AGENTS.md farming pipeline. The workflow script owns control
flow, caps, and gates; this file owns what "a real rule" means. Agents: read your
section and follow it line-by-line.

## The one test that matters

A candidate rule earns its place only if it states a property that SHAPES this repo's
code but is not visible in any single file — the thing a maintainer corrects newcomers
on, the boundary condition nobody wrote down, the pattern whose violation gets a PR
comment. "This repo uses Django" is not a rule. "Migrations are never edited after
merge; write a new one even for a one-line fix (maintainers corrected this in PRs #X,
#Y)" is a rule.

The failure mode to avoid at all costs: restating what the code already says. If a
competent engineer would derive the rule from one screen of code, it is a restatement.
Restatements dilute the file and destroy maintainer trust in it.

## Mining plan

Modalities and what each hunts:

- **review-comments** — the gold seam. Recurring maintainer corrections are proto-rules.
  Cluster by what the reviewer keeps having to say, not by file. One prolific reviewer's
  comments are one voice: shard by reviewer when volume demands sharding, because a
  reviewer's recurring theme is exactly a house rule in the making.
- **diff-evolution** — what changed between a PR's first push and its merged state is
  the gap between outsider instinct and house style. Mine heavily-reviewed PRs only;
  a rubber-stamped PR teaches nothing.
- **git-archaeology** — reverts, fixups, "address review" follow-ups mark rule
  violations that were repaired. Thin in young repos; drop it when empty.
- **code-invariants** — what is uniform across the tree is a rule; what varies freely
  is not. Only report an invariant when the uniformity is too consistent to be chance
  AND is not enforced by a linter config already (if a linter enforces it, it is
  mechanical — cite the config as evidence and mark it mechanical).
- **docs** — what is already written down, so the file never duplicates it, plus the
  voice/structure the synthesis phase must match. Docs miners mostly produce ZERO new
  rules; their yield is anti-duplication context and genuinely undocumented gaps.

## Miner discipline

1. Execute your slice spec exactly. Reading outside your slice (other than the working
   tree for context) corrupts the overlap-confirmation signal.
2. Every rule: one imperative sentence. If you need two sentences, you have two rules
   or none.
3. Evidence is verbatim and cited. Paraphrase in `rule` and `why`; quote in `evidence`.
   A rule you cannot quote evidence for does not exist — return fewer rules rather
   than padded ones. Expected yield for a rich slice is 3–10 rules, not 30.
4. `why` states the shaping property: the cost paid when the rule is broken, or the
   constraint that makes it necessary. "Consistency" alone is not a why.
5. Scope honestly. A rule observed only under `src/website/` is scoped there, not
   repo-wide.
6. Era honesty: if every citation is old and recent PRs show no enforcement, set
   `eraNote` instead of presenting a possibly-dead rule as live.
7. Bots are not maintainers. Never derive a rule from bot comments (dependabot,
   github-advanced-security, CI bots); a linter finding cited BY a human reviewer
   counts as that human's correction.
8. Review threads contain disagreement. A rule needs the correction to have WON —
   the contributor changed the code, or the maintainer's stance is repeated across
   PRs. One contested comment is not a rule.

## Verification

- **Counterexample hunter**: your job is to kill. Search the rule's claimed scope in
  the CURRENT tree. Accepted, merged code that violates the rule refutes it — unless
  violations are confined to old code and recent enforcement is visible, in which case
  it holds (note the stragglers). Also open every evidence ref: a quote that does not
  exist at its ref is fabrication and refutes the rule by itself. Prefer 'rescope'
  over 'refuted' when the rule clearly holds somewhere narrower.
- **Restatement detector**: ask only "is cross-PR or tacit knowledge REQUIRED to know
  this?" Visibility in one file → restatement=true, regardless of how true or useful
  the rule is. Be strict; the scoring phase can rescue a demoted rule later.
- **Executability**: not judgment — run the command exactly, report the exit code.

## Scoring (holdout replay)

For each held-out review correction, the question is precise: "would an agent that had
READ this rule have avoided writing the code that drew this comment?" Credit requires
mechanism, not topic overlap — the rule must name the specific constraint the comment
enforces. When in doubt, no credit. Judges anchor to human artifacts (the comment, the
merged diff); never award points for "the rule seems good".

## Synthesis

- Match the repo's existing documentation voice and structure; the docs miner's report
  says what that is.
- Order rules by measured predictive value, not by category.
- Hard length budget. Every line must survive "would a maintainer delete this?"
- Each rule ships as: the imperative sentence + a one-line why. Evidence lives in the
  ledger, not the file.
- Mechanical rules that a linter/CI could enforce get flagged `graduate-to-CI` — prose
  is their weakest enforcement, and on weaker model tiers prose rules are ignored
  entirely; an executable check is the durable form.
- Never fabricate provenance: the file's header says it was machine-mined from review
  history and names the ledger.
