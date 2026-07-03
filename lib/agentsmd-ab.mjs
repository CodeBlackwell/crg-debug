// A/B effectiveness harness for /crg-agentsmd: measures whether a mined AGENTS.md actually improves
// agent contributions, against two controls — no file, and a length-matched generic placebo — across
// K held-out merged PRs. The deterministic signal is diff-similarity between each arm's produced diff
// and the actually-merged human diff; lift = mined - placebo. The workflow pairs this with a rubric
// judge anchored ONLY to the PR's real review comments (never freestanding quality opinions).
//
// What diff-similarity proves: the arm's changed lines + files overlap the merged fix's. It does NOT
// prove the arm passes tests or is behaviorally correct — a right fix worded differently scores low.
// That known gap is exactly why the workflow also runs the comment-anchored rubric judge.
//
// CLI seams the workflow drives (heavy data stays on disk; agents relay only compact numbers):
//   node agentsmd-ab.mjs select  <repoRoot> <k>                                 rank held-out PRs, print top k
//   node agentsmd-ab.mjs anchor  <repoRoot> <pr> <outDir>                       gh+git: base/merge sha + answer-key diff
//   node agentsmd-ab.mjs prep    <repoRoot> <baseSha> <mergeSha> <armDir> [f]   archive base -> contamination-clean workspace
//   node agentsmd-ab.mjs capture <armDir> <outFile>                             arm diff (excl AGENTS.md) -> disk
//   node agentsmd-ab.mjs score   <armDiffFile> <mergedDiffFile>                 diff-similarity of arm vs merged
//   node agentsmd-ab.mjs parity  <minedFile> <placeboFile>                      placebo length-parity gate (+-20%)
//   node agentsmd-ab.mjs lift    <resultsFile>                                  aggregate mean similarity + lift

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'node:fs'
import { join } from 'node:path'
import { parseRemote } from './issue-ref.mjs'
import { corpusDir, readJsonl } from './corpus.mjs'

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })

// --- scoring math (pure) -------------------------------------------------------------------------

// Word tokens of a changed line or a file path: lowercased, whitespace/punctuation split.
const words = s => String(s || '').toLowerCase().match(/[a-z0-9_./-]+/g) || []

// The token set a unified diff CHANGES: file paths from its headers + words of every added/removed
// line. Context lines, hunk headers, and index lines are ignored — only the delta counts.
export function changedTokens(diff) {
  const tokens = new Set()
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      for (const w of words(line.slice(4).replace(/^[ab]\//, ''))) tokens.add(`path:${w}`)
    } else if (line.startsWith('diff --git ') || line.startsWith('index ')) {
      continue
    } else if ((line[0] === '+' || line[0] === '-')) {
      for (const w of words(line.slice(1))) tokens.add(w)
    }
  }
  return tokens
}

// Jaccard overlap of the two diffs' changed-token sets: |A n B| / |A u B|. 0 when either is empty.
export function diffSimilarity(diffA, diffB) {
  const a = changedTokens(diffA)
  const b = changedTokens(diffB)
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

// Placebo must match the mined file's length so length never confounds the arm comparison.
export function lengthParity(minedChars, placeboChars, tol = 0.2) {
  const ratio = minedChars ? placeboChars / minedChars : 0
  return { ratio, ok: ratio >= 1 - tol && ratio <= 1 + tol }
}

export const computeLift = (minedSim, placeboSim) => minedSim - placeboSim

// Aggregate per-PR similarity rows into mean arm scores + lift. rows: [{pr, mined, placebo, nofile?}].
export function aggregateLift(rows) {
  const mean = key => (rows.length ? rows.reduce((n, r) => n + (Number(r[key]) || 0), 0) / rows.length : 0)
  const meanMined = mean('mined')
  const meanPlacebo = mean('placebo')
  return { n: rows.length, meanMined, meanPlacebo, meanNofile: mean('nofile'), lift: computeLift(meanMined, meanPlacebo) }
}

// Contamination check, pure so the structural guarantee is unit-tested not just CLI-asserted: the
// merged fix's sha must be absent from the arm workspace's reachable history (git log --all).
export const parseShas = logOut => String(logOut || '').split('\n').map(s => s.trim()).filter(Boolean)
export const contaminationClean = (logShas, mergeSha) =>
  !parseShas(logShas).some(s => s.startsWith(mergeSha) || mergeSha.startsWith(s))

// Rank held-out merged PRs for the eval: most held-out human review comments first (richest rubric),
// PRs with zero file changes dropped. Deterministic (tie-break by number). Pure — fixtures test it.
export function selectIssues(prs, comments, holdout, k) {
  const held = new Set(holdout)
  const byPr = {}
  for (const c of comments) {
    if (held.has(c.pr) && c.author && !c.author.endsWith('[bot]')) byPr[c.pr] = (byPr[c.pr] || 0) + 1
  }
  const merged = new Map(prs.filter(p => p.state === 'merged').map(p => [p.number, p]))
  return holdout
    .filter(n => merged.has(n) && (merged.get(n).changedFiles || 0) > 0)
    .map(n => ({ pr: n, comments: byPr[n] || 0, changedFiles: merged.get(n).changedFiles }))
    .sort((a, b) => b.comments - a.comments || a.pr - b.pr)
    .slice(0, k)
}

// --- workspace + capture (side effects, git/gh) --------------------------------------------------

const slugOf = repoRoot => {
  const r = parseRemote(sh('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']).trim())
  if (!r) throw new Error(`origin of ${repoRoot} is not a GitHub remote`)
  return `${r.owner}/${r.repo}`
}

// Resolve the PR's merge commit + its base (mergeSha^1) and write the answer-key diff (the human
// solution) to disk. The answer key lives OUTSIDE any arm workspace so no arm agent can reach it.
export function anchorPR(repoRoot, pr, outDir) {
  const view = JSON.parse(sh('gh', ['pr', 'view', String(pr), '-R', slugOf(repoRoot), '--json', 'mergeCommit,files,title,body']))
  const mergeSha = view.mergeCommit && view.mergeCommit.oid
  if (!mergeSha) throw new Error(`PR #${pr} has no merge commit (not merged?)`)
  const baseSha = sh('git', ['-C', repoRoot, 'rev-parse', `${mergeSha}^1`]).trim()
  mkdirSync(outDir, { recursive: true })
  const diff = sh('git', ['-C', repoRoot, 'diff', baseSha, mergeSha])
  const diffPath = join(outDir, `pr-${pr}.merged.diff`)
  writeFileSync(diffPath, diff)
  writeFileSync(join(outDir, `pr-${pr}.task.txt`), `${view.title || ''}\n\n${view.body || ''}`)
  // The PR's real human review comments — the rubric judge's only anchors (anti-contamination).
  const comments = readJsonl(join(corpusDir(repoRoot), 'review-comments.jsonl'))
    .filter(c => c.pr === Number(pr) && c.author && !c.author.endsWith('[bot]'))
    .map(c => ({ author: c.author, path: c.path, line: c.line, body: c.body, url: c.url }))
  writeFileSync(join(outDir, `pr-${pr}.comments.json`), JSON.stringify(comments, null, 2))
  return { pr: Number(pr), mergeSha, baseSha, diffPath, diffLines: diff.split('\n').filter(Boolean).length, files: (view.files || []).length, comments: comments.length }
}

// Archive the base tree into a fresh single-commit repo: the merged fix is STRUCTURALLY unreachable
// (new object DB, no other refs), so git log --all cannot contain mergeSha and .crg-agentsmd (the
// holdout + answer key) is never present. Throws — the guard is enforced in code, not by prompt.
export function prepArm(repoRoot, baseSha, mergeSha, armDir, agentsFile) {
  rmSync(armDir, { recursive: true, force: true })
  mkdirSync(armDir, { recursive: true })
  const tar = join(armDir, '.base.tar')
  writeFileSync(tar, sh('git', ['-C', repoRoot, 'archive', baseSha], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }))
  sh('tar', ['-x', '-f', tar, '-C', armDir])
  rmSync(tar)
  sh('git', ['-C', armDir, 'init', '-q'])
  sh('git', ['-C', armDir, 'add', '-A'])
  sh('git', ['-C', armDir, '-c', 'user.email=ab@crg', '-c', 'user.name=crg-ab', 'commit', '-q', '-m', 'base'])
  if (agentsFile) cpSync(agentsFile, join(armDir, 'AGENTS.md'))
  const clean = contaminationClean(sh('git', ['-C', armDir, 'log', '--all', '--format=%H']), mergeSha)
  const noLedger = !existsSync(join(armDir, '.crg-agentsmd'))
  if (!clean || !noLedger) throw new Error(`contamination: mergeSha reachable=${!clean} ledgerPresent=${!noLedger}`)
  return { armDir, baseSha, headSha: sh('git', ['-C', armDir, 'rev-parse', 'HEAD']).trim(), contaminationOk: clean, hasAgentsFile: !!agentsFile }
}

// The arm's contribution diff: everything it changed (new untracked files via add -N included),
// minus AGENTS.md itself — the file under test is a harness artifact, not the arm's code.
export function captureDiff(armDir, outFile) {
  sh('git', ['-C', armDir, 'add', '-A', '-N'])
  const diff = sh('git', ['-C', armDir, 'diff', '--', '.', ':(exclude)AGENTS.md', ':(exclude).crg-agentsmd/**'])
  writeFileSync(outFile, diff)
  return { diffPath: outFile, diffLines: diff.split('\n').filter(Boolean).length, chars: diff.length, files: (diff.match(/^diff --git /gm) || []).length }
}

// --- CLI -----------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2)
  const out = obj => process.stdout.write(JSON.stringify(obj) + '\n')
  const die = m => { process.stderr.write(m + '\n'); process.exit(1) }
  if (cmd === 'select') {
    const [repoRoot, k] = rest
    const dir = corpusDir(repoRoot)
    const holdout = JSON.parse(readFileSync(join(dir, 'holdout', 'prs.json'), 'utf8')).holdout
    out({ issues: selectIssues(readJsonl(join(dir, 'prs.jsonl')), readJsonl(join(dir, 'review-comments.jsonl')), holdout, Number(k) || 3) })
  } else if (cmd === 'anchor') {
    const [repoRoot, pr, outDir] = rest
    out(anchorPR(repoRoot, pr, outDir))
  } else if (cmd === 'prep') {
    const [repoRoot, baseSha, mergeSha, armDir, agentsFile] = rest
    out(prepArm(repoRoot, baseSha, mergeSha, armDir, agentsFile || undefined))
  } else if (cmd === 'capture') {
    const [armDir, outFile] = rest
    out(captureDiff(armDir, outFile))
  } else if (cmd === 'score') {
    const [armDiffFile, mergedDiffFile] = rest
    const arm = existsSync(armDiffFile) ? readFileSync(armDiffFile, 'utf8') : ''
    const merged = readFileSync(mergedDiffFile, 'utf8')
    out({ similarity: diffSimilarity(arm, merged), armTokens: changedTokens(arm).size, mergedTokens: changedTokens(merged).size })
  } else if (cmd === 'parity') {
    const [minedFile, placeboFile] = rest
    const m = readFileSync(minedFile, 'utf8').length
    const p = existsSync(placeboFile) ? readFileSync(placeboFile, 'utf8').length : 0
    out({ minedChars: m, placeboChars: p, ...lengthParity(m, p) })
  } else if (cmd === 'lift') {
    const [resultsFile] = rest
    out(aggregateLift(JSON.parse(readFileSync(resultsFile, 'utf8'))))
  } else {
    die('usage: agentsmd-ab.mjs select|anchor|prep|capture|score|parity|lift <args>')
  }
}
