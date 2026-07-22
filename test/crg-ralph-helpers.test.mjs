import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-ralph.js (evaled whole by the workflow runtime, not importable)
// and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-ralph.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const packStories'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, norm, capText, resolveModel, clampInt, normPath, TIERS, tiersFrom, underFence, fencesOverlap, fenceOf, commitMessageOk, porcelainOf, rowFiles, porcelainFiles, branchSlug, waveCommitMessage, laneOf, rankStories, packStories, HARNESS_DIRS }`,
)()

const story = (id, over = {}) => ({ id, title: `story ${id}`, files: [`src/${id}.py`], claimedNew: [], dependsOn: [], ...over })

// ---- fences ---------------------------------------------------------------------

test('underFence matches exact files and directory prefixes, normalizing ./ and trailing /', () => {
  assert.equal(H.underFence('src/a.py', ['src/a.py']), true)
  assert.equal(H.underFence('./src/a.py', ['src/']), true)
  assert.equal(H.underFence('shared/src/trader_shared/assets.py', ['shared/src/trader_shared/']), true)
  assert.equal(H.underFence('shared/src/trader_sharedX/a.py', ['shared/src/trader_shared/']), false, 'prefix match is path-segment-aware')
  assert.equal(H.underFence('src/a.py', ['src/b.py']), false)
  assert.equal(H.underFence('src', ['src/deep/file.py']), true, 'a parent dir accounts for entries beneath it (porcelain dir rows)')
})

test('fencesOverlap detects file/dir collisions in either direction', () => {
  assert.equal(H.fencesOverlap(['services/dp/'], ['services/dp/service.py']), true)
  assert.equal(H.fencesOverlap(['services/dp/service.py'], ['services/dp/']), true)
  assert.equal(H.fencesOverlap(['services/dp/'], ['services/ss/']), false)
  assert.equal(H.fencesOverlap([], ['x.py']), false)
})

test('fenceOf unions files + claimedNew, deduped and normalized', () => {
  assert.deepEqual(H.fenceOf({ files: ['./a.py', 'b/'], claimedNew: ['a.py', 'c.py'] }), ['a.py', 'b', 'c.py'])
})

// ---- ladder ---------------------------------------------------------------------

test('tiersFrom climbs strictly upward from start to maxTier', () => {
  assert.deepEqual(H.tiersFrom('haiku', 'opus'), ['haiku', 'sonnet', 'opus'])
  assert.deepEqual(H.tiersFrom('sonnet', 'sonnet'), ['sonnet'])
  assert.deepEqual(H.tiersFrom('bogus', 'bogus'), ['haiku', 'sonnet', 'opus'])
})

// ---- lanes + ranking ------------------------------------------------------------

test('laneOf: declared lane wins; else majority community; else top dir of first new path', () => {
  const communities = new Map([['src/a.py', 'core'], ['src/b.py', 'core'], ['ui/c.tsx', 'ui']])
  assert.equal(H.laneOf({ lane: 'dp-health', files: ['src/a.py'] }, communities), 'dp-health')
  assert.equal(H.laneOf({ files: ['src/a.py', 'src/b.py', 'ui/c.tsx'] }, communities), 'core')
  assert.equal(H.laneOf({ files: [], claimedNew: ['scripts/forex/backfill.py'] }, communities), 'scripts')
  assert.equal(H.laneOf({ files: [], claimedNew: ['README.md'] }, communities), 'misc')
})

test('rankStories puts hub-touching stories first, stable otherwise', () => {
  const s1 = story('a')
  const s2 = story('b', { files: ['shared/hub.py'] })
  const s3 = story('c')
  assert.deepEqual(H.rankStories([s1, s2, s3], ['shared/hub.py']).map(s => s.id), ['b', 'a', 'c'])
  const hubDir = story('d', { files: ['shared/'] })
  assert.equal(H.rankStories([s1, hubDir], ['shared/hub.py'])[0].id, 'd', 'a dir fence containing a hub counts as hub-touching')
})

// ---- packStories ----------------------------------------------------------------

test('packStories: dependency strictly precedes dependent', () => {
  const { waves } = H.packStories([story('a', { dependsOn: ['b'] }), story('b')])
  const waveOf = id => waves.findIndex(w => w.some(s => s.id === id))
  assert.ok(waveOf('b') >= 0 && waveOf('a') > waveOf('b'))
})

test('packStories: overlapping fences (file vs owning dir) never share a wave', () => {
  const { waves } = H.packStories([
    story('a', { files: ['services/dp/'] }),
    story('b', { files: ['services/dp/service.py'] }),
    story('c', { files: ['services/ss/x.py'] }),
  ])
  for (const w of waves) {
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j < w.length; j++) {
      assert.equal(H.fencesOverlap(H.fenceOf(w[i]), H.fenceOf(w[j])), false, `${w[i].id}/${w[j].id} overlap in one wave`)
    }
  }
  assert.equal(waves.flat().length, 3)
})

test('packStories honors caps, deferring the overflow with dep cascade', () => {
  const stories = [
    story('a'), story('b', { files: ['src/b.py'] }), story('c', { files: ['src/c.py'] }),
    story('d', { dependsOn: ['c'], files: ['src/d.py'] }),
  ]
  const { waves, deferredByCap } = H.packStories(stories, { maxPerWave: 2, maxWaves: 1 })
  assert.equal(waves.flat().length, 2)
  assert.deepEqual(deferredByCap.map(s => s.id).sort(), ['c', 'd'])
})

test('packStories: cycles break deterministically toward the earlier-ranked story', () => {
  const run = () => H.packStories([story('a', { dependsOn: ['b'] }), story('b', { dependsOn: ['a'] })])
  const { waves, cycleBroken } = run()
  assert.equal(waves.flat().length, 2)
  assert.equal(cycleBroken[0].id, 'b')
  assert.deepEqual(run(), run(), 'pure function of its input')
})

test('packStories: Army waveHint deps serialize declared waves (foundation before all)', () => {
  // Mirrors the FOREX dogfood: wave-0 foundation, wave-1 lanes with disjoint dir fences.
  const stories = [
    story('US-001', { files: ['shared/src/trader_shared/'] }),
    story('US-010', { files: ['services/dp/connectors/'], dependsOn: ['US-001'] }),
    story('US-030', { files: ['services/ss/engine/'], dependsOn: ['US-001'] }),
  ]
  const { waves } = H.packStories(stories)
  assert.equal(waves[0].length, 1)
  assert.equal(waves[0][0].id, 'US-001')
  assert.deepEqual(waves[1].map(s => s.id).sort(), ['US-010', 'US-030'], 'disjoint lanes parallelize in one wave')
})

// ---- git plumbing readers -------------------------------------------------------

test('porcelainOf canonicalizes the status row; porcelainFiles strips the XY column', () => {
  const rows = [{ command: 'git -C /r status --porcelain', exitCode: 0, stdout: ' M b.py\n?? a/new.py\n' }]
  assert.equal(H.porcelainOf(rows), ' M b.py\n?? a/new.py')
  assert.deepEqual(H.porcelainFiles(H.porcelainOf(rows)), ['b.py', 'a/new.py'])
  assert.equal(H.porcelainOf([{ command: 'git add', exitCode: 0 }]), null)
})

test('rowFiles pulls the diff-tree file list', () => {
  const rows = [{ command: 'git -C /r diff-tree --no-commit-id --name-only -r HEAD', exitCode: 0, stdout: 'a.py\n./b.py\n' }]
  assert.deepEqual(H.rowFiles(rows, /diff-tree/), ['a.py', 'b.py'])
  assert.equal(H.rowFiles(rows, /rev-parse/), null)
})

// ---- commit hygiene -------------------------------------------------------------

test('commitMessageOk enforces the no-attribution rule and a real message', () => {
  assert.equal(H.commitMessageOk('spice: forex asset taxonomy; market calendar'), true)
  for (const bad of ['', 'short msg', 'Fix by Claude', 'x: y (Anthropic)', 'feat\n\nCo-Authored-By: bot']) {
    assert.equal(H.commitMessageOk(bad), false, bad)
  }
})

test('waveCommitMessage joins titles under the project prefix, capped', () => {
  const m = H.waveCommitMessage('spice', [{ title: 'asset taxonomy' }, { title: 'market calendar' }])
  assert.equal(m, 'spice: asset taxonomy; market calendar')
  assert.ok(H.waveCommitMessage('p', [{ title: 'x'.repeat(400) }]).length <= 160)
})

test('branchSlug is deterministic and order-insensitive', () => {
  assert.equal(H.branchSlug(['a', 'b']), H.branchSlug(['b', 'a']))
  assert.notEqual(H.branchSlug(['a']), H.branchSlug(['b']))
})
