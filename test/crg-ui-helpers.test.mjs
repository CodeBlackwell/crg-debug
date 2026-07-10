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
  `${block}\nreturn { fence, capText, resolveModel, normPath, slugOf, globToRegex, matchesAnyGlob, validateEdits, TIERS, startTier, tiersFrom, groupUnits, compareMeasures, sealOf, porcelainOf, rowFiles, isSubset }`,
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
})

// ---- verify judge -------------------------------------------------------------------

test('compareMeasures: green iff unit keys vanish and nothing new appears', () => {
  const baseline = ['Home::Desktop::layout::1:1', 'Home::Desktop::token::color/primary', 'Home::Desktop::layout::1:9']
  const unit = ['Home::Desktop::layout::1:1']
  assert.deepEqual(
    H.compareMeasures(unit, baseline, ['Home::Desktop::token::color/primary', 'Home::Desktop::layout::1:9']),
    { green: true, unresolved: [], regressions: [] },
    'unit resolved, pre-existing others untouched -> green',
  )
  const stillThere = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::1:1'])
  assert.equal(stillThere.green, false)
  assert.deepEqual(stillThere.unresolved, unit)
  const brokeNeighbor = H.compareMeasures(unit, baseline, ['Home::Desktop::layout::9:9'])
  assert.equal(brokeNeighbor.green, false, 'a fix that breaks a neighbor is red, even with its own key resolved')
  assert.deepEqual(brokeNeighbor.regressions, ['Home::Desktop::layout::9:9'])
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
