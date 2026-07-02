import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { holdoutComments, judgedRules, scorePanel, cutZeroPredictive } from '../lib/agentsmd-score.mjs'

const CLI = fileURLToPath(new URL('../lib/agentsmd-score.mjs', import.meta.url))

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

// The CLI seams the workflow's Score phase drives: heavy data stays on disk, agents relay
// only the compact stdout — these tests pin the stdout contracts.
const cliFixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'agentsmd-score-'))
  mkdirSync(join(root, '.crg-agentsmd'), { recursive: true })
  const ledger = {
    rules: [{ rule: 'kept rule', scope: 'repo-wide' }, { rule: 'zero rule', scope: 'src' }],
    cut: [
      { rule: 'env-killed', scope: 'ci', cutReason: 'commandClaim failed: nix-shell: command not found' },
      { rule: 'refuted', scope: 'src', cutReason: 'counterexample: violated everywhere' },
    ],
  }
  writeFileSync(join(root, '.crg-agentsmd', 'ledger.json'), JSON.stringify(ledger, null, 2))
  return root
}
const runCli = (cmd, root) => JSON.parse(execFileSync('node', [CLI, cmd, root], { encoding: 'utf8' }))

test('CLI rules: prints counts + the indexed rule list, line count == count', () => {
  const root = cliFixture()
  const out = runCli('rules', root)
  assert.equal(out.count, 3) // 2 rules + 1 rescued env-false-kill
  assert.equal(out.rules, 2)
  assert.equal(out.cut, 2)
  assert.equal(out.unverified, 1)
  const lines = out.ruleList.split('\n')
  assert.equal(lines.length, out.count)
  assert.equal(lines[0], '0: [repo-wide] kept rule')
  assert.equal(lines[2], '2: [ci] (unverified command) env-killed')
})

test('CLI score prints compact summary; stamp fills ledger.scoring from scores.json', () => {
  const root = cliFixture()
  const panel = [
    { commentId: 'a', applicable: true, creditedRules: [0] },
    { commentId: 'b', applicable: true, creditedRules: [] },
  ]
  writeFileSync(join(root, '.crg-agentsmd', 'panel.json'), JSON.stringify(panel))
  const summary = runCli('score', root)
  assert.equal(summary.kept, 1) // 'kept rule'; zero rule + rescued cut zero-predictive
  assert.equal(summary.cutZeroPredictive, 2)
  assert.equal(summary.fileCoverage, 0.5)
  assert.equal(summary.topKept.length, 1)
  assert.equal(summary.topKept[0].rule, 'kept rule')
  const stamp = runCli('stamp', root)
  assert.deepEqual(stamp, { ok: true, kept: 1, cut: 2 })
  const ledger = JSON.parse(readFileSync(join(root, '.crg-agentsmd', 'ledger.json'), 'utf8'))
  assert.equal(ledger.scoring.fileCoverage, 0.5)
  assert.deepEqual(ledger.scoring.cutZeroPredictive, ['zero rule', 'env-killed'])
  assert.equal(ledger.rules.length, 2) // untouched
})
