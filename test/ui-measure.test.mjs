import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeName, figmaVarToCssVar, normalizeColor, pairNodes,
  geometryDiscrepancies, typographyDiscrepancies, tokenDiscrepancies,
  keyOf, applyAllowlist, measure, sealOf,
  normalizeVars, normalizeFigma, normalizeDom, assembleLedger, sliceUiLedger,
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
  const { kept, allowlisted } = applyAllowlist(ds, 'Home', 'Desktop', [
    { screen: 'Home', class: 'layout', figmaNodeId: '1:1' },
    { screen: 'Other', class: 'token', token: 'color/primary' },
  ])
  assert.deepEqual(kept.map(d => d.class), ['token'], 'other-screen entries do not apply')
  assert.deepEqual(allowlisted, [keyOf('Home', 'Desktop', ds[0])])
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
  const out = measure(figma, dom, { tolerancePx: 1, screen: 'Home', breakpoint: 'Desktop' })
  assert.equal(out.pairs, 2)
  const classes = out.discrepancies.map(d => d.class)
  assert.deepEqual([...classes].sort(), ['layout', 'missing-element', 'token'])
  assert.equal(out.discrepancies[0].severity, 'high', 'high severity ranks first')
  assert.ok(out.discrepancies.every(d => d.key.startsWith('Home::Desktop::')))
  assert.ok(out.discrepancies.every(d => d.breakpoint === 'Desktop'))
  assert.ok(out.discrepancies.every((d, i) => d.id === `d-${String(i + 1).padStart(3, '0')}`))
  assert.equal(out.keyCount, out.discrepancies.length)
  assert.equal(out.seal, sealOf(out.discrepancies.map(d => d.key)), 'seal is recomputable from the keys')
  const again = measure(figma, dom, { tolerancePx: 1, screen: 'Home', breakpoint: 'Desktop' })
  assert.deepEqual(again.discrepancies.map(d => d.key), out.discrepancies.map(d => d.key), 'keys are stable across re-measure')
  const mobile = measure(figma, dom, { tolerancePx: 1, screen: 'Home', breakpoint: 'Mobile' })
  assert.notDeepEqual(mobile.discrepancies.map(d => d.key), out.discrepancies.map(d => d.key),
    'same screen at another breakpoint yields distinct keys — no cross-breakpoint collisions')
})

// ---- seal -----------------------------------------------------------------------------

test('sealOf is order-insensitive, content-sensitive, and stable', () => {
  const keys = ['Home::Desktop::layout::1:1', 'Home::Desktop::token::color/primary']
  assert.equal(sealOf(keys), sealOf([...keys].reverse()), 'relay order does not matter')
  assert.notEqual(sealOf(keys), sealOf(keys.slice(0, 1)), 'a dropped key changes the seal')
  assert.notEqual(sealOf(keys), sealOf([keys[0], keys[1] + 'x']), 'a mangled key changes the seal')
  assert.equal(sealOf([]), sealOf([]), 'empty is a valid, stable seal')
  assert.match(sealOf(keys), /^[0-9a-f]{8}$/)
})

// ---- raw-capture normalizers ------------------------------------------------------------

test('normalizeVars flattens raw variable dumps into a sorted primitive map', () => {
  const out = normalizeVars({
    'spacing/lg': 24,
    'color/primary': { r: 0, g: 85 / 255, b: 1 },
    'color/overlay': { r: 0, g: 0, b: 0, a: 0.5 },
    'type/body': { resolvedValue: '16px' },
    'color/modal': { valuesByMode: { 'mode:1': { r: 1, g: 1, b: 1 } } },
    'junk/null': null,
  })
  assert.deepEqual(out, {
    'color/modal': '#ffffff',
    'color/overlay': '#00000080',
    'color/primary': '#0055ff',
    'spacing/lg': 24,
    'type/body': '16px',
  })
  assert.deepEqual(Object.keys(out), Object.keys(out).sort(), 'keys are sorted for determinism')
  assert.deepEqual(normalizeVars({ variables: { 'a/b': '#fff' } }), { 'a/b': '#fff' }, 'unwraps a variables envelope')
})

test('normalizeFigma does the math: frame-relative coords, depth<=2, named-node filter', () => {
  const raw = {
    nodes: [{
      id: '0:1', name: 'Home / Desktop', type: 'FRAME',
      absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 900 },
      children: [
        { id: '1:1', name: 'Nav Bar', type: 'INSTANCE', absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 64 } },
        { id: '1:2', name: 'Rectangle 3', type: 'RECTANGLE', absoluteBoundingBox: { x: 0, y: 0, width: 9, height: 9 } },
        { id: '1:3', name: 'Frame 12', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 9, height: 9 } },
        {
          id: '1:4', name: 'Hero', type: 'FRAME', absoluteBoundingBox: { x: 100, y: 264, width: 1440, height: 400 },
          children: [
            { id: '2:1', name: 'Heading', type: 'TEXT', absoluteBoundingBox: { x: 148, y: 296, width: 600, height: 40 }, style: { fontFamily: 'Inter', fontSize: 32, fontWeight: 700 } },
            { id: '2:2', name: 'Vector 7', type: 'VECTOR', absoluteBoundingBox: { x: 0, y: 0, width: 9, height: 9 } },
            {
              id: '2:3', name: 'CTA Row', type: 'GROUP', absoluteBoundingBox: { x: 148, y: 400, width: 300, height: 48 },
              children: [{ id: '3:1', name: 'Primary Button', type: 'COMPONENT', absoluteBoundingBox: { x: 148, y: 400, width: 140, height: 48 } }],
            },
          ],
        },
      ],
    }],
  }
  const out = normalizeFigma(raw, { frameId: '0:1', variables: { 'color/primary': '#0055ff' } })
  assert.deepEqual(out.frame, { id: '0:1', name: 'Home / Desktop', width: 1440, height: 900 })
  assert.deepEqual(out.nodes.map(n => n.name), ['Nav Bar', 'Hero', 'Heading', 'CTA Row'],
    'default-named frames/rects/vectors drop; depth-3 Primary Button is out of range')
  const heading = out.nodes.find(n => n.name === 'Heading')
  assert.deepEqual([heading.x, heading.y], [48, 96], 'coords are frame-relative')
  assert.deepEqual([heading.fontFamily, heading.fontSize, heading.fontWeight], ['Inter', 32, 700])
  assert.deepEqual(out.variables, { 'color/primary': '#0055ff' })
  assert.throws(() => normalizeFigma(raw, { frameId: '9:9' }), /not found/)
})

test('normalizeFigma accumulates parent-relative coords into frame-relative (MCP get_metadata dumps)', () => {
  // Flat x/y with no absoluteBoundingBox = relative to the immediate parent.
  const raw = {
    type: 'frame', id: '2:2', name: 'Overview', x: 0, y: 0, width: 1440, height: 900,
    children: [
      {
        type: 'frame', id: '2:4', name: 'KPI Strip', x: 0, y: 56, width: 1440, height: 76,
        children: [{ type: 'frame', id: '3:22', name: 'KPI: TOTAL VALUE', x: 12, y: 12, width: 192, height: 64, children: [{ type: 'text', id: '4:1', name: 'label', x: 0, y: 0, width: 50, height: 10 }] }],
      },
      {
        type: 'frame', id: '2:5', name: 'Content', x: 0, y: 132, width: 1440, height: 740,
        children: [{ type: 'frame', id: '2:7', name: 'Col B', x: 584, y: 12, width: 430, height: 716 }],
      },
      { type: 'text', id: '3:10', name: 'Titleblock', x: 368, y: 872, width: 703, height: 12 },
    ],
  }
  const out = normalizeFigma(raw, { frameId: '2:2' })
  const at = name => out.nodes.find(n => n.name === name)
  assert.deepEqual([at('KPI Strip').x, at('KPI Strip').y], [0, 56], 'depth-1 unchanged')
  assert.deepEqual([at('KPI: TOTAL VALUE').x, at('KPI: TOTAL VALUE').y], [12, 68], 'depth-2 accumulates parent offset')
  assert.deepEqual([at('Col B').x, at('Col B').y], [584, 144], 'the bug that sank the SPICE run')
  assert.equal(at('KPI: TOTAL VALUE').hasChildren, true, 'non-leaf nodes flagged')
  assert.equal(at('Col B').hasChildren, undefined, 'leaf nodes unflagged')
  assert.equal(at('Titleblock').isText, true, 'text nodes flagged')
})

test('pairNodes rejects placeholder matches: empty DOM element vs content-bearing figma node', () => {
  const figma = [
    { ...fNode('2:4', 'KPI Strip', 0, 56, 1440, 76), hasChildren: true },
    { ...fNode('3:10', 'Titleblock', 368, 872, 703, 12), isText: true },
    fNode('2:7', 'Col B', 584, 144, 430, 716), // leaf: empty div is legitimate
  ]
  const strip = { ...dEl('KPI Strip', 0, 56, 1440, 76), textLength: 0, childCount: 0 }
  const title = { ...dEl('Titleblock', 368, 872, 703, 12), textLength: 0, childCount: 2 }
  const colB = { ...dEl('Col B', 584, 144, 430, 716), textLength: 0, childCount: 0 }
  const out = pairNodes(figma, [strip, title, colB])
  assert.deepEqual(out.unmatchedFigma.map(n => n.name), ['KPI Strip', 'Titleblock'],
    'empty div vs non-leaf node and textless element vs TEXT node both stay missing')
  assert.deepEqual(out.pairs.map(p => p.figma.name), ['Col B'])
  // Old captures without content fields never reject.
  const legacy = pairNodes(figma, [dEl('KPI Strip', 0, 56, 1440, 76)])
  assert.deepEqual(legacy.pairs.map(p => p.figma.name), ['KPI Strip'])
})

test('normalizeDom canonicalizes collector output: coerced numbers, stable order', () => {
  const out = normalizeDom({
    result: {
      elements: [
        { component: 'hero', selector: '[data-component="hero"]', x: '0', y: 64.4, width: 1440, height: 410, fontSize: '16px' },
        { component: 'nav-bar', selector: '[data-component="nav-bar"]', x: 0, y: 0, width: 1440, height: 64 },
        { component: '', selector: '' },
      ],
      tokens: { '--color-primary': ' #0044ee ', 'not-a-token': 'x' },
    },
  }, { route: '/', width: 1440, height: 900 })
  assert.deepEqual(out.viewport, { width: 1440, height: 900 })
  assert.deepEqual(out.elements.map(e => e.component), ['hero', 'nav-bar'], 'sorted, empties dropped')
  assert.equal(out.elements[0].x, 0, 'string numbers coerce')
  assert.deepEqual(out.tokens, { '--color-primary': '#0044ee' }, 'only custom properties, trimmed')
  assert.throws(() => normalizeDom({ nope: true }), /elements array/)
})

// ---- ledger assembly + slicing ------------------------------------------------------------

const PROFILE = {
  project: 'demo', mode: 'responsive',
  figma: { fileKey: 'FILEKEY' }, tolerance: { geometryPx: 1 },
  screens: [{ name: 'Home', route: '/' }, { name: 'Pricing', route: '/pricing' }],
}
const measureOut = (screen, breakpoint, ds) => ({
  screen, breakpoint, pairs: 5, keyCount: ds.length, seal: sealOf(ds.map(d => d.key)),
  discrepancies: ds, unmatchedFigma: [], unmatchedDom: [], unmatchedTokens: [], allowlisted: [],
})
const disc = (id, screen, breakpoint, cls, subject) => ({
  id, key: `${screen}::${breakpoint}::${cls}::${subject}`, screen, breakpoint, class: cls,
  ...(cls === 'token' ? { token: subject } : { figmaNodeId: subject, component: 'X' }), severity: 'high',
})

test('assembleLedger qualifies ids per cell and seals allKeys', () => {
  const ledger = assembleLedger([
    { slug: 'home-desktop', out: measureOut('Home', 'Desktop', [disc('d-001', 'Home', 'Desktop', 'layout', '1:1')]) },
    { slug: 'pricing-desktop', out: measureOut('Pricing', 'Desktop', [disc('d-001', 'Pricing', 'Desktop', 'token', 'color/primary')]) },
  ], PROFILE, { repoRoot: '/repo', failed: ['home-mobile'] })
  assert.equal(ledger.schemaVersion, 2)
  assert.deepEqual(ledger.cells.map(c => c.route), ['/', '/pricing'], 'routes resolve from the profile')
  assert.deepEqual(ledger.cells.flatMap(c => c.discrepancies.map(d => d.id)),
    ['home-desktop.d-001', 'pricing-desktop.d-001'], 'ids are unique across cells')
  assert.deepEqual(ledger.failedCells, ['home-mobile'])
  assert.equal(ledger.seal, sealOf(ledger.allKeys))
  assert.equal(ledger.allKeys.length, 2)
})

test('sliceUiLedger selects by key or qualified id and double-seals', () => {
  const ledger = assembleLedger([
    { slug: 'home-desktop', out: measureOut('Home', 'Desktop', [
      disc('d-001', 'Home', 'Desktop', 'layout', '1:1'), disc('d-002', 'Home', 'Desktop', 'token', 'color/primary'),
    ]) },
  ], PROFILE)
  const byKey = sliceUiLedger(ledger, { keys: ['Home::Desktop::layout::1:1'] })
  assert.deepEqual(byKey.discrepancies.map(d => d.id), ['home-desktop.d-001'])
  const byId = sliceUiLedger(ledger, { ids: ['home-desktop.d-002'] })
  assert.deepEqual(byId.discrepancies.map(d => d.key), ['Home::Desktop::token::color/primary'])
  assert.equal(byId.seal, sealOf(ledger.allKeys), 'seal covers the full baseline')
  assert.equal(byId.selectedSeal, sealOf(byId.discrepancies.map(d => d.key)), 'selectedSeal covers the slice')
  assert.equal(byId.allowlistSeal, sealOf(byId.allowlistedKeys), 'allowlistSeal covers the allowlisted keys')
  assert.deepEqual(sliceUiLedger(ledger, { keys: ['nope'] }).discrepancies, [])
})
