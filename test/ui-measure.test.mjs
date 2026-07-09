import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeName, figmaVarToCssVar, normalizeColor, pairNodes,
  geometryDiscrepancies, typographyDiscrepancies, tokenDiscrepancies,
  keyOf, applyAllowlist, measure,
} from '../lib/ui-measure.mjs'

// ---- normalization -------------------------------------------------------------

test('normalizeName folds case, spaces, and punctuation', () => {
  assert.equal(normalizeName('Primary Button'), 'primarybutton')
  assert.equal(normalizeName('primary-button'), 'primarybutton')
  assert.equal(normalizeName('Primary/Button v2'), 'primarybuttonv2')
})

test('figmaVarToCssVar maps figma variable names to CSS custom properties', () => {
  assert.equal(figmaVarToCssVar('color/primary'), '--color-primary')
  assert.equal(figmaVarToCssVar('Spacing / lg'), '--spacing-lg')
  assert.equal(figmaVarToCssVar('type.body.size'), '--type-body-size')
})

test('normalizeColor canonicalizes hex shorthand, case, and rgb()', () => {
  assert.equal(normalizeColor('#ABC'), '#aabbcc')
  assert.equal(normalizeColor('#0055FF'), '#0055ff')
  assert.equal(normalizeColor('rgb(0, 85, 255)'), '#0055ff')
  assert.equal(normalizeColor('rgba(0, 85, 255, 1)'), '#0055ff')
  assert.equal(normalizeColor('#0055ffff'), '#0055ff', 'opaque alpha drops')
  assert.notEqual(normalizeColor('rgba(0,85,255,0.5)'), '#0055ff', 'translucent alpha is significant')
})

// ---- pairing --------------------------------------------------------------------

const fNode = (id, name, x = 0, y = 0, w = 100, h = 40) => ({ id, name, x, y, width: w, height: h })
const dEl = (component, x = 0, y = 0, w = 100, h = 40) => ({ component, selector: `[data-component="${component}"]`, x, y, width: w, height: h })

test('pairNodes joins by normalized name and never guesses on ambiguity', () => {
  const { pairs, unmatchedFigma, unmatchedDom } = pairNodes(
    [fNode('1:1', 'Primary Button'), fNode('1:2', 'Nav Bar'), fNode('1:3', 'Card'), fNode('1:4', 'Card')],
    [dEl('primary-button'), dEl('NavBar'), dEl('card'), dEl('footer')],
  )
  assert.deepEqual(pairs.map(p => p.figma.name).sort(), ['Nav Bar', 'Primary Button'])
  assert.deepEqual(unmatchedFigma.map(n => n.name), ['Card', 'Card'], 'duplicate figma names are ambiguous -> unmatched')
  assert.ok(unmatchedDom.some(e => e.component === 'footer'))
  assert.ok(unmatchedDom.some(e => e.component === 'card'), 'dom side of an ambiguous name stays unmatched')
})

// ---- geometry ---------------------------------------------------------------------

test('geometry flags only deltas beyond tolerance, with graded severity', () => {
  const pairs = [
    { figma: fNode('1:1', 'A', 0, 0, 100, 40), dom: dEl('A', 0.5, 0, 100, 40) },     // within ±1
    { figma: fNode('1:2', 'B', 0, 0, 100, 40), dom: dEl('B', 0, 2.6, 100, 40) },     // low
    { figma: fNode('1:3', 'C', 0, 0, 100, 40), dom: dEl('C', 0, 0, 106, 40) },       // medium
    { figma: fNode('1:4', 'D', 0, 0, 100, 40), dom: dEl('D', 0, 20, 100, 40) },      // high
  ]
  const out = geometryDiscrepancies(pairs, 1)
  assert.deepEqual(out.map(d => [d.component, d.severity]), [['B', 'low'], ['C', 'medium'], ['D', 'high']])
  assert.equal(out[1].delta.dw, 6)
})

// ---- typography ---------------------------------------------------------------------

test('typography compares only props present on both sides', () => {
  const pairs = [
    { figma: { ...fNode('1:1', 'H1'), fontSize: 32, fontFamily: 'Inter', fontWeight: 'bold' },
      dom: { ...dEl('H1'), fontSize: '32px', fontFamily: '"Inter", sans-serif', fontWeight: '700' } },
    { figma: { ...fNode('1:2', 'Body'), fontSize: 16, fontFamily: 'Inter' },
      dom: { ...dEl('Body'), fontSize: '14px', fontFamily: 'Arial' } },
    { figma: { ...fNode('1:3', 'Caption'), fontSize: 12 }, dom: dEl('Caption') }, // dom side missing -> no compare
  ]
  const out = typographyDiscrepancies(pairs)
  assert.equal(out.length, 1)
  assert.equal(out[0].component, 'Body')
  assert.deepEqual(Object.keys(out[0].diffs).sort(), ['fontFamily', 'fontSize'])
})

// ---- tokens ----------------------------------------------------------------------------

test('tokens compare both-sides-only; figma-only vars are informational', () => {
  const { discrepancies, unmatchedTokens } = tokenDiscrepancies(
    { 'color/primary': '#0055FF', 'color/danger': '#FF0000', 'spacing/lg': '24', 'color/unused': '#123456' },
    { '--color-primary': 'rgb(0, 85, 255)', '--color-danger': '#ee0000', '--spacing-lg': '20px' },
  )
  assert.deepEqual(discrepancies.map(d => d.token).sort(), ['color/danger', 'spacing/lg'])
  assert.deepEqual(unmatchedTokens, ['color/unused'])
  assert.equal(discrepancies.every(d => d.severity === 'high'), true)
})

// ---- allowlist + assembly ----------------------------------------------------------------

test('applyAllowlist drops blessed items scoped by screen', () => {
  const ds = [
    { class: 'layout', figmaNodeId: '1:1', component: 'A' },
    { class: 'token', token: 'color/primary' },
  ]
  const { kept, allowlisted } = applyAllowlist(ds, 'Home', [
    { screen: 'Home', class: 'layout', figmaNodeId: '1:1' },
    { screen: 'Other', class: 'token', token: 'color/primary' },
  ])
  assert.deepEqual(kept.map(d => d.class), ['token'], 'other-screen entries do not apply')
  assert.deepEqual(allowlisted, [keyOf('Home', ds[0])])
})

test('measure assembles a ranked, keyed, stable ledger slice', () => {
  const figma = {
    frame: { id: '0:1', name: 'Home / Desktop 1440', width: 1440, height: 900 },
    nodes: [fNode('1:1', 'Nav Bar', 0, 0, 1440, 64), fNode('1:2', 'Hero', 0, 64, 1440, 400), fNode('1:3', 'Ghost')],
    variables: { 'color/primary': '#0055FF' },
  }
  const dom = {
    route: '/', viewport: { width: 1440, height: 900 },
    elements: [dEl('nav-bar', 0, 0, 1440, 64), dEl('hero', 0, 64, 1440, 410)],
    tokens: { '--color-primary': '#0044ee' },
  }
  const out = measure(figma, dom, { tolerancePx: 1, screen: 'Home' })
  assert.equal(out.pairs, 2)
  const classes = out.discrepancies.map(d => d.class)
  assert.deepEqual([...classes].sort(), ['layout', 'missing-element', 'token'])
  assert.equal(out.discrepancies[0].severity, 'high', 'high severity ranks first')
  assert.ok(out.discrepancies.every(d => d.key.startsWith('Home::')))
  assert.ok(out.discrepancies.every((d, i) => d.id === `d-${String(i + 1).padStart(3, '0')}`))
  const again = measure(figma, dom, { tolerancePx: 1, screen: 'Home' })
  assert.deepEqual(again.discrepancies.map(d => d.key), out.discrepancies.map(d => d.key), 'keys are stable across re-measure')
})
