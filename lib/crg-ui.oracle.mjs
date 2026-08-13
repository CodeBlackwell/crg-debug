// The crg-ui numeric oracle: name pairing, then the three comparison layers
// (geometry, typography, tokens) and the allowlist + ranking that turn them into one
// cell's keyed discrepancy set. Agents TRANSCRIBE raw dumps and RUN this — they never
// compute coordinates or deltas themselves (an agent eyeballing a bounding box is
// exactly the nondeterminism this layer exists to remove).
// No CLI of its own — lib/crg-ui.measure.mjs dispatches the `measure` subcommand.

import { sealOf } from './crg-ui.seal.mjs'
import { normalizeName, normalizeColor, normalizeFontFamily, normalizeFontWeight, pxNumber, figmaVarToCssVar } from './crg-ui.normalize.mjs'

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
    // Placeholder rejection: a bare tagged div satisfies geometry but renders nothing.
    // A figma node with children (or a TEXT node) only counts as present when the DOM
    // element has content. Content fields absent (old captures) -> no rejection.
    const empty = el.textLength === 0 && (n.isText || el.childCount === 0)
    if ((n.hasChildren || n.isText) && empty) {
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

// ---- allowlist + one cell's result -------------------------------------------------

// Stable key for one measured cell's discrepancy: survives re-measure and re-ordering,
// so the repair verify can compare before/after sets. Layout+typography key on the
// figma node; token on the variable. Breakpoint is part of the key — the same token
// measured at two breakpoints is two keys, so the no-regression baseline stays
// collision-free. (Distinct from lib/crg-debug.ledger-slice.mjs's bug-identity keyOf.)
export const cellKeyOf = (screen, breakpoint, d) =>
  `${screen}::${breakpoint}::${d.class}::${d.figmaNodeId || d.token || normalizeName(d.component)}`

export const applyAllowlist = (discrepancies, screen, breakpoint, allowlist) => {
  const entries = (allowlist || []).filter(e => !e.screen || e.screen === screen)
  const allowed = d => entries.some(e =>
    e.class === d.class && (e.figmaNodeId ? e.figmaNodeId === d.figmaNodeId : e.token ? e.token === d.token : false))
  return {
    kept: discrepancies.filter(d => !allowed(d)),
    allowlisted: discrepancies.filter(allowed).map(d => cellKeyOf(screen, breakpoint, d)),
  }
}

export const measure = (figma, dom, { tolerancePx = 1, screen = '', breakpoint = '', allowlist = [] } = {}) => {
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
  const { kept, allowlisted } = applyAllowlist(all, screen, breakpoint, allowlist)
  const rank = { high: 0, medium: 1, low: 2 }
  kept.sort((a, b) => rank[a.severity] - rank[b.severity])
  const discrepancies = kept.map((d, i) =>
    ({ id: `d-${String(i + 1).padStart(3, '0')}`, key: cellKeyOf(screen, breakpoint, d), screen, breakpoint, ...d }))
  const keys = discrepancies.map(d => d.key)
  return {
    screen,
    breakpoint,
    pairs: pairs.length,
    keyCount: keys.length,
    seal: sealOf(keys),
    discrepancies,
    unmatchedFigma: unmatchedFigma.map(n => n.name),
    unmatchedDom: unmatchedDom.map(e => e.component || e.selector),
    unmatchedTokens: tokens.unmatchedTokens,
    allowlisted,
  }
}
