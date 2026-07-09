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
  `${block}\nreturn { fence, capText, resolveModel, normPath, slugOf, globToRegex, matchesAnyGlob, validateEdits, TIERS, startTier, tiersFrom, groupUnits, compareMeasures }`,
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
    { key: 'Home::layout::1:1', screen: 'Home', class: 'layout', component: 'Hero' },
    { key: 'Home::typography::1:1', screen: 'Home', class: 'typography', component: 'Hero' },
    { key: 'Home::token::color/primary', screen: 'Home', class: 'token', token: 'color/primary' },
    { key: 'Pricing::layout::2:1', screen: 'Pricing', class: 'layout', component: 'Hero' },
  ])
  assert.equal(units.length, 3)
  assert.deepEqual(units.map(u => [u.screen, u.subject, u.discrepancies.length]),
    [['Home', 'Hero', 2], ['Home', 'color/primary', 1], ['Pricing', 'Hero', 1]])
  assert.deepEqual(units.map(u => u.unitId), ['u-001', 'u-002', 'u-003'])
})

// ---- verify judge -------------------------------------------------------------------

test('compareMeasures: green iff unit keys vanish and nothing new appears', () => {
  const baseline = ['Home::layout::1:1', 'Home::token::color/primary', 'Home::layout::1:9']
  const unit = ['Home::layout::1:1']
  assert.deepEqual(
    H.compareMeasures(unit, baseline, ['Home::token::color/primary', 'Home::layout::1:9']),
    { green: true, unresolved: [], regressions: [] },
    'unit resolved, pre-existing others untouched -> green',
  )
  const stillThere = H.compareMeasures(unit, baseline, ['Home::layout::1:1'])
  assert.equal(stillThere.green, false)
  assert.deepEqual(stillThere.unresolved, unit)
  const brokeNeighbor = H.compareMeasures(unit, baseline, ['Home::layout::9:9'])
  assert.equal(brokeNeighbor.green, false, 'a fix that breaks a neighbor is red, even with its own key resolved')
  assert.deepEqual(brokeNeighbor.regressions, ['Home::layout::9:9'])
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
