import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holdoutComments, judgedRules, scorePanel, cutZeroPredictive } from '../lib/agentsmd-score.mjs'

const comment = (pr, author, body = 'x') => ({ pr, author, path: 'a.py', body, url: `u/${pr}/${author}` })

test('holdoutComments keeps held-out non-bot comments only', () => {
  const all = [
    comment(1, 'alice'), comment(2, 'bob'), comment(2, 'dependabot[bot]'),
    comment(3, 'carol'), comment(2, null),
  ]
  const held = holdoutComments(all, [2, 3])
  assert.deepEqual(held.map(c => `${c.pr}:${c.author}`), ['2:bob', '3:carol'])
})

test('judgedRules appends only env-false-killed cut entries, flagged', () => {
  const ledger = {
    rules: [{ rule: 'r0' }, { rule: 'r1' }],
    cut: [
      { rule: 'c-cmd', cutReason: 'commandClaim failed: pre-commit: command not found' },
      { rule: 'c-real', cutReason: 'counterexample: violated in current code' },
      { rule: 'c-nix', cutReason: 'commandClaim failed: nix-shell: No such file or directory' },
    ],
  }
  const judged = judgedRules(ledger)
  assert.deepEqual(judged.map(r => r.rule), ['r0', 'r1', 'c-cmd', 'c-nix'])
  assert.deepEqual(judged.map(r => r.unverifiedCommand), [false, false, true, true])
})

test('scorePanel counts coverage, ignores non-applicable and invalid indices', () => {
  const panel = [
    { commentId: 'a', applicable: true, creditedRules: [0, 2] },
    { commentId: 'b', applicable: true, creditedRules: [] },
    { commentId: 'c', applicable: true, creditedRules: [0, 0, 99] }, // dup + out-of-range
    { commentId: 'd', applicable: false, creditedRules: [1] },       // not a correction
  ]
  const s = scorePanel(panel, 3)
  assert.equal(s.totalComments, 4)
  assert.equal(s.applicable, 3)
  assert.equal(s.fileCoverage, 2 / 3) // a + c covered, b not; d excluded
  assert.deepEqual(s.perRule, [{ rule: 0, covered: 2 }, { rule: 1, covered: 0 }, { rule: 2, covered: 1 }])
})

test('cutZeroPredictive cuts zeros, spares verified mechanical commands, stamps coverage', () => {
  const rules = [
    { rule: 'covered', category: 'stylistic' },
    { rule: 'dead-stylistic', category: 'stylistic' },
    { rule: 'mech-cmd', category: 'mechanical', commandClaim: 'pytest -q' },
    { rule: 'rescued-cmd', category: 'mechanical', commandClaim: 'ruff', unverifiedCommand: true },
  ]
  const perRule = [{ rule: 0, covered: 3 }, { rule: 1, covered: 0 }, { rule: 2, covered: 0 }, { rule: 3, covered: 0 }]
  const { kept, cutRules } = cutZeroPredictive(rules, perRule)
  assert.deepEqual(kept.map(r => r.rule), ['covered', 'mech-cmd'])
  assert.deepEqual(kept.map(r => r.coverage), [3, 0])
  assert.deepEqual(cutRules.map(r => r.rule), ['dead-stylistic', 'rescued-cmd'])
  assert.match(cutRules[0].cutReason, /zero-predictive/)
})

test('cutZeroPredictive rescued command survives once it earns coverage', () => {
  const rules = [{ rule: 'rescued-cmd', category: 'mechanical', commandClaim: 'ruff', unverifiedCommand: true }]
  const { kept, cutRules } = cutZeroPredictive(rules, [{ rule: 0, covered: 1 }])
  assert.equal(kept.length, 1)
  assert.equal(cutRules.length, 0)
  assert.equal(kept[0].coverage, 1)
})
