// The crg-ui numeric oracle, in real code — geometry + token + typography layers.
//   node ui-measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>] [--allowlist <path>]
// Prints ONE line of JSON: {screen, pairs, discrepancies, unmatchedFigma, unmatchedDom,
// unmatchedTokens, allowlisted}. Agents RUN this tool and relay its output verbatim —
// they never compute deltas themselves (an agent eyeballing bounding boxes is exactly
// the nondeterminism this layer exists to remove).
//
// Input shapes (produced by the capture agents):
//   figma.json  { frame:{id,name,width,height},
//                 nodes:[{id,name,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 variables?:{"color/primary":"#0055FF", ...} }
//                 (x,y relative to the frame's own origin)
//   dom.json    { route, viewport:{width,height},
//                 elements:[{component,selector,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 tokens?:{"--color-primary":"#0055ff", ...} }
//                 (getBoundingClientRect at scroll 0 — same coordinate space)

import { readFileSync } from 'node:fs'

// ---- normalization --------------------------------------------------------------

// Match key for figma node names vs data-component values: case, spaces,
// punctuation, and separators all vanish ("Primary Button" == "primary-button").
export const normalizeName = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '')

// Figma variable name -> CSS custom property ("color/primary" -> "--color-primary").
export const figmaVarToCssVar = name =>
  '--' + String(name == null ? '' : name).toLowerCase().replace(/[\s/.]+/g, '-').replace(/[^a-z0-9-]/g, '')

// Colors compare in one canonical form: lowercase #rrggbb (alpha kept only when < ff).
export const normalizeColor = s => {
  const v = String(s == null ? '' : s).trim().toLowerCase()
  let m = v.match(/^#([0-9a-f]{3,4})$/)
  if (m) {
    const x = m[1].split('').map(c => c + c).join('')
    return normalizeColor('#' + x)
  }
  m = v.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/)
  if (m) return m[2] && m[2] !== 'ff' ? `#${m[1]}${m[2]}` : `#${m[1]}`
  m = v.match(/^rgba?\(\s*(\d+)\s*[, ]\s*(\d+)\s*[, ]\s*(\d+)\s*(?:[,/]\s*([\d.]+)\s*)?\)$/)
  if (m) {
    const hex = n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')
    const a = m[4] === undefined ? 1 : Number(m[4])
    return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}` + (a < 1 ? hex(Math.round(a * 255)) : '')
  }
  return v
}

const normalizeFontFamily = s => String(s == null ? '' : s).split(',')[0].trim().toLowerCase().replace(/['"]/g, '')
const normalizeFontWeight = s => {
  const v = String(s == null ? '' : s).trim().toLowerCase()
  return v === 'normal' ? '400' : v === 'bold' ? '700' : v
}
const pxNumber = s => {
  const n = parseFloat(String(s == null ? '' : s))
  return Number.isFinite(n) ? n : null
}

// ---- pairing ----------------------------------------------------------------------

// Deterministic name join: figma node.name vs dom element.component. A figma name
// matching 2+ dom elements (or vice versa) is ambiguous and lands in unmatched —
// a wrong pair poisons every layer downstream, so the tool never guesses.
export const pairNodes = (figmaNodes, domElements) => {
  const domByKey = new Map()
  for (const el of domElements || []) {
    const key = normalizeName(el.component)
    if (!key) continue
    domByKey.set(key, domByKey.has(key) ? 'ambiguous' : el)
  }
  const pairs = []
  const unmatchedFigma = []
  const seenKeys = new Map()
  for (const n of figmaNodes || []) {
    const key = normalizeName(n.name)
    seenKeys.set(key, (seenKeys.get(key) || 0) + 1)
  }
  const claimed = new Set()
  for (const n of figmaNodes || []) {
    const key = normalizeName(n.name)
    const el = domByKey.get(key)
    if (!key || !el || el === 'ambiguous' || seenKeys.get(key) > 1 || claimed.has(key)) {
      unmatchedFigma.push(n)
      continue
    }
    claimed.add(key)
    pairs.push({ figma: n, dom: el })
  }
  const unmatchedDom = (domElements || []).filter(el => {
    const key = normalizeName(el.component)
    return !key || !claimed.has(key) || domByKey.get(key) === 'ambiguous'
  })
  return { pairs, unmatchedFigma, unmatchedDom }
}

// ---- the three layers ---------------------------------------------------------------

const round1 = n => Math.round(n * 10) / 10
const layoutSeverity = maxDelta => (maxDelta > 8 ? 'high' : maxDelta > 3 ? 'medium' : 'low')

export const geometryDiscrepancies = (pairs, tolerancePx) => {
  const out = []
  for (const { figma, dom } of pairs) {
    const delta = {
      dx: round1((dom.x || 0) - (figma.x || 0)),
      dy: round1((dom.y || 0) - (figma.y || 0)),
      dw: round1((dom.width || 0) - (figma.width || 0)),
      dh: round1((dom.height || 0) - (figma.height || 0)),
    }
    const maxDelta = Math.max(...Object.values(delta).map(Math.abs))
    if (maxDelta > tolerancePx) {
      out.push({
        class: 'layout', component: figma.name, figmaNodeId: figma.id, selector: dom.selector,
        expected: { x: figma.x, y: figma.y, width: figma.width, height: figma.height },
        actual: { x: dom.x, y: dom.y, width: dom.width, height: dom.height },
        delta, severity: layoutSeverity(maxDelta),
      })
    }
  }
  return out
}

export const typographyDiscrepancies = pairs => {
  const out = []
  for (const { figma, dom } of pairs) {
    const diffs = {}
    if (figma.fontFamily != null && dom.fontFamily != null
      && normalizeFontFamily(figma.fontFamily) !== normalizeFontFamily(dom.fontFamily)) {
      diffs.fontFamily = { expected: figma.fontFamily, actual: dom.fontFamily }
    }
    if (figma.fontSize != null && dom.fontSize != null) {
      const e = pxNumber(figma.fontSize); const a = pxNumber(dom.fontSize)
      if (e != null && a != null && Math.abs(e - a) > 0.5) diffs.fontSize = { expected: e, actual: a }
    }
    if (figma.fontWeight != null && dom.fontWeight != null
      && normalizeFontWeight(figma.fontWeight) !== normalizeFontWeight(dom.fontWeight)) {
      diffs.fontWeight = { expected: figma.fontWeight, actual: dom.fontWeight }
    }
    if (Object.keys(diffs).length) {
      out.push({ class: 'typography', component: figma.name, figmaNodeId: figma.id, selector: dom.selector, diffs, severity: 'medium' })
    }
  }
  return out
}

// Token layer compares ONLY variables present on both sides: a figma variable with
// no CSS counterpart may simply be unused on this screen — reported informationally
// as unmatchedTokens, never as a discrepancy.
export const tokenDiscrepancies = (figmaVars, domTokens) => {
  const out = []
  const unmatched = []
  const tokens = domTokens || {}
  for (const [name, figmaValue] of Object.entries(figmaVars || {})) {
    const cssVar = figmaVarToCssVar(name)
    if (!(cssVar in tokens)) { unmatched.push(name); continue }
    const domValue = tokens[cssVar]
    const eNum = pxNumber(figmaValue); const aNum = pxNumber(domValue)
    const bothNumeric = eNum != null && aNum != null
      && /^-?[\d.]+(px)?$/.test(String(figmaValue).trim()) && /^-?[\d.]+(px)?$/.test(String(domValue).trim())
    const equal = bothNumeric
      ? Math.abs(eNum - aNum) <= 0.5
      : normalizeColor(figmaValue) === normalizeColor(domValue)
    if (!equal) {
      out.push({ class: 'token', token: name, cssVar, expected: figmaValue, actual: domValue, severity: 'high' })
    }
  }
  return { discrepancies: out, unmatchedTokens: unmatched }
}

// ---- assembly -------------------------------------------------------------------------

// Stable key: survives re-measure and re-ordering, so the repair verify can compare
// before/after sets. Layout+typography key on the figma node; token on the variable.
export const keyOf = (screen, d) =>
  `${screen}::${d.class}::${d.figmaNodeId || d.token || normalizeName(d.component)}`

export const applyAllowlist = (discrepancies, screen, allowlist) => {
  const entries = (allowlist || []).filter(e => !e.screen || e.screen === screen)
  const allowed = d => entries.some(e =>
    e.class === d.class && (e.figmaNodeId ? e.figmaNodeId === d.figmaNodeId : e.token ? e.token === d.token : false))
  return {
    kept: discrepancies.filter(d => !allowed(d)),
    allowlisted: discrepancies.filter(allowed).map(d => keyOf(screen, d)),
  }
}

export const measure = (figma, dom, { tolerancePx = 1, screen = '', allowlist = [] } = {}) => {
  const { pairs, unmatchedFigma, unmatchedDom } = pairNodes(figma.nodes, dom.elements)
  const missing = unmatchedFigma.map(n => ({
    class: 'missing-element', component: n.name, figmaNodeId: n.id,
    expected: { x: n.x, y: n.y, width: n.width, height: n.height }, actual: null, severity: 'high',
  }))
  const tokens = tokenDiscrepancies(figma.variables, dom.tokens)
  const all = [
    ...geometryDiscrepancies(pairs, tolerancePx),
    ...typographyDiscrepancies(pairs),
    ...missing,
    ...tokens.discrepancies,
  ]
  const { kept, allowlisted } = applyAllowlist(all, screen, allowlist)
  const rank = { high: 0, medium: 1, low: 2 }
  kept.sort((a, b) => rank[a.severity] - rank[b.severity])
  return {
    screen,
    pairs: pairs.length,
    discrepancies: kept.map((d, i) => ({ id: `d-${String(i + 1).padStart(3, '0')}`, key: keyOf(screen, d), screen, ...d })),
    unmatchedFigma: unmatchedFigma.map(n => n.name),
    unmatchedDom: unmatchedDom.map(e => e.component || e.selector),
    unmatchedTokens: tokens.unmatchedTokens,
    allowlisted,
  }
}

// ---- CLI ----------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
  const [cmd, figmaPath, domPath] = argv
  if (cmd !== 'measure' || !figmaPath || !domPath) {
    process.stderr.write('usage: ui-measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>] [--allowlist <path>]\n')
    process.exit(1)
  }
  const result = measure(
    JSON.parse(readFileSync(figmaPath, 'utf8')),
    JSON.parse(readFileSync(domPath, 'utf8')),
    {
      tolerancePx: flag('tolerance') !== undefined ? Number(flag('tolerance')) : 1,
      screen: flag('screen') || '',
      allowlist: flag('allowlist') ? JSON.parse(readFileSync(flag('allowlist'), 'utf8')) : [],
    },
  )
  process.stdout.write(JSON.stringify(result) + '\n')
}
