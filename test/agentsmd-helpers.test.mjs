import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-agentsmd.js (which can't be imported — the workflow runtime evals it
// whole with injected globals) and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-agentsmd.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const verdictFold'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, ruleKey, resolveModel, capText, chunk, RESCUE_RE, cmdOutcome, foldCandidates, applyClusters, verdictFold, fleetPlan }`,
)()

const rule = (over = {}) => ({
  rule: 'r', why: 'w', scope: 's', category: 'process',
  evidence: [{ kind: 'review-comment', ref: 'u', quote: 'q' }],
  modality: 'review-comments', minerId: 'm1', ...over,
})

test('chunk splits with remainder', () => {
  assert.deepEqual(H.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
  assert.deepEqual(H.chunk([], 3), [])
})

test('fleetPlan sums parts and prints the arithmetic', () => {
  const { total, line } = H.fleetPlan([['cx', 8], ['rs', 3], ['cmd', 2]])
  assert.equal(total, 13)
  assert.equal(line, '8 cx + 3 rs + 2 cmd = 13 agents')
})

test('cmdOutcome: pass, env via failureKind, env via stderr, env on dead gate, fail', () => {
  assert.equal(H.cmdOutcome({ results: [{ command: 'x', exitCode: 0 }] }), 'pass')
  assert.equal(H.cmdOutcome({ results: [{ command: 'x', exitCode: 1, failureKind: 'env' }] }), 'env')
  assert.equal(H.cmdOutcome({ results: [{ command: 'x', exitCode: 127, stderr: 'zsh: command not found: nix-shell' }] }), 'env')
  assert.equal(H.cmdOutcome(null), 'env')
  assert.equal(H.cmdOutcome({ results: [] }), 'env')
  assert.equal(H.cmdOutcome({ results: [{ command: 'x', exitCode: 1, failureKind: 'code', stderr: 'assertion failed' }] }), 'fail')
  // one genuine code failure among env failures -> fail
  assert.equal(H.cmdOutcome({ results: [
    { command: 'a', exitCode: 1, failureKind: 'env' },
    { command: 'b', exitCode: 2, stderr: 'real error' },
  ] }), 'fail')
})

test('foldCandidates unions evidence and modalities on duplicate keys', () => {
  const folded = H.foldCandidates([
    rule(), rule({ modality: 'diff-evolution', minerId: 'm2' }), rule({ rule: 'other' }),
  ], H.ruleKey)
  assert.equal(folded.length, 2)
  assert.equal(folded[0].evidence.length, 2)
  assert.deepEqual(folded[0].modalities, ['review-comments', 'diff-evolution'])
  assert.deepEqual(folded[0].minerIds, ['m1', 'm2'])
})

test('applyClusters guards out-of-range, already-dropped, and singleton groups', () => {
  const rules = [0, 1, 2, 3].map(i => ({ ...rule({ rule: `r${i}` }), modalities: ['review-comments'], minerIds: ['m1'] }))
  const out = H.applyClusters(rules, [[0, 1], [1, 2], [99, 3], [2]])
  // [0,1] folds 1 into 0; [1,2] ignores dropped 1 -> singleton -> no-op; [99,3] drops 99 -> singleton; [2] singleton
  assert.deepEqual(out.map(r => r.rule), ['r0', 'r2', 'r3'])
  assert.equal(out[0].evidence.length, 2)
})

test('verdictFold: missing cx cuts, refuted cuts, rescope applies, out-of-range verdict ignored', () => {
  const rules = [0, 1, 2].map(i => ({ ...rule({ rule: `r${i}` }), modalities: ['review-comments'], minerIds: ['m1'] }))
  const cx = new Map([
    [0, { index: 0, verdict: 'rescope', reason: 'narrower', rescopedTo: 'src/x', violationsFound: 2 }],
    [1, { index: 1, verdict: 'refuted', reason: 'violations everywhere' }],
    [99, { index: 99, verdict: 'holds', reason: 'phantom' }],
  ])
  const rs = new Map([[0, { index: 0, restatement: true, reason: 'visible in one file' }]])
  const { rules: kept, cut } = H.verdictFold(rules, cx, rs, new Map())
  assert.equal(kept.length, 1)
  assert.equal(kept[0].scope, 'src/x')
  assert.equal(kept[0].rescoped, true)
  assert.equal(kept[0].violationsFound, 2)
  assert.equal(kept[0].restatement, true)
  assert.equal(cut.length, 2)
  assert.match(cut.find(c => c.rule === 'r1').cutReason, /^counterexample:/)
  assert.match(cut.find(c => c.rule === 'r2').cutReason, /no verdict/)
})

test('verdictFold: env command failure keeps rule as unverifiedCommand; code failure cuts', () => {
  const rules = [
    { ...rule({ rule: 'envcmd', category: 'mechanical', commandClaim: 'nix-shell --run fmt' }), modalities: ['review-comments'], minerIds: ['m1'] },
    { ...rule({ rule: 'badcmd', category: 'mechanical', commandClaim: 'pytest -k nope' }), modalities: ['review-comments'], minerIds: ['m1'] },
  ]
  const cx = new Map([
    [0, { index: 0, verdict: 'holds', reason: 'ok' }],
    [1, { index: 1, verdict: 'holds', reason: 'ok' }],
  ])
  const cmd = new Map([
    [0, { results: [{ command: 'nix-shell --run fmt', exitCode: 127, stderr: 'command not found: nix-shell' }] }],
    [1, { results: [{ command: 'pytest -k nope', exitCode: 1, failureKind: 'code', stderr: '1 failed' }] }],
  ])
  const { rules: kept, cut } = H.verdictFold(rules, cx, new Map(), cmd)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].rule, 'envcmd')
  assert.equal(kept[0].unverifiedCommand, true)
  assert.equal(cut.length, 1)
  assert.match(cut[0].cutReason, /commandClaim failed: 1 failed/)
})
