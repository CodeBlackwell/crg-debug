import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { keyOf as ledgerKeyOf } from '../lib/ledger-slice.mjs'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-debug.js (which can't be imported — the workflow runtime evals it
// whole with injected globals) and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const fence'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, stripLine, keyOf, shortFile, bugFile, resolveModel, clampRounds, capText, normPath, isSafeAbs, relPath, groupBy, dedupBy, allGreen, waveKey, commitMessageOk, commitFilesOk, branchSlug, waveCommitMessage }`,
)()

test('fence wraps content and neutralizes injected fence markers', () => {
  const out = H.fence('hello')
  assert.match(out, /^<<<UNTRUSTED\nhello\nUNTRUSTED>>>$/)
  assert.ok(!H.fence('x UNTRUSTED>>> y').includes('UNTRUSTED>>> y'), 'escape sequence must not leak through')
  assert.equal(H.fence(null), '<<<UNTRUSTED\n\nUNTRUSTED>>>')
})

test('norm lowercases, trims, and collapses whitespace', () => {
  assert.equal(H.norm('  Foo   Bar\tBaz \n'), 'foo bar baz')
  assert.equal(H.norm(null), '')
})

test('keyOf builds a file::rootCause dedup key from normalized parts', () => {
  assert.equal(H.keyOf({ file: 'Src/A.ts:12', rootCause: 'Off  by ONE' }), 'src/a.ts:12::off by one')
  assert.equal(H.keyOf(null), '::')
})

// CLAUDE.md invariant: lib/ledger-slice.mjs slices ledgers by this exact identity, so
// any drift silently drops bugs from an escalation or gate-triage re-fix run.
test('keyOf stays in parity with the lib/ledger-slice.mjs twin', () => {
  const cases = [
    { file: 'Src/A.ts:12', rootCause: 'Off  by ONE' },
    { file: 'a.py', rootCause: '' },
    { file: '', rootCause: 'x' },
    {},
    null,
    undefined,
  ]
  for (const c of cases) assert.equal(H.keyOf(c), ledgerKeyOf(c), `drift on ${JSON.stringify(c)}`)
})

test('stripLine drops the :line suffix and nothing else', () => {
  assert.equal(H.stripLine('a/b/c.py:42'), 'a/b/c.py')
  assert.equal(H.stripLine('a/b/c.py'), 'a/b/c.py')
  assert.equal(H.stripLine(null), '')
})

test('shortFile strips line suffix and directories', () => {
  assert.equal(H.shortFile('src/util/dates.ts:88'), 'dates.ts')
  assert.equal(H.shortFile(''), '')
})

test('bugFile strips the line suffix only', () => {
  assert.equal(H.bugFile({ file: 'a/b/c.py:42' }), 'a/b/c.py')
  assert.equal(H.bugFile({}), '')
  assert.equal(H.bugFile(null), '')
})

// The thrash guard must ignore line drift: wave 1's edit shifts wave 2's reported line,
// and a line-sensitive key would read the same failed bug as a brand new one forever.
test('waveKey is line-insensitive, unlike keyOf', () => {
  const b1 = { file: 'src/a.py:10', rootCause: 'Inverted  guard' }
  const b2 = { file: 'src/a.py:37', rootCause: 'inverted guard' }
  assert.equal(H.waveKey(b1), H.waveKey(b2))
  assert.notEqual(H.keyOf(b1), H.keyOf(b2))
  assert.equal(H.waveKey(null), '::')
})

test('resolveModel defaults to haiku and honors overrides', () => {
  assert.equal(H.resolveModel(undefined), 'haiku')
  assert.equal(H.resolveModel(''), 'haiku')
  assert.equal(H.resolveModel('opus'), 'opus')
  assert.equal(H.resolveModel(null), undefined)
  assert.equal(H.resolveModel('session'), undefined)
})

test('clampRounds floors at 1, coerces junk to 1, and yields an integer loop bound', () => {
  assert.equal(H.clampRounds(undefined), 1)
  assert.equal(H.clampRounds(0), 1)
  assert.equal(H.clampRounds(-3), 1)
  assert.equal(H.clampRounds('4'), 4)
  assert.equal(H.clampRounds(2.9), 2)
})

test('isSafeAbs demands an absolute path with no traversal', () => {
  assert.equal(H.isSafeAbs('/repo/sub'), true)
  assert.equal(H.isSafeAbs('relative/path'), false)
  assert.equal(H.isSafeAbs(''), false)
  assert.equal(H.isSafeAbs('/repo/../etc'), false)
  assert.equal(H.isSafeAbs('/repo/..'), false)
  assert.equal(H.isSafeAbs('/repo/a..b/c'), true, 'dots inside a name are not traversal')
})

test('groupBy buckets in encounter order and drops null keys', () => {
  const items = [{ c: 'x', n: 1 }, { c: 'y', n: 2 }, { c: 'x', n: 3 }, { c: null, n: 4 }]
  const g = H.groupBy(items, i => i.c)
  assert.deepEqual([...g.keys()], ['x', 'y'])
  assert.deepEqual(g.get('x').map(i => i.n), [1, 3])
  assert.equal(H.groupBy(null, i => i).size, 0)
})

test('dedupBy keeps the first occurrence of each key, in order', () => {
  const items = [{ k: 'a', v: 1 }, { k: 'b', v: 2 }, { k: 'a', v: 3 }]
  assert.deepEqual(H.dedupBy(items, i => i.k).map(i => i.v), [1, 2])
  assert.deepEqual(H.dedupBy([], i => i), [])
})

// The single exit-code verdict every gate in the workflow routes through.
test('allGreen requires at least one command and every exit code 0', () => {
  assert.equal(H.allGreen({ results: [{ exitCode: 0 }, { exitCode: 0 }] }), true)
  assert.equal(H.allGreen({ results: [{ exitCode: 0 }, { exitCode: 1 }] }), false)
  assert.equal(H.allGreen({ results: [] }), false, 'no command run is not a pass')
  assert.equal(H.allGreen(null), false)
  assert.equal(H.allGreen(undefined), false)
  assert.equal(H.allGreen({}), false)
})

test('allGreen with a picker judges only the matching rows, and needs at least one', () => {
  const res = { results: [{ command: 'git checkout -b x', exitCode: 0 }, { command: 'code-review-graph update', exitCode: 1 }] }
  const isGit = r => /git /.test(r.command || '')
  assert.equal(H.allGreen(res, isGit), true, 'a non-git failure must not veto the branch step')
  assert.equal(H.allGreen(res), false, 'without a picker every row counts')
  assert.equal(
    H.allGreen({ results: [{ command: 'code-review-graph update', exitCode: 0 }] }, isGit),
    false,
    'zero git rows means checkout never ran',
  )
})

test('capText trims and caps length', () => {
  assert.equal(H.capText('  hi  ', 4000), 'hi')
  assert.equal(H.capText(undefined, 4000), '')
  assert.equal(H.capText('a'.repeat(5000), 4000).length, 4000)
})

test('relPath strips the repo root from absolute ledger paths, leaves relative ones', () => {
  assert.equal(H.relPath('/repo/src/a.py', '/repo'), 'src/a.py')
  assert.equal(H.relPath('/repo/src/a.py', '/repo/'), 'src/a.py')
  assert.equal(H.relPath('src/a.py', '/repo'), 'src/a.py')
  assert.equal(H.relPath('./src/a.py', '/repo'), 'src/a.py')
  assert.equal(H.relPath('/other/src/a.py', '/repo'), '/other/src/a.py')
})

test('commitMessageOk enforces length and the no-attribution gate', () => {
  assert.equal(H.commitMessageOk('Fix rate_limiter.py, auth.py'), true)
  assert.equal(H.commitMessageOk('short'), false)
  assert.equal(H.commitMessageOk('Fixed by Claude in one pass'), false)
  assert.equal(H.commitMessageOk('adds Co-Authored-By trailer here'), false)
  assert.equal(H.commitMessageOk(''), false)
})

test('commitFilesOk requires a non-empty subset of the allowlist', () => {
  assert.equal(H.commitFilesOk(['src/a.py', 'tests/test_a.py'], ['src/a.py', 'tests/test_a.py']), true)
  assert.equal(H.commitFilesOk(['src/a.py'], ['src/a.py', 'tests/test_a.py']), true)
  assert.equal(H.commitFilesOk(['src/a.py', 'stray.md'], ['src/a.py']), false)
  assert.equal(H.commitFilesOk([], ['src/a.py']), false)
  assert.equal(H.commitFilesOk(['./src/a.py'], ['src/a.py']), true)
})

test('branchSlug is deterministic and order-insensitive over the bug set', () => {
  const bugs = [{ file: 'a.py', rootCause: 'x' }, { file: 'b.py', rootCause: 'y' }]
  const flipped = [bugs[1], bugs[0]]
  assert.equal(H.branchSlug(bugs), H.branchSlug(flipped))
  assert.notEqual(H.branchSlug(bugs), H.branchSlug([{ file: 'c.py', rootCause: 'z' }]))
  assert.match(H.branchSlug(bugs), /^[a-z0-9]+$/)
})

test('waveCommitMessage uses only file names, dedupes, and stays within 72 chars', () => {
  const bugs = [
    { file: 'src/a.py:12', rootCause: 'mentions Claude and CLAUDE.md' },
    { file: 'src/a.py:80', rootCause: 'x' },
    { file: 'src/b.ts', rootCause: 'y' },
  ]
  const msg = H.waveCommitMessage(bugs)
  assert.equal(msg, 'Fix a.py, b.ts')
  assert.equal(H.commitMessageOk(msg), true)
  const many = Array.from({ length: 30 }, (_, i) => ({ file: `dir/file-${i}-long-name.py` }))
  assert.ok(H.waveCommitMessage(many).length <= 72)
})
