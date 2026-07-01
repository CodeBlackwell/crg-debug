import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let dir
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'farm-db-'))
  process.env.CRG_FARM_DB = join(dir, 'nested', 'history.jsonl') // nested → tests mkdir
})
after(() => rmSync(dir, { recursive: true, force: true }))

// Imported AFTER the env var is set so dbPath() resolves to the temp file.
const { append, query, dbPath } = await import('../lib/farm-db.mjs')

test('append round-trips and stamps ts', () => {
  const r = append({ type: 'run', repo: 'numpy', farmRunId: 'f1' })
  assert.equal(r.type, 'run')
  assert.match(r.ts, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(query({ type: 'run' }).length, 1)
})

test('query filters by type/repo/keyOf', () => {
  append({ type: 'candidate', repo: 'numpy', keyOf: 'a.py::bug', farmRunId: 'f1' })
  append({ type: 'candidate', repo: 'sqlalchemy', keyOf: 'b.py::bug', farmRunId: 'f1' })
  assert.equal(query({ type: 'candidate' }).length, 2)
  assert.equal(query({ type: 'candidate', repo: 'numpy' }).length, 1)
  assert.equal(query({ keyOf: 'b.py::bug' })[0].repo, 'sqlalchemy')
})

test('cross-run dedup: a keyOf already shipped to a pr is detectable', () => {
  append({ type: 'pr', repo: 'numpy', keyOf: 'a.py::bug', url: 'http://pr/1', state: 'draft' })
  const shipped = new Set(query({ type: 'pr' }).map(r => r.keyOf))
  assert.ok(shipped.has('a.py::bug'))
  assert.ok(!shipped.has('b.py::bug'))
})

test('many appends stay one-line-per-record (no corruption)', () => {
  for (let i = 0; i < 50; i++) append({ type: 'gate', gate: 'GATE-DIFF', n: i })
  const lines = readFileSync(dbPath(), 'utf8').split('\n').filter(Boolean)
  for (const line of lines) JSON.parse(line) // every line must parse
  assert.equal(query({ type: 'gate' }).length, 50)
})

test('query on a missing db returns []', () => {
  process.env.CRG_FARM_DB = join(dir, 'does-not-exist.jsonl')
  assert.deepEqual(query({ type: 'run' }), [])
})
