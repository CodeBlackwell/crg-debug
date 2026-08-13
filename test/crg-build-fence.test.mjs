import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects: a wave only ever commits files the HUMAN approved at GATE-SPEC. A builder
// that edits outside its gap's files[] cannot launder that file into the commit
// allowlist by declaring it in its own filesTouched report.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-build.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { underFence, straysOutside, commitFilesOk }`)()

test('straysOutside names every file the builder touched outside its approved files[]', () => {
  // The reported repro: approved gap owns one page; the builder also edited CI config.
  const approved = ['apps/web/src/Page.tsx']
  const touched = ['apps/web/src/Page.tsx', '.github/workflows/ci.yml']
  assert.deepEqual(H.straysOutside(touched, approved), ['.github/workflows/ci.yml'])
})

test('straysOutside is empty for an honest builder, normalizing ./ and blanks', () => {
  assert.deepEqual(H.straysOutside(['./apps/web/src/Page.tsx', ''], ['apps/web/src/Page.tsx']), [])
  assert.deepEqual(H.straysOutside([], ['apps/web/src/Page.tsx']), [])
  assert.deepEqual(H.straysOutside(undefined, ['a.ts']), [])
})

test('straysOutside rejects everything when the gap approved no files at all', () => {
  assert.deepEqual(H.straysOutside(['a.ts'], []), ['a.ts'])
  assert.deepEqual(H.straysOutside(['a.ts'], undefined), ['a.ts'])
})

test('a fenced touch set is a valid commit allowlist; an unfenced one is not', () => {
  const approved = ['apps/web/src/Page.tsx']
  const touched = ['apps/web/src/Page.tsx', '.github/workflows/ci.yml']
  const allow = touched.filter(f => H.underFence(f, approved))
  assert.equal(H.commitFilesOk(touched, allow), false, 'the stray must not survive the allowlist')
  assert.equal(H.commitFilesOk(allow, allow), true)
})

test('the wave loop fences filesTouched BEFORE any gate runs', () => {
  // crg-ralph.js:781-789 does this in JS ahead of the gates; crg-build did not do it at all.
  const at = src.indexOf('const fenceOk = new Map()')
  assert.notEqual(at, -1, 'the wave loop must compute a fenceOk map from the approved files[]')
  assert.ok(src.indexOf('const results = (await ') < at, 'fencing must follow the builders')
  assert.ok(at < src.indexOf('const gateableA = '), 'fencing must precede Gate A')
  assert.match(src, /straysOutside\(\(r && r\.filesTouched\) \|\| \[\], g\.files \|\| \[\]\)/)
  assert.match(src, /const gateableA = results\.filter\(\(\{ g, r \}\) => r && !r\.stale && fenceOk\.get\(g\.gapId\)\)/)
})

test('the commit allowlist is derived from the approved gap files, not the report alone', () => {
  const at = src.indexOf('const allFiles = ')
  assert.notEqual(at, -1)
  const line = src.slice(at, src.indexOf('\n', at))
  assert.match(line, /underFence\(f, g\.files \|\| \[\]\)/, 'allFiles must be intersected with the approved files[]')
})
