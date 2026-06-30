// Parse an issue/ticket reference into a structured target. Pure functions +
// a CLI entry so SKILL.md can resolve refs deterministically:
//   node issue-ref.mjs "<input>" "[git origin url]"  ->  JSON on stdout

// Derive owner/repo from a git remote URL (ssh or https), or null if not GitHub.
export function parseRemote(url) {
  const m = String(url || '').trim().match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

const gh = (owner, repo, number) => ({
  kind: 'github',
  owner,
  repo,
  number: Number(number),
  ref: owner && repo ? `${owner}/${repo}#${number}` : `#${number}`,
  url: owner && repo ? `https://github.com/${owner}/${repo}/issues/${number}` : undefined,
})

// kind: 'github' (fetch via gh), 'paste' (use text verbatim), or 'empty' (no issue).
export function parseIssueRef(input, originUrl) {
  const s = String(input || '').trim()
  if (!s) return { kind: 'empty' }
  let m
  if ((m = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/))) return gh(m[1], m[2], m[3])
  if ((m = s.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/))) return gh(m[1], m[2], m[3])
  if ((m = s.match(/^#(\d+)$/))) {
    const r = parseRemote(originUrl)
    return gh(r && r.owner, r && r.repo, m[1])
  }
  return { kind: 'paste', text: s }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(JSON.stringify(parseIssueRef(process.argv[2], process.argv[3])))
}
