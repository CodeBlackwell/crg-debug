// The crg-ui numeric oracle, in real code — geometry + token + typography layers,
// plus every deterministic transform around them (normalize raw captures, assemble
// the ledger, slice it). Agents TRANSCRIBE raw dumps and RUN this tool — they never
// compute coordinates, deltas, or ledger bytes themselves (an agent eyeballing a
// bounding box is exactly the nondeterminism this layer exists to remove).
//
//   node ui-measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>]
//                               [--breakpoint <name>] [--allowlist <path>] [--out <measure.json>]
//   node ui-measure.mjs normalize-vars  <raw.json> --out <variables.json>
//   node ui-measure.mjs normalize-figma <raw.json> --frame <nodeId> --out <slug.figma.json>
//                               [--variables <variables.json>]
//   node ui-measure.mjs normalize-dom   <raw.json> --route <r> --width <w> --height <h>
//                               --out <slug.dom.json>
//   node ui-measure.mjs assemble <capturesDir> --profile <profile.json> --repo-root <path>
//                               --out <ledger.json> [--failed <slug,slug>]
//   node ui-measure.mjs slice    <ledger.json> [--keys <k1,k2,...>] [--ids <slug.d-001,...>]
//
// Each command prints ONE line of JSON. `measure`, `assemble`, and `slice` include a
// `seal` — FNV-1a over the sorted discrepancy keys — so a workflow script can verify
// an agent relayed the output unmangled (the script recomputes the seal from the
// relayed keys; the sandbox has no node:crypto, so the seal is plain JS on purpose).
//
// Canonical shapes (written by normalize-*, consumed by measure):
//   figma.json  { frame:{id,name,width,height},
//                 nodes:[{id,name,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 variables?:{"color/primary":"#0055FF", ...} }
//                 (x,y relative to the frame's own origin)
//   dom.json    { route, viewport:{width,height},
//                 elements:[{component,selector,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 tokens?:{"--color-primary":"#0055ff", ...} }
//                 (getBoundingClientRect at scroll 0 — same coordinate space)

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'

// ---- seal -----------------------------------------------------------------------

// FNV-1a 32-bit over the sorted keys. Not cryptographic — it detects accidental
// truncation/paraphrase when tool output travels through an agent relay. MUST stay
// byte-identical to the sealOf in workflows/crg-ui.js's pure-helpers (parity-tested).
export const sealOf = keys => {
  const s = [...(keys || [])].sort().join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

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
// Breakpoint is part of the key — the same token measured at two breakpoints is two
// keys, so the no-regression baseline stays collision-free.
export const keyOf = (screen, breakpoint, d) =>
  `${screen}::${breakpoint}::${d.class}::${d.figmaNodeId || d.token || normalizeName(d.component)}`

export const applyAllowlist = (discrepancies, screen, breakpoint, allowlist) => {
  const entries = (allowlist || []).filter(e => !e.screen || e.screen === screen)
  const allowed = d => entries.some(e =>
    e.class === d.class && (e.figmaNodeId ? e.figmaNodeId === d.figmaNodeId : e.token ? e.token === d.token : false))
  return {
    kept: discrepancies.filter(d => !allowed(d)),
    allowlisted: discrepancies.filter(allowed).map(d => keyOf(screen, breakpoint, d)),
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
    ({ id: `d-${String(i + 1).padStart(3, '0')}`, key: keyOf(screen, breakpoint, d), screen, breakpoint, ...d }))
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

// ---- raw-capture normalizers ----------------------------------------------------------
// Agents dump what the MCP tool returned, verbatim; these turn a dump into the one
// canonical shape `measure` accepts. Lenient on input (MCP output shapes vary),
// strict and deterministic on output.

// Figma color object {r,g,b,a?} in 0-1 floats -> canonical hex.
const figmaColorToHex = v => {
  const c = n => Math.round(Math.max(0, Math.min(1, Number(n))) * 255).toString(16).padStart(2, '0')
  const a = v.a === undefined ? 1 : Number(v.a)
  return `#${c(v.r)}${c(v.g)}${c(v.b)}` + (a < 1 ? c(a) : '')
}

const resolveVarValue = v => {
  if (v == null) return undefined
  if (typeof v === 'string' || typeof v === 'number') return v
  if (typeof v === 'boolean') return String(v)
  if (typeof v === 'object') {
    if (v.r !== undefined && v.g !== undefined && v.b !== undefined) return figmaColorToHex(v)
    if (v.resolvedValue !== undefined) return resolveVarValue(v.resolvedValue)
    if (v.value !== undefined) return resolveVarValue(v.value)
    if (v.valuesByMode && typeof v.valuesByMode === 'object') {
      return resolveVarValue(Object.values(v.valuesByMode)[0])
    }
  }
  return undefined
}

// Raw get_variable_defs dump -> flat sorted {"<name>": <string|number>} map.
export const normalizeVars = raw => {
  const src = raw && typeof raw === 'object' && raw.variables && typeof raw.variables === 'object'
    ? raw.variables : raw
  const out = {}
  for (const name of Object.keys(src || {}).sort()) {
    const value = resolveVarValue(src[name])
    if (value !== undefined) out[name] = value
  }
  return out
}

// Node bounds wherever the dump put them: absoluteBoundingBox, boundingBox, or flat.
const boxOf = n => {
  const b = (n && (n.absoluteBoundingBox || n.boundingBox)) || n || {}
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return { x: num(b.x), y: num(b.y), width: num(b.width), height: num(b.height) }
}

const findNodeById = (node, id) => {
  if (node == null || typeof node !== 'object') return null
  if (!Array.isArray(node) && node.id === id) return node
  for (const v of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findNodeById(v, id)
    if (hit) return hit
  }
  return null
}

const DEFAULT_NAME = /^(frame|group|text|rectangle|vector|ellipse|line|polygon|star|boolean|union|subtract|intersect|exclude)\s*\d*$/i
const ALWAYS_KEEP = new Set(['COMPONENT', 'INSTANCE', 'COMPONENT_SET'])
const KEEP_IF_NAMED = new Set(['FRAME', 'GROUP', 'TEXT'])

// Raw get_metadata frame subtree -> canonical figma.json. ALL math lives here:
// depth<=2 walk, component/named filter, absolute -> frame-relative coordinates.
export const normalizeFigma = (raw, { frameId, variables = {} } = {}) => {
  const root = (frameId && findNodeById(raw, frameId))
    || (raw && typeof raw === 'object' && raw.id && raw.children ? raw : null)
  if (!root) throw new Error(`frame node ${JSON.stringify(frameId)} not found in raw metadata`)
  const origin = boxOf(root)
  const nodes = []
  const walk = (children, depth) => {
    for (const c of children || []) {
      const type = String(c.type || '').toUpperCase()
      const keep = ALWAYS_KEEP.has(type)
        || (KEEP_IF_NAMED.has(type) && c.name && !DEFAULT_NAME.test(String(c.name).trim()))
      if (keep) {
        const b = boxOf(c)
        const node = { id: c.id, name: c.name, x: b.x - origin.x, y: b.y - origin.y, width: b.width, height: b.height }
        if (type === 'TEXT') {
          const style = c.style || c
          if (style.fontSize != null) node.fontSize = style.fontSize
          if (style.fontFamily != null) node.fontFamily = style.fontFamily
          if (style.fontWeight != null) node.fontWeight = style.fontWeight
        }
        nodes.push(node)
      }
      if (depth < 2) walk(c.children, depth + 1)
    }
  }
  walk(root.children, 1)
  return {
    frame: { id: root.id, name: root.name, width: origin.width, height: origin.height },
    nodes,
    variables,
  }
}

// Raw collector output (possibly wrapped by browser_evaluate) -> canonical dom.json.
export const normalizeDom = (raw, { route = '', width = 0, height = 0 } = {}) => {
  const src = raw && typeof raw === 'object'
    ? (Array.isArray(raw.elements) ? raw : raw.result && Array.isArray(raw.result.elements) ? raw.result : null)
    : null
  if (!src) throw new Error('raw dom capture must contain an elements array')
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const elements = src.elements
    .filter(e => e && (e.component || e.selector))
    .map(e => ({
      component: String(e.component || ''), selector: String(e.selector || ''),
      x: num(e.x), y: num(e.y), width: num(e.width), height: num(e.height),
      ...(e.fontSize != null ? { fontSize: String(e.fontSize) } : {}),
      ...(e.fontFamily != null ? { fontFamily: String(e.fontFamily) } : {}),
      ...(e.fontWeight != null ? { fontWeight: String(e.fontWeight) } : {}),
    }))
    .sort((a, b) => a.component.localeCompare(b.component) || a.selector.localeCompare(b.selector))
  const tokens = {}
  for (const k of Object.keys(src.tokens || {}).sort()) {
    if (k.startsWith('--')) tokens[k] = String(src.tokens[k]).trim()
  }
  return { route, viewport: { width: num(width), height: num(height) }, elements, tokens }
}

// ---- ledger assembly + slicing ---------------------------------------------------------

// measures: [{slug, out}] where out is a `measure` result. Ids become cell-qualified
// ("<slug>.d-001") so they are unique across the whole ledger.
export const assembleLedger = (measures, profile, { repoRoot = '', failed = [] } = {}) => {
  const routeOf = new Map((profile.screens || []).map(s => [s.name, s.route]))
  const cells = measures.map(({ slug, out }) => ({
    screen: out.screen, breakpoint: out.breakpoint, route: routeOf.get(out.screen) || '', slug,
    pairs: out.pairs,
    discrepancies: (out.discrepancies || []).map(d => ({ ...d, id: `${slug}.${d.id}` })),
    unmatchedFigma: out.unmatchedFigma || [], unmatchedDom: out.unmatchedDom || [],
    unmatchedTokens: out.unmatchedTokens || [], allowlisted: out.allowlisted || [],
  }))
  const allKeys = cells.flatMap(c => c.discrepancies.map(d => d.key))
  return {
    schemaVersion: 2, repoRoot, project: profile.project, mode: profile.mode,
    figmaFileKey: profile.figma && profile.figma.fileKey,
    tolerancePx: (profile.tolerance && profile.tolerance.geometryPx) || 1,
    cells, failedCells: failed, allKeys, seal: sealOf(allKeys),
  }
}

// Select approved discrepancies out of a ledger, deterministically. `seal` covers
// allKeys (the no-regression baseline), `selectedSeal` the chosen keys, and
// `allowlistSeal` the allowlisted keys (blessed deviations the repair baseline must
// tolerate) — a workflow script recomputes each from the relayed arrays to prove the
// relay was faithful.
export const sliceUiLedger = (ledger, { keys = [], ids = [] } = {}) => {
  const wantKey = new Set(keys)
  const wantId = new Set(ids)
  const discrepancies = (ledger.cells || [])
    .flatMap(c => c.discrepancies || [])
    .filter(d => wantKey.has(d.key) || wantId.has(d.id))
  const allKeys = ledger.allKeys || []
  const allowlistedKeys = (ledger.cells || []).flatMap(c => c.allowlisted || [])
  return {
    discrepancies, allKeys, allowlistedKeys,
    seal: sealOf(allKeys), selectedSeal: sealOf(discrepancies.map(d => d.key)), allowlistSeal: sealOf(allowlistedKeys),
  }
}

// ---- CLI ----------------------------------------------------------------------------

const USAGE = `usage:
  ui-measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>] [--breakpoint <name>] [--allowlist <path>] [--out <measure.json>]
  ui-measure.mjs normalize-vars <raw.json> --out <variables.json>
  ui-measure.mjs normalize-figma <raw.json> --frame <nodeId> --out <figma.json> [--variables <variables.json>]
  ui-measure.mjs normalize-dom <raw.json> --route <r> --width <w> --height <h> --out <dom.json>
  ui-measure.mjs assemble <capturesDir> --profile <profile.json> --repo-root <path> --out <ledger.json> [--failed <slug,slug>]
  ui-measure.mjs slice <ledger.json> [--keys <k1,k2,...>] [--ids <id1,id2,...>]
`

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
  const list = name => (flag(name) ? flag(name).split(',').map(s => s.trim()).filter(Boolean) : [])
  const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
  const writeOut = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + '\n') }
  const print = obj => process.stdout.write(JSON.stringify(obj) + '\n')
  const die = msg => { process.stderr.write(msg + '\n'); process.exit(1) }
  const needOut = () => flag('out') || die(`${argv[0]}: --out <path> is required`)
  const [cmd, srcPath, secondPath] = argv

  try {
    if (cmd === 'measure' && srcPath && secondPath) {
      const result = measure(readJson(srcPath), readJson(secondPath), {
        tolerancePx: flag('tolerance') !== undefined ? Number(flag('tolerance')) : 1,
        screen: flag('screen') || '',
        breakpoint: flag('breakpoint') || '',
        allowlist: flag('allowlist') ? readJson(flag('allowlist')) : [],
      })
      if (flag('out')) writeOut(flag('out'), result)
      print(result)
    } else if (cmd === 'normalize-vars' && srcPath) {
      const vars = normalizeVars(readJson(srcPath))
      writeOut(needOut(), vars)
      print({ wrote: flag('out'), count: Object.keys(vars).length })
    } else if (cmd === 'normalize-figma' && srcPath) {
      const out = normalizeFigma(readJson(srcPath), {
        frameId: flag('frame'),
        variables: flag('variables') ? readJson(flag('variables')) : {},
      })
      writeOut(needOut(), out)
      print({ wrote: flag('out'), count: out.nodes.length })
    } else if (cmd === 'normalize-dom' && srcPath) {
      const out = normalizeDom(readJson(srcPath), {
        route: flag('route') || '', width: Number(flag('width')) || 0, height: Number(flag('height')) || 0,
      })
      writeOut(needOut(), out)
      print({ wrote: flag('out'), count: out.elements.length })
    } else if (cmd === 'assemble' && srcPath) {
      const profile = readJson(flag('profile') || die('assemble: --profile <profile.json> is required'))
      const measures = readdirSync(srcPath).filter(f => f.endsWith('.measure.json')).sort()
        .map(f => ({ slug: basename(f, '.measure.json'), out: readJson(join(srcPath, f)) }))
      if (!measures.length) die(`assemble: no *.measure.json files in ${srcPath}`)
      const ledger = assembleLedger(measures, profile, { repoRoot: flag('repo-root') || '', failed: list('failed') })
      writeOut(needOut(), ledger)
      print({ wrote: flag('out'), cells: ledger.cells.length, discrepancies: ledger.allKeys.length, allKeys: ledger.allKeys, seal: ledger.seal })
    } else if (cmd === 'slice' && srcPath) {
      print(sliceUiLedger(readJson(srcPath), { keys: list('keys'), ids: list('ids') }))
    } else {
      die(USAGE)
    }
  } catch (e) {
    die(String((e && e.message) || e))
  }
}
