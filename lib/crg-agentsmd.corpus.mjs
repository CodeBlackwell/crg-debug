// Corpus fetcher for /crg-agentsmd: pulls a repo's review "fossil record" (PR index, review
// comments, git archaeology) into <repoRoot>/.crg-agentsmd/corpus/, writes the train-only views
// the miners read, and assembles the rules ledger from the fragments each phase left on disk.
// The statistics it reports (holdout split, eras, inventory) are pure and live in
// crg-agentsmd.inventory.mjs; this file owns the network and the disk.
//   node crg-agentsmd.corpus.mjs fetch <repoRoot> [maxPRs]              (gh + git shell-outs → corpus JSONL files)
//   node crg-agentsmd.corpus.mjs split <repoRoot> [fraction]            (holdout/prs.json + train-only views)
//   node crg-agentsmd.corpus.mjs inventory <repoRoot> [minReviewedPRs]  (stdout: inventory.json content)
//   node crg-agentsmd.corpus.mjs assemble <repoRoot>                    (fragments → ledger.json)
//   node crg-agentsmd.corpus.mjs write-file <absolutePath>              (stdin → that path, exact bytes)

import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseRemote } from './crg-debug.issue-ref.mjs'
import { splitHoldout, buildInventory } from './crg-agentsmd.inventory.mjs'

export const corpusDir = repoRoot => join(repoRoot, '.crg-agentsmd', 'corpus')

export const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...opts })

const writeJsonl = (path, rows) => writeFileSync(path, rows.map(r => JSON.stringify(r)).join('\n') + '\n')
export const readJsonl = path =>
  existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []

// --- fetch ---------------------------------------------------------------------------------------

const ghJson = (args, opts) => JSON.parse(sh('gh', args, opts))

export function fetchCorpus(repoRoot, { maxPRs = 1000 } = {}) {
  const origin = sh('git', ['-C', repoRoot, 'remote', 'get-url', 'origin']).trim()
  const { owner, repo } = parseRemote(origin)
  const slug = `${owner}/${repo}`
  const dir = corpusDir(repoRoot)
  mkdirSync(join(dir, 'raw'), { recursive: true })

  const prFields = 'number,title,author,mergedAt,createdAt,additions,deletions,changedFiles,reviews,files'
  // Probe with -L 1 so a bad field name fails in seconds, before any long paginated pull.
  ghJson(['pr', 'list', '-R', slug, '-L', '1', '--json', prFields])
  const merged = ghJson(['pr', 'list', '-R', slug, '--state', 'merged', '-L', String(maxPRs), '--json', prFields])
  const closed = ghJson(['pr', 'list', '-R', slug, '--state', 'closed', '-L', String(maxPRs), '--json', prFields])
  const prs = [
    ...merged.map(p => prRow(p, 'merged')),
    ...closed.filter(p => !p.mergedAt).map(p => prRow(p, 'closed-unmerged')),
  ]
  writeJsonl(join(dir, 'prs.jsonl'), prs)

  // One paginated endpoint returns every PR review comment in the repo — no per-PR fan-out.
  // --slurp wraps each page as an element of one outer JSON array. Raw bytes land on disk
  // BEFORE parsing so a parse failure never costs a re-download.
  const raw = sh('gh', ['api', '--paginate', '--slurp', `repos/${slug}/pulls/comments?per_page=100`])
  writeFileSync(join(dir, 'raw', 'pulls-comments.json'), raw)
  const comments = JSON.parse(raw).flat()
  writeJsonl(join(dir, 'review-comments.jsonl'), comments.map(commentRow))

  const gitRows = gitArchaeology(repoRoot)
  writeJsonl(join(dir, 'git-history.jsonl'), gitRows)
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ slug, fetchedAt: new Date().toISOString(), maxPRs }, null, 2))
  return { slug, prs: prs.length, reviewComments: comments.length, gitRows: gitRows.length }
}

const prRow = (p, state) => ({
  number: p.number, state, title: p.title, author: p.author?.login,
  createdAt: p.createdAt, mergedAt: p.mergedAt || null,
  additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
  reviewers: [...new Set((p.reviews || []).map(r => r.author?.login).filter(Boolean))],
  reviewCount: (p.reviews || []).length,
  files: (p.files || []).map(f => f.path),
})

const commentRow = c => ({
  pr: Number(c.pull_request_url?.split('/').pop()),
  author: c.user?.login, path: c.path, line: c.line ?? c.original_line,
  createdAt: c.created_at, body: c.body, inReplyTo: c.in_reply_to_id || null, url: c.html_url,
})

// Reverts, fixups, and "oops" follow-ups mark places where an implicit rule was violated + repaired.
export function gitArchaeology(repoRoot) {
  const log = sh('git', ['-C', repoRoot, 'log', '--no-merges', '--format=%H%x1f%an%x1f%aI%x1f%s', '-n', '5000'])
  return log.split('\n').filter(Boolean).map(l => {
    const [sha, author, date, subject] = l.split('\x1f')
    return { sha, author, date, subject }
  }).filter(r => /\b(revert|fixup|fix the fix|oops|follow-?up|address review)\b/i.test(r.subject))
}

// --- assemble ------------------------------------------------------------------------------------

// Deterministic ledger assembly from per-phase fragments on disk: corpus/inventory.json +
// .crg-agentsmd/rules.json ({generatedBy, model, minersPlanned, rules, cut}). The full ledger
// never transits an agent, and a dead run resumes from whatever fragments survived. Scoring is
// stamped separately (crg-agentsmd.score.mjs stamp), so assemble always resets it to null.
export function assembleRulesLedger(repoRoot) {
  const base = join(repoRoot, '.crg-agentsmd')
  const frag = JSON.parse(readFileSync(join(base, 'rules.json'), 'utf8'))
  const inventory = JSON.parse(readFileSync(join(corpusDir(repoRoot), 'inventory.json'), 'utf8'))
  const ledger = {
    repoRoot, generatedBy: frag.generatedBy || 'crg-agentsmd', model: frag.model || 'session',
    inventory, minersPlanned: frag.minersPlanned || 0,
    rules: frag.rules || [], cut: frag.cut || [],
    scoring: null,
  }
  writeFileSync(join(base, 'ledger.json'), JSON.stringify(ledger, null, 2))
  return { ok: true, rules: ledger.rules.length, cut: ledger.cut.length }
}

// Exact-bytes file writer for persist agents: stdin -> path. Exists so a workflow agent
// can heredoc JSON to disk instead of a model echoing large payloads back as output.
export function writeStdinTo(path, stdin = 0) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, readFileSync(stdin))
  return path
}

// --- CLI -----------------------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const USAGE = 'usage: crg-agentsmd.corpus.mjs fetch|split|inventory|assemble <repoRoot> [arg] | write-file <absolutePath>\n'
  const [cmd, target, arg] = process.argv.slice(2)
  const die = m => { process.stderr.write(m); process.exit(1) }
  if (!target) die(USAGE)

  if (cmd === 'write-file') {
    const targetPath = target
    if (!/^\/[^\0]*$/.test(targetPath) || /\.\.(\/|$)/.test(targetPath)) die('write-file: path must be absolute with no ..\n')
    process.stdout.write(writeStdinTo(targetPath) + '\n')
  } else {
    const repoRoot = target
    const dir = corpusDir(repoRoot)
    if (cmd === 'fetch') {
      process.stdout.write(JSON.stringify(fetchCorpus(repoRoot, arg ? { maxPRs: Number(arg) } : {})) + '\n')
    } else if (cmd === 'split') {
      const prs = readJsonl(join(dir, 'prs.jsonl'))
      const result = splitHoldout(prs, arg ? Number(arg) : 0.2)
      mkdirSync(join(dir, 'holdout'), { recursive: true })
      writeFileSync(join(dir, 'holdout', 'prs.json'), JSON.stringify(result, null, 2))
      // Train-only views: miners read ONLY these files, so the holdout is enforced
      // structurally — held-out PRs' data never exists in what a miner can open.
      const held = new Set(result.holdout)
      const comments = readJsonl(join(dir, 'review-comments.jsonl'))
      writeJsonl(join(dir, 'train-review-comments.jsonl'), comments.filter(c => !held.has(c.pr)))
      writeJsonl(join(dir, 'train-prs.jsonl'), prs.filter(p => !held.has(p.number)))
      process.stdout.write(JSON.stringify({ holdout: result.holdout.length, reviewed: result.reviewed }) + '\n')
    } else if (cmd === 'inventory') {
      const prs = readJsonl(join(dir, 'prs.jsonl'))
      const comments = readJsonl(join(dir, 'review-comments.jsonl'))
      const gitRows = readJsonl(join(dir, 'git-history.jsonl'))
      const holdout = existsSync(join(dir, 'holdout', 'prs.json'))
        ? JSON.parse(readFileSync(join(dir, 'holdout', 'prs.json'), 'utf8')).holdout : []
      const inv = buildInventory({ prs, comments, gitRows, holdout, minReviewedPRs: arg ? Number(arg) : 30 })
      writeFileSync(join(dir, 'inventory.json'), JSON.stringify(inv, null, 2))
      process.stdout.write(JSON.stringify(inv, null, 2) + '\n')
    } else if (cmd === 'assemble') {
      process.stdout.write(JSON.stringify(assembleRulesLedger(repoRoot)) + '\n')
    } else die(USAGE)
  }
}
