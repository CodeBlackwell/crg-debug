import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Test the REAL shipped helpers: extract the dependency-free block from
// workflows/crg-ui.js (evaled whole by the workflow runtime, not importable)
// and eval just that block. Zero duplication, no drift.
const src = readFileSync(fileURLToPath(new URL('../workflows/crg-ui.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
assert.ok(block.includes('const compareMeasures'), 'pure-helpers block markers must bracket the helpers')
const H = new Function(
  `${block}\nreturn { fence, capText, resolveModel, normPath, slugOf, globToRegex, matchesAnyGlob, validateEdits, TIERS, startTier, tiersFrom, groupUnits, compareMeasures, parseKey, priorAttemptText, boxArea, boxContains, sealOf, porcelainOf, rowFiles, isSubset }`,
)()

// ---- model ladder -----------------------------------------------------------------

test('startTier routes by worst class in the unit', () => {
  assert.equal(H.startTier(['token']), 'haiku')
  assert.equal(H.startTier(['typography', 'token']), 'haiku')
  assert.equal(H.startTier(['token', 'layout']), 'sonnet')
  assert.equal(H.startTier(['missing-element']), 'sonnet')
  assert.equal(H.startTier(['responsive-breakage']), 'sonnet')
})

test('tiersFrom climbs strictly upward and respects maxTier', () => {
  assert.deepEqual(H.tiersFrom('haiku', 'opus'), ['haiku', 'sonnet', 'opus'])
  assert.deepEqual(H.tiersFrom('sonnet', 'sonnet'), ['sonnet'], 'capped ladder never escalates past maxTier')
  assert.deepEqual(H.tiersFrom('haiku', 'sonnet'), ['haiku', 'sonnet'])
  assert.deepEqual(H.tiersFrom('opus', 'opus'), ['opus'])
})

// ---- unit grouping -----------------------------------------------------------------

test('groupUnits groups by (screen, component-or-token)', () => {
  const units = H.groupUnits([
    { key: 'Home::Desktop::layout::1:1', screen: 'Home', class: 'layout', component: 'Hero' },
    { key: 'Home::Desktop::typography::1:1', screen: 'Home', class: 'typography', component: 'Hero' },
    { key: 'Home::Desktop::token::color/primary', screen: 'Home', class: 'token', token: 'color/primary' },
    { key: 'Pricing::Desktop::layout::2:1', screen: 'Pricing', class: 'layout', component: 'Hero' },
  ])
  assert.equal(units.length, 3)
  assert.deepEqual(units.map(u => [u.screen, u.subject, u.discrepancies.length]),
    [['Home', 'Hero', 2], ['Home', 'color/primary', 1], ['Pricing', 'Hero', 1]])
  assert.deepEqual(units.map(u => u.unitId), ['u-001', 'u-002', 'u-003'])
  assert.equal(units.spilled, 0)
})

const miss = (component, id, box, extra = {}) => ({
  key: `Home::Desktop::missing-element::${id}`, screen: 'Home', breakpoint: 'Desktop',
  class: 'missing-element', component, figmaNodeId: id, expected: box, ...extra,
})

test('groupUnits: a missing-element container absorbs contained discrepancies of any class', () => {
  const units = H.groupUnits([
    miss('KpiStrip', '2:4', { x: 0, y: 100, width: 1440, height: 120 }),
    miss('KpiCard', '3:22', { x: 20, y: 110, width: 160, height: 100 }),
    { key: 'Home::Desktop::layout::3:25', screen: 'Home', breakpoint: 'Desktop', class: 'layout', component: 'KpiLabel', figmaNodeId: '3:25', expected: { x: 200, y: 110, width: 160, height: 100 } },
  ])
  assert.equal(units.length, 1, 'container + children collapse to one unit')
  assert.equal(units[0].subject, 'KpiStrip', 'subject is the largest missing-element container')
  assert.equal(units[0].discrepancies.length, 3)
})

test('groupUnits: overlap without containment, zero-area boxes, and non-missing containers never merge', () => {
  const units = H.groupUnits([
    miss('A', '1:1', { x: 0, y: 0, width: 100, height: 100 }),
    miss('B', '1:2', { x: 50, y: 50, width: 100, height: 100 }), // overlaps A, not contained
    miss('C', '1:3', { x: 10, y: 10, width: 0, height: 0 }),      // zero-area: inside everything, merges nothing
    { key: 'Home::Desktop::layout::1:4', screen: 'Home', breakpoint: 'Desktop', class: 'layout', component: 'D', figmaNodeId: '1:4', expected: { x: 0, y: 0, width: 200, height: 200 } }, // layout "container" absorbs nothing
    miss('E', '1:5', { x: 300, y: 300, width: 10, height: 10 }),
  ])
  assert.equal(units.length, 5, 'no containment edge fires')
})

test('groupUnits: epsilon slack merges a 1px overflow; different breakpoints never merge', () => {
  const withSlack = H.groupUnits([
    miss('Wrap', '2:1', { x: 0, y: 0, width: 100, height: 100 }),
    miss('Child', '2:2', { x: -1, y: 0, width: 50, height: 50 }), // 1px overflow
  ], { eps: 1 })
  assert.equal(withSlack.length, 1, 'tolerancePx slack absorbs figma child overflow')
  const acrossBp = H.groupUnits([
    miss('Wrap', '2:1', { x: 0, y: 0, width: 100, height: 100 }),
    { ...miss('Child', '2:2', { x: 10, y: 10, width: 50, height: 50 }), breakpoint: 'Mobile', key: 'Home::Mobile::missing-element::2:2' },
  ])
  assert.equal(acrossBp.length, 2, 'containment is per (screen, breakpoint)')
})

test('groupUnits: identical boxes merge deterministically; the size cap spills instead of truncating', () => {
  const twins = H.groupUnits([
    miss('TwinA', '5:1', { x: 0, y: 0, width: 50, height: 50 }),
    miss('TwinB', '5:2', { x: 0, y: 0, width: 50, height: 50 }),
  ])
  assert.equal(twins.length, 1, 'mutual containment unions into one unit')
  const capped = H.groupUnits([
    miss('Wrap', '6:1', { x: 0, y: 0, width: 1000, height: 1000 }),
    miss('C1', '6:2', { x: 10, y: 10, width: 50, height: 50 }),
    miss('C2', '6:3', { x: 100, y: 10, width: 50, height: 50 }),
  ], { cap: 2 })
  assert.equal(capped.spilled, 1, 'the merge past the cap is counted, not silent')
  assert.equal(capped.reduce((n, u) => n + u.discrepancies.length, 0), 3, 'nothing is dropped')
})

// ---- verify judge -------------------------------------------------------------------

const PFX = ['Home::Desktop::']

test('compareMeasures: green iff unit keys vanish and nothing new appears', () => {
  const baseline = ['Home::Desktop::layout::1:1', 'Home::Desktop::token::color/primary', 'Home::Desktop::layout::1:9']
  const unit = ['Home::Desktop::layout::1:1']
  assert.deepEqual(
    H.compareMeasures(unit, baseline, ['Home::Desktop::token::color/primary', 'Home::Desktop::layout::1:9'], PFX),
    { green: true, unresolved: [], regressions: [], transitions: [], warnings: [] },
    'unit resolved, pre-existing others untouched -> green',
  )
  const stillThere = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::1:1'], PFX)
  assert.equal(stillThere.green, false)
  assert.deepEqual(stillThere.unresolved, unit)
  const brokeNeighbor = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::9:9'], PFX)
  assert.equal(brokeNeighbor.green, false, 'a fix that breaks a fine node is red, even with its own key resolved')
  assert.deepEqual(brokeNeighbor.regressions, ['Home::Desktop::layout::9:9'])
})

test('compareMeasures: a unit node re-classified by the fix is a transition (red with feedback), not a regression', () => {
  const baseline = ['Home::Desktop::missing-element::3:2']
  const unit = ['Home::Desktop::missing-element::3:2']
  const v = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::3:2'], PFX)
  assert.equal(v.green, false, 'the node is still outside tolerance')
  assert.deepEqual(v.regressions, [], 'constructive progress is not damage')
  assert.deepEqual(v.transitions, [{ nodeKey: 'Home::Desktop::3:2', from: ['missing-element'], to: 'layout', key: 'Home::Desktop::layout::3:2' }])
})

test('compareMeasures: materializing ANOTHER unit\'s baseline missing-element is green with a warning', () => {
  const baseline = ['Home::Desktop::missing-element::2:4', 'Home::Desktop::missing-element::3:22']
  const unit = ['Home::Desktop::missing-element::2:4']
  const v = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::3:22'], PFX)
  assert.equal(v.green, true, 'the 7-children case: tolerated, its own unit will finish the job')
  assert.deepEqual(v.regressions, [])
  assert.deepEqual(v.warnings, [{ nodeKey: 'Home::Desktop::3:22', from: ['missing-element'], to: 'layout', key: 'Home::Desktop::layout::3:22' }])
})

test('compareMeasures: a node flipping TO missing-element is destruction — always a regression', () => {
  const baseline = ['Home::Desktop::layout::2:3', 'Home::Desktop::missing-element::9:9']
  const v = H.compareMeasures([], baseline, ['Home::Desktop::missing-element::2:3'], PFX)
  assert.equal(v.green, false)
  assert.deepEqual(v.regressions, ['Home::Desktop::missing-element::2:3'], 'an existing element was destroyed')
})

test('compareMeasures: a pre-existing sibling-class key in baseline is never a transition', () => {
  const baseline = ['Home::Desktop::layout::1:1', 'Home::Desktop::typography::1:1']
  const unit = ['Home::Desktop::layout::1:1']
  const v = H.compareMeasures(unit, baseline, ['Home::Desktop::typography::1:1'], PFX)
  assert.equal(v.green, true, 'the untouched typography layer on the same node was already in the baseline')
  assert.deepEqual(v.transitions, [])
})

test('compareMeasures: token keys keep exact-key semantics — no node unification', () => {
  const baseline = ['Home::Desktop::layout::3:2']
  const v = H.compareMeasures([], baseline, ['Home::Desktop::token::3:2'], PFX)
  assert.deepEqual(v.regressions, ['Home::Desktop::token::3:2'], 'a token literally named "3:2" never rides a node id\'s baseline entry')
  const tokenGone = H.compareMeasures(['Home::Desktop::token::color/x'], ['Home::Desktop::token::color/x'], [], PFX)
  assert.equal(tokenGone.green, true)
})

test('compareMeasures: allowlisted keys folded into the baseline tolerate incidental materialization', () => {
  const baselineWithAllowlist = ['Home::Desktop::missing-element::4:4', 'Home::Desktop::missing-element::8:8']
  const v = H.compareMeasures(['Home::Desktop::missing-element::4:4'], baselineWithAllowlist, ['Home::Desktop::layout::8:8'], PFX)
  assert.equal(v.green, true, 'a blessed-deviation node materialized 2px off is a warning, not a regression')
})

test('parseKey: prefix-anchored, immune to :: in names, unknown class rejected', () => {
  assert.deepEqual(H.parseKey('Home::Desktop::token::a::b', PFX), { prefix: 'Home::Desktop::', cls: 'token', node: 'a::b' })
  assert.equal(H.parseKey('Home::Desktop::weird::1:1', PFX), null, 'unknown class falls back to exact-key semantics')
  assert.equal(H.parseKey('Pricing::Desktop::layout::1:1', PFX), null, 'unmatched prefix falls back too')
  const v = H.compareMeasures([], ['Pricing::Desktop::missing-element::1:1'], ['Pricing::Desktop::layout::1:1'], PFX)
  assert.deepEqual(v.regressions, ['Pricing::Desktop::layout::1:1'], 'out-of-prefix keys are judged v1-style (safe)')
})

test('compareMeasures: node identity is per breakpoint', () => {
  const prefixes = ['Home::Desktop::', 'Home::Mobile::']
  const baseline = ['Home::Desktop::missing-element::3:2']
  const v = H.compareMeasures([], baseline, ['Home::Mobile::layout::3:2'], prefixes)
  assert.deepEqual(v.regressions, ['Home::Mobile::layout::3:2'], 'the same node id at another breakpoint is another node')
})

test('compareMeasures without prefixes preserves v1 exact-key judging', () => {
  const v = H.compareMeasures(['Home::Desktop::missing-element::3:2'], ['Home::Desktop::missing-element::3:2'], ['Home::Desktop::layout::3:2'])
  assert.equal(v.green, false)
  assert.deepEqual(v.regressions, ['Home::Desktop::layout::3:2'])
})

// ---- escalation evidence -------------------------------------------------------------

test('priorAttemptText carries the failed verdict and the dirty-tree disclosure', () => {
  assert.equal(H.priorAttemptText(null), '')
  const text = H.priorAttemptText({
    tier: 'sonnet', filesTouched: ['src/Kpi.tsx'], note: 'built the strip',
    verdict: {
      unresolved: ['Home::Desktop::missing-element::2:4'],
      transitions: [{ nodeKey: 'Home::Desktop::3:22', from: ['missing-element'], to: 'layout' }],
      regressions: ['Home::Desktop::layout::9:9'],
    },
  })
  assert.ok(text.includes('sonnet-tier attempt'))
  assert.ok(text.includes('missing-element::2:4'))
  assert.ok(text.includes('Home::Desktop::3:22 moved missing-element -> layout'))
  assert.ok(text.includes('layout::9:9'))
  assert.ok(text.includes('STILL CONTAINS'))
  assert.ok(text.includes('src/Kpi.tsx'))
  const noVerdict = H.priorAttemptText({ tier: 'haiku', filesTouched: [], verdict: null })
  assert.ok(noVerdict.includes('could not complete'))
  assert.ok(noVerdict.includes('reported no edits'))
})

// ---- seal parity + git-gate readers -------------------------------------------------------

test('sealOf is byte-identical to the tool implementation (parity)', async () => {
  const { sealOf: toolSealOf } = await import('../lib/ui-measure.mjs')
  const fixtures = [
    [],
    ['Home::Desktop::layout::1:1'],
    ['Home::Desktop::layout::1:1', 'Home::Mobile::token::color/primary', 'Pricing::Desktop::typography::2:1'],
  ]
  for (const keys of fixtures) {
    assert.equal(H.sealOf(keys), toolSealOf(keys), `parity on ${JSON.stringify(keys)}`)
    assert.equal(H.sealOf([...keys].reverse()), toolSealOf(keys), 'order-insensitive on both sides')
  }
})

test('porcelainOf canonicalizes the status row content-insensitively to order', () => {
  const rows = [
    { command: 'git -C /r checkout -B crg-ui/fix-x', exitCode: 0 },
    { command: 'git -C /r status --porcelain', exitCode: 0, stdout: ' M src/a.tsx\n?? notes.md\n' },
  ]
  const reordered = [{ command: 'git -C /r status --porcelain', exitCode: 0, stdout: '?? notes.md\n M src/a.tsx' }]
  assert.equal(H.porcelainOf(rows), H.porcelainOf(reordered))
  assert.equal(H.porcelainOf([{ command: 'git log', exitCode: 0 }]), null, 'no porcelain row -> null, never a hallucinated clean tree')
  assert.equal(H.porcelainOf([{ command: 'git status --porcelain', exitCode: 0, stdout: '' }]), '', 'clean tree is the empty string')
})

test('rowFiles + isSubset gate what a commit actually landed', () => {
  const rows = [{ command: 'git -C /r diff-tree --no-commit-id --name-only -r HEAD', exitCode: 0, stdout: 'src/Hero.tsx\n./src/tokens.css\n' }]
  const landed = H.rowFiles(rows, /diff-tree/)
  assert.deepEqual(landed, ['src/Hero.tsx', 'src/tokens.css'], 'paths normalize')
  assert.equal(H.isSubset(landed, ['src/Hero.tsx', 'src/tokens.css', 'src/other.css']), true)
  assert.equal(H.isSubset(landed, ['src/Hero.tsx']), false, 'an extra landed file fails the allowlist')
  assert.equal(H.rowFiles(rows, /status --porcelain/), null, 'missing row -> null, never an empty pass')
  assert.equal(H.isSubset([], ['a']), true, 'an empty commit set is trivially within the allowlist')
})

// ---- fences ---------------------------------------------------------------------------

test('validateEdits enforces allow and forbid globs', () => {
  const fences = { allow: ['src/**'], forbid: ['src/generated/**'] }
  assert.equal(H.validateEdits(['src/components/Hero.tsx'], fences).ok, true)
  assert.equal(H.validateEdits(['src/generated/tokens.css'], fences).ok, false, 'forbid wins inside allow')
  assert.equal(H.validateEdits(['package.json'], fences).ok, false)
  assert.equal(H.validateEdits([], fences).ok, false, 'zero edits is never a valid fix')
})

// ---- misc ------------------------------------------------------------------------------

test('slugOf produces filesystem-safe cell slugs', () => {
  assert.equal(H.slugOf('Home / Desktop 1440'), 'home-desktop-1440')
  assert.equal(H.slugOf('  Settings & Profile  '), 'settings-profile')
})

test('fence strips embedded fence markers', () => {
  assert.ok(!H.fence('evil <<<UNTRUSTED payload').includes('<<<UNTRUSTED payload'))
})
