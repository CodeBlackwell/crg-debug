import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-debug.js (which can't be imported — the workflow runtime evals it
// whole with injected globals) and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const fence'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, keyOf, shortFile, bugFile, resolveModel, clampRounds, capText, normPath, relPath, commitMessageOk, commitFilesOk, branchSlug, waveCommitMessage }`,
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
})

test('shortFile strips line suffix and directories', () => {
  assert.equal(H.shortFile('src/util/dates.ts:88'), 'dates.ts')
  assert.equal(H.shortFile(''), '')
})

test('bugFile strips the line suffix only', () => {
  assert.equal(H.bugFile({ file: 'a/b/c.py:42' }), 'a/b/c.py')
  assert.equal(H.bugFile({}), '')
})

test('resolveModel defaults to haiku and honors overrides', () => {
  assert.equal(H.resolveModel(undefined), 'haiku')
  assert.equal(H.resolveModel(''), 'haiku')
  assert.equal(H.resolveModel('opus'), 'opus')
  assert.equal(H.resolveModel(null), undefined)
  assert.equal(H.resolveModel('session'), undefined)
})

test('clampRounds floors at 1 and coerces junk to 1', () => {
  assert.equal(H.clampRounds(undefined), 1)
  assert.equal(H.clampRounds(0), 1)
  assert.equal(H.clampRounds(-3), 1)
  assert.equal(H.clampRounds('4'), 4)
  assert.equal(H.clampRounds(2.9), 2.9)
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
