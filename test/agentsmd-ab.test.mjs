import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  changedTokens, diffSimilarity, lengthParity, computeLift, aggregateLift,
  contaminationClean, parseShas, selectIssues,
} from '../lib/agentsmd-ab.mjs'

const CLI = fileURLToPath(new URL('../lib/agentsmd-ab.mjs', import.meta.url))
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' })

const diffFor = (path, minus, plus) =>
  `diff --git a/${path} b/${path}\nindex 000..111 100644\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-${minus}\n+${plus}\n`

// --- scoring math -------------------------------------------------------------------------------

test('changedTokens picks changed-line words + file paths, ignores context/hunk lines', () => {
  const t = changedTokens(diffFor('src/a.py', 'return foo', 'return bar'))
  assert.ok(t.has('return') && t.has('foo') && t.has('bar'))
  assert.ok(t.has('path:src/a.py'))
  assert.ok(![...t].some(x => x.includes('@@')), 'hunk header excluded')
})

test('diffSimilarity: identical=1, disjoint=0, empty=0', () => {
  const d = diffFor('a.py', 'x', 'y')
  assert.equal(diffSimilarity(d, d), 1)
  assert.equal(diffSimilarity(diffFor('a.py', 'x', 'y'), diffFor('z.js', 'p', 'q')), 0)
  assert.equal(diffSimilarity('', d), 0)
})

test('lengthParity flags within/outside +-20%', () => {
  assert.equal(lengthParity(1000, 1100).ok, true)
  assert.equal(lengthParity(1000, 850).ok, true)
  assert.equal(lengthParity(1000, 700).ok, false)
  assert.equal(lengthParity(1000, 1300).ok, false)
  assert.equal(lengthParity(0, 100).ok, false)
})

test('aggregateLift averages arms and lift = mined - placebo', () => {
  const agg = aggregateLift([{ pr: 1, mined: 0.8, placebo: 0.5, nofile: 0.4 }, { pr: 2, mined: 0.6, placebo: 0.5, nofile: 0.2 }])
  assert.equal(agg.n, 2)
  assert.equal(agg.meanMined, 0.7)
  assert.equal(agg.meanPlacebo, 0.5)
  assert.ok(Math.abs(agg.meanNofile - 0.3) < 1e-9)
  assert.ok(Math.abs(agg.lift - 0.2) < 1e-9)
})

// The plan's seeded-sham: feed the placebo arm's own diff in as the "mined" arm's diff. Same diff,
// same anchor => identical similarity => lift MUST be ~0. Proves the scoring math is unbiased.
test('seeded-sham: placebo-as-mined yields ~zero lift (pure math, no agents)', () => {
  const merged = diffFor('src/a.py', 'old', 'new value here')
  const placeboArm = diffFor('src/a.py', 'old', 'different attempt')
  const sim = diffSimilarity(placeboArm, merged)
  const rows = [{ pr: 1, mined: sim, placebo: sim }, { pr: 2, mined: sim, placebo: sim }]
  assert.equal(aggregateLift(rows).lift, 0)
  assert.equal(computeLift(sim, sim), 0)
})

// --- contamination (pure) -----------------------------------------------------------------------

test('contaminationClean detects mergeSha present/absent, incl short-sha prefix', () => {
  const log = 'aaaaaaaaaaaa\nbbbbbbbbbbbb\n'
  assert.equal(contaminationClean(log, 'cccccccccccc'), true)
  assert.equal(contaminationClean(log, 'aaaaaaaaaaaa'), false)
  assert.equal(contaminationClean(log, 'aaaaaa'), false) // short sha prefixes a full log sha
  assert.deepEqual(parseShas(' a \n\n b \n'), ['a', 'b'])
})

// --- selectIssues (pure) ------------------------------------------------------------------------

test('selectIssues ranks held-out merged PRs by comment count, drops zero-file PRs', () => {
  const prs = [
    { number: 10, state: 'merged', changedFiles: 3 },
    { number: 11, state: 'merged', changedFiles: 5 },
    { number: 12, state: 'merged', changedFiles: 0 }, // no file changes -> dropped
    { number: 13, state: 'closed-unmerged', changedFiles: 2 },
  ]
  const comments = [
    { pr: 10, author: 'alice' }, { pr: 11, author: 'bob' }, { pr: 11, author: 'bob' },
    { pr: 11, author: 'dependabot[bot]' }, { pr: 13, author: 'x' },
  ]
  const picked = selectIssues(prs, comments, [10, 11, 12, 13], 5)
  assert.deepEqual(picked.map(p => p.pr), [11, 10]) // 11 has 2 human comments, 10 has 1; 12/13 excluded
  assert.equal(picked[0].comments, 2)
})

// --- CLI contract tests on tmp git fixtures -----------------------------------------------------

const runCli = (...args) => JSON.parse(execFileSync('node', [CLI, ...args], { encoding: 'utf8' }))

// A fixture repo with a base commit and a "merged" commit that adds the fix.
const fixtureRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-fixture-'))
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 't@t')
  git(root, 'config', 'user.name', 't')
  writeFileSync(join(root, 'app.py'), 'def f():\n    return 1\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'base')
  const baseSha = git(root, 'rev-parse', 'HEAD').trim()
  writeFileSync(join(root, 'app.py'), 'def f():\n    return 42  # fixed\n')
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'the fix')
  const mergeSha = git(root, 'rev-parse', 'HEAD').trim()
  return { root, baseSha, mergeSha }
}

test('CLI prep: workspace is contamination-clean — merged sha absent from git log --all', () => {
  const { root, baseSha, mergeSha } = fixtureRepo()
  const armDir = join(mkdtempSync(join(tmpdir(), 'ab-arm-')), 'mined')
  const res = runCli('prep', root, baseSha, mergeSha, armDir)
  assert.equal(res.contaminationOk, true)
  // The structural guarantee, checked directly against git — the whole validity of the eval.
  const logAll = git(armDir, 'log', '--all', '--format=%H')
  assert.ok(!logAll.includes(mergeSha), 'merged fix sha must be unreachable in the arm workspace')
  assert.ok(!existsSync(join(armDir, '.crg-agentsmd')), 'workspace must not contain .crg-agentsmd')
  assert.equal(readFileSync(join(armDir, 'app.py'), 'utf8').includes('return 1'), true) // base tree, not the fix
  assert.ok(!readFileSync(join(armDir, 'app.py'), 'utf8').includes('42'), 'the fix must be absent')
})

test('CLI prep places the arm AGENTS.md when given, omits it for the no-file arm', () => {
  const { root, baseSha, mergeSha } = fixtureRepo()
  const agentsFile = join(mkdtempSync(join(tmpdir(), 'ab-agents-')), 'AGENTS.md')
  writeFileSync(agentsFile, '# rules\nalways return 42\n')
  const withFile = join(mkdtempSync(join(tmpdir(), 'ab-arm-')), 'mined')
  const noFile = join(mkdtempSync(join(tmpdir(), 'ab-arm-')), 'nofile')
  assert.equal(runCli('prep', root, baseSha, mergeSha, withFile, agentsFile).hasAgentsFile, true)
  assert.ok(existsSync(join(withFile, 'AGENTS.md')))
  assert.equal(runCli('prep', root, baseSha, mergeSha, noFile).hasAgentsFile, false)
  assert.ok(!existsSync(join(noFile, 'AGENTS.md')))
})

test('CLI capture: arm diff excludes AGENTS.md, captures the code change to disk', () => {
  const { root, baseSha, mergeSha } = fixtureRepo()
  const armDir = join(mkdtempSync(join(tmpdir(), 'ab-arm-')), 'mined')
  const agentsFile = join(mkdtempSync(join(tmpdir(), 'ab-agents-')), 'AGENTS.md')
  writeFileSync(agentsFile, '# rules\n')
  runCli('prep', root, baseSha, mergeSha, armDir, agentsFile)
  // The arm "implements" its fix.
  writeFileSync(join(armDir, 'app.py'), 'def f():\n    return 42  # fixed\n')
  const outFile = join(armDir, '..', 'arm.diff')
  const cap = runCli('capture', armDir, outFile)
  assert.ok(cap.diffLines > 0 && cap.files === 1)
  const diff = readFileSync(outFile, 'utf8')
  assert.ok(diff.includes('app.py') && diff.includes('42'))
  assert.ok(!diff.includes('AGENTS.md'), 'the file under test must not appear in the arm contribution')
})

test('CLI score + parity: end-to-end similarity of a good vs weak arm, parity gate', () => {
  const { root, baseSha, mergeSha } = fixtureRepo()
  const anchorDir = mkdtempSync(join(tmpdir(), 'ab-anchor-'))
  const merged = join(anchorDir, 'merged.diff')
  // Hand-write the answer key (anchor's gh path is exercised only by the real smoke).
  writeFileSync(merged, execFileSync('git', ['-C', root, 'diff', baseSha, mergeSha], { encoding: 'utf8' }))
  const good = join(anchorDir, 'good.diff')
  writeFileSync(good, execFileSync('git', ['-C', root, 'diff', baseSha, mergeSha], { encoding: 'utf8' }))
  const weak = join(anchorDir, 'weak.diff')
  writeFileSync(weak, diffFor('other.js', 'a', 'b'))
  assert.equal(runCli('score', good, merged).similarity, 1)
  assert.ok(runCli('score', weak, merged).similarity < 0.2, 'an unrelated arm scores near zero')

  const minedF = join(anchorDir, 'AGENTS.md')
  const placeboF = join(anchorDir, 'placebo.md')
  writeFileSync(minedF, 'x'.repeat(1000))
  writeFileSync(placeboF, 'y'.repeat(1050))
  assert.equal(runCli('parity', minedF, placeboF).ok, true)
  writeFileSync(placeboF, 'y'.repeat(500))
  assert.equal(runCli('parity', minedF, placeboF).ok, false)
})

test('CLI lift aggregates a results file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-lift-'))
  const f = join(dir, 'results.json')
  writeFileSync(f, JSON.stringify([{ pr: 1, mined: 0.9, placebo: 0.4 }, { pr: 2, mined: 0.5, placebo: 0.4 }]))
  const agg = runCli('lift', f)
  assert.equal(agg.meanMined, 0.7)
  assert.ok(Math.abs(agg.lift - 0.3) < 1e-9)
})
