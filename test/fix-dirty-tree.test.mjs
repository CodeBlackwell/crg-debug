// Protects the user's uncommitted work: a fix run that finds staged or modified tracked
// files does not start fixing, changes nothing, and says which files stopped it — while
// the bugs it found are still reported.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { fence, treeStatusCommand, treeStatusOf, treeRefusal }`)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()
const { ledgerDisk } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { ledgerDisk }`)()
const DISK = ledgerDisk(SRC)

const relay = (stdout, exitCode = 0) => ({ results: [{ command: 'status', exitCode, stdout }] })
const printed = (...rows) => relay(`${rows.join('\n')}\ncrg-tree-status ${rows.length}\n`)

// ---- the script's own judgment -----------------------------------------------------

test('the status rows are read as staged or changed, and counted against the last line', () => {
  assert.deepEqual(H.treeStatusOf(printed()), { staged: [], changed: [] })
  assert.deepEqual(H.treeStatusOf(printed('staged src/a.py', 'changed src/a.py', 'changed docs/my notes.md')), { staged: ['src/a.py'], changed: ['src/a.py', 'docs/my notes.md'] })
  assert.equal(H.treeStatusOf(null), null, 'a dead relay')
  assert.equal(H.treeStatusOf(relay('')), null, 'an empty stdout is never "clean"')
  assert.equal(H.treeStatusOf(relay('nothing to commit, working tree clean')), null, 'the agent\'s word for it')
  assert.equal(H.treeStatusOf(relay('staged src/a.py\ncrg-tree-status 2')), null, 'a row went missing in the relay')
  assert.equal(H.treeStatusOf(relay('crg-tree-status 0', 128)), null, 'a non-zero exit')
  assert.equal(H.treeStatusOf(relay('crg-tree-status 0\ncrg-tree-status 0')), null)
})

test('fix may start only on a tree that was checked and holds no uncommitted change to a tracked file', () => {
  assert.equal(H.treeRefusal({ staged: [], changed: [] }), '')
  assert.equal(H.treeRefusal(null), 'the working tree could not be checked for uncommitted changes')
  assert.equal(H.treeRefusal({ staged: ['a.py'], changed: [] }), 'the working tree had uncommitted changes in tracked files before the run (1 staged, 0 modified or deleted)')
  assert.equal(H.treeRefusal({ staged: [], changed: ['a.py', 'b.py'] }), 'the working tree had uncommitted changes in tracked files before the run (0 staged, 2 modified or deleted)')
})

// ---- a real repository ---------------------------------------------------------------

const withRepo = body => {
  const repo = mkdtempSync(join(tmpdir(), 'crg-dirty-'))
  const git = (...argv) => execFileSync('git', ['-C', repo, ...argv], { stdio: 'pipe' }).toString()
  const write = (file, text) => writeFileSync(join(repo, file), text)
  try {
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'dev@example.com')
    git('config', 'user.name', 'dev')
    mkdirSync(join(repo, 'src'))
    write('src/a.py', 'a = 1\n')
    write('src/b.py', 'b = 1\n')
    write('src/c.py', 'c = 1\n')
    git('add', '-A')
    git('commit', '-qm', 'init')
    return body({ repo, git, write })
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
}
const sh = command => execFileSync('sh', ['-c', command], { stdio: 'pipe' }).toString()
// What the guard decides for the tree as it stands, through the real command.
const verdictIn = repo => {
  const status = H.treeStatusOf(relay(sh(H.treeStatusCommand(repo))))
  return { status, refusal: H.treeRefusal(status) }
}
// Everything a refusal must leave alone. Read without letting git refresh the index, or
// the reading itself would hide a guard that rewrites it.
const stateOf = repo => {
  const quiet = (...argv) => execFileSync('git', ['-C', repo, ...argv], { stdio: 'pipe', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }).toString()
  return { index: readFileSync(join(repo, '.git/index')), head: quiet('rev-parse', 'HEAD'), branch: quiet('symbolic-ref', 'HEAD'), branches: quiet('branch', '-a'), status: quiet('status', '--porcelain'), stash: quiet('stash', 'list') }
}

test('a clean tree may be fixed, and so may one that only holds untracked files', () => withRepo(({ repo, write }) => {
  assert.deepEqual(verdictIn(repo), { status: { staged: [], changed: [] }, refusal: '' })
  write('notes.txt', 'mine\n')
  write('src/new_module.py', 'n = 1\n')
  assert.deepEqual(verdictIn(repo), { status: { staged: [], changed: [] }, refusal: '' }, 'untracked files do not block')
}))

test('a modified tracked file refuses, and so does a deleted one', () => withRepo(({ repo, write }) => {
  write('src/a.py', 'a = 2\n')
  unlinkSync(join(repo, 'src/b.py'))
  const { status, refusal } = verdictIn(repo)
  assert.deepEqual(status, { staged: [], changed: ['src/a.py', 'src/b.py'] })
  assert.match(refusal, /0 staged, 2 modified or deleted/)
}))

test('a staged file refuses, whether it is a new file, an edit, or an edit changed again since', () => withRepo(({ repo, git, write }) => {
  write('src/new_module.py', 'n = 1\n')
  write('src/a.py', 'a = 2\n')
  write('src/c.py', 'c = 2\n')
  git('add', 'src/new_module.py', 'src/a.py', 'src/c.py')
  write('src/c.py', 'c = 3\n')
  const { status, refusal } = verdictIn(repo)
  assert.deepEqual(status, { staged: ['src/a.py', 'src/c.py', 'src/new_module.py'], changed: ['src/c.py'] })
  assert.match(refusal, /3 staged, 1 modified or deleted/)
}))

test('looking at the tree changes nothing: branch, index and files are exactly as they were', () => withRepo(({ repo, git, write }) => {
  write('src/a.py', 'a = 2\n')
  write('src/c.py', 'c = 2\n')
  git('add', 'src/c.py')
  write('notes.txt', 'mine\n')
  // A file rewritten with the same bytes: status would normally refresh the index for it.
  write('src/b.py', 'b = 1\n')
  utimesSync(join(repo, 'src/b.py'), new Date(Date.now() + 5000), new Date(Date.now() + 5000))
  const before = stateOf(repo)
  assert.notEqual(verdictIn(repo).refusal, '')
  assert.deepEqual(stateOf(repo), before)
}))

test('a directory that is not a repository yet has nothing tracked to protect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'crg-norepo-'))
  try {
    writeFileSync(join(dir, 'a.py'), 'a = 1\n')
    assert.equal(sh(H.treeStatusCommand(dir)), 'crg-tree-status 0\n')
    assert.equal(verdictIn(dir).refusal, '')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---- stubbed runs --------------------------------------------------------------------

const TWO = [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const REFUSED = 'the working tree had uncommitted changes in tracked files before the run (1 staged, 1 modified or deleted)'

test('a fix run on a dirty tree does not start fixing, changes nothing, and names the files', async () => {
  const { result, labels, calls, logs } = await fixRun(SRC, { bugs: TWO, on: { 'tree-status': () => printed('staged src/alpha.py', 'changed README.md') } })
  assert.deepEqual(labels, ['tree-status', 'ingest-ledger'], 'no bootstrap, no branch, no fixer, no commit, no gate')
  assert.deepEqual(result.fix, {
    notStarted: REFUSED,
    tree: { staged: ['src/alpha.py'], changed: ['README.md'] },
    waves: [], fixed: [],
    unfixed: TWO.map(b => ({ ...b, reason: `fix not started — ${REFUSED}` })), conflicted: [],
    commits: [], uncommitted: [], needsDecision: [],
  })
  assert.equal(result.confirmedBugs.length, 2, 'what was found is still reported')
  assert.deepEqual([result.stats.fixed, result.stats.unfixed], [0, 2])
  assert.ok(logs.some(l => l.startsWith(`Fix will NOT start: ${REFUSED} — src/alpha.py, README.md. Commit or stash them and run again.`)))
  assert.equal(logs.at(-1), `Fix not started: 2 confirmed bug(s) left unfixed — ${REFUSED}`)

  const status = calls[0]
  assert.ok(status.prompt.includes(H.fence(H.treeStatusCommand('/tmp/crg-fixture'))), 'the status is the script\'s own command')
  assert.match(status.prompt, /Do NOT edit, stage, stash, reset or commit anything/)
  assert.deepEqual(status.opts.schema.required, ['results'])
})

test('a status that does not report is not a clean tree: fix does not start', async () => {
  const answers = [() => null, () => { throw new Error('retry cap') }, () => relay(''), () => relay('clean'), () => relay('staged src/alpha.py\ncrg-tree-status 2'), () => relay('crg-tree-status 0', 1)]
  for (const answer of answers) {
    const { result, labels } = await fixRun(SRC, { bugs: TWO, on: { 'tree-status': answer } })
    assert.deepEqual(labels, ['tree-status', 'ingest-ledger'])
    assert.equal(result.fix.notStarted, 'the working tree could not be checked for uncommitted changes')
    assert.equal(result.fix.tree, null)
    assert.equal(result.fix.unfixed.length, 2)
  }
})

test('a clean tree is fixed as before', async () => {
  const { result, labels } = await fixRun(SRC, { bugs: TWO })
  assert.deepEqual(labels.slice(0, 3), ['tree-status', 'ingest-ledger', 'fix-branch'])
  assert.equal(result.fix.notStarted, undefined)
  assert.equal(result.fix.fixed.length, 2)
})

// A whole sweep — Graph, Map, Discover, Verify — with fix on, over a stub that finds bugs.
const sweep = async (args, status) => {
  const calls = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push({ label, phase: opts.phase })
    if (label === 'tree-status') return status()
    if (label === 'setup') return { graphStats: '4 files', resolvedScope: 'full repo', toolchain: [{ package: 'app', test: 'pytest' }], baselineFailures: [] }
    if (label === 'map') return { overview: 'o', targets: [{ file: 'src/core.py', concern: 'backend-logic', functions: ['f'] }] }
    if (label.startsWith('find:')) return { audited: [], findings: [{ file: 'src/core.py:7', concern: 'backend-logic', symptom: `${label} symptom`, rootCause: `${label} root`, severity: 'High', whyRepro: 'in -> out', confidence: 'high' }] }
    if (label === 'dedup') return { duplicateGroups: [] }
    const onDisk = DISK.answer(prompt)
    if (onDisk !== undefined) return onDisk
    if (opts.phase === 'Verify' && opts.schema) return { confirmed: true, reason: 'reproduced', classification: 'real-bug' }
    return 'written'
  }
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
  const run = new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC.replace(/^export\s+const\s+meta/m, 'const meta'))
  const result = await run({ repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md', ...args }, (prompt, opts) => Promise.resolve(agent(prompt, opts)).then(r => (r === undefined ? r : JSON.parse(JSON.stringify(r)))), thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows))), () => {}, undefined, () => {})
  return { result, calls }
}

test('on a dirty tree Discover and Verify still run and report; only Fix is held back', async () => {
  const { result, calls } = await sweep({ fix: true }, () => printed('changed src/core.py'))
  assert.equal(calls[0].label, 'tree-status', 'the tree is looked at before the run writes anything')
  assert.equal(calls[1].label, 'setup')
  assert.ok(result.confirmedBugs.length > 0)
  assert.ok(calls.some(c => c.phase === 'Verify'))
  assert.equal(calls.some(c => c.phase === 'Fix'), false, 'not one Fix-phase agent is called')
  assert.match(result.fix.notStarted, /0 staged, 1 modified or deleted/)
  assert.equal(result.fix.unfixed.length, result.confirmedBugs.length)
})

test('a run that is not asked to fix never looks at the tree', async () => {
  const { calls } = await sweep({}, () => { throw new Error('must not be asked') })
  assert.equal(calls.some(c => c.label === 'tree-status'), false)
})
