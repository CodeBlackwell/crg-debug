import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIssueRef, parseRemote } from '../lib/issue-ref.mjs'

const SSH = 'git@github.com:CodeBlackwell/crg-debug.git'
const HTTPS = 'https://github.com/CodeBlackwell/crg-debug.git'

test('full issue URL → github target', () => {
  const r = parseIssueRef('https://github.com/cli/cli/issues/42')
  assert.deepEqual(r, {
    kind: 'github', owner: 'cli', repo: 'cli', number: 42,
    ref: 'cli/cli#42', url: 'https://github.com/cli/cli/issues/42',
  })
})

test('owner/repo#n → github target', () => {
  const r = parseIssueRef('CodeBlackwell/crg-debug#7')
  assert.equal(r.kind, 'github')
  assert.equal(r.ref, 'CodeBlackwell/crg-debug#7')
  assert.equal(r.number, 7)
})

test('bare #n resolves owner/repo from ssh origin', () => {
  const r = parseIssueRef('#5', SSH)
  assert.equal(r.ref, 'CodeBlackwell/crg-debug#5')
  assert.equal(r.url, 'https://github.com/CodeBlackwell/crg-debug/issues/5')
})

test('bare #n resolves owner/repo from https origin', () => {
  assert.equal(parseIssueRef('#5', HTTPS).ref, 'CodeBlackwell/crg-debug#5')
})

test('bare #n with no origin → github with bare ref (gh uses cwd default)', () => {
  const r = parseIssueRef('#9')
  assert.equal(r.kind, 'github')
  assert.equal(r.number, 9)
  assert.equal(r.ref, '#9')
  assert.equal(r.url, undefined)
})

test('non-ref text → paste fallback', () => {
  assert.deepEqual(parseIssueRef('login crashes on empty password'), {
    kind: 'paste', text: 'login crashes on empty password',
  })
})

test('a path-like scope is not mistaken for owner/repo#n', () => {
  assert.equal(parseIssueRef('src/auth/login.ts').kind, 'paste')
})

test('empty / whitespace → empty', () => {
  assert.equal(parseIssueRef('').kind, 'empty')
  assert.equal(parseIssueRef('   ').kind, 'empty')
  assert.equal(parseIssueRef(undefined).kind, 'empty')
})

test('parseRemote handles ssh, https, .git suffix, and rejects non-github', () => {
  assert.deepEqual(parseRemote(SSH), { owner: 'CodeBlackwell', repo: 'crg-debug' })
  assert.deepEqual(parseRemote(HTTPS), { owner: 'CodeBlackwell', repo: 'crg-debug' })
  assert.deepEqual(parseRemote('https://github.com/a/b'), { owner: 'a', repo: 'b' })
  assert.equal(parseRemote('git@gitlab.com:a/b.git'), null)
  assert.equal(parseRemote(''), null)
})
