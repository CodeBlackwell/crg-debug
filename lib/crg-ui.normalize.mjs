// Canonical forms for everything crg-ui compares, plus the raw-capture normalizers
// that turn an agent's verbatim MCP/collector dump into the one shape the oracle
// accepts. Lenient on input (dump shapes vary), strict and deterministic on output.
// No CLI of its own — lib/crg-ui.measure.mjs dispatches the normalize-* subcommands.
//
// Canonical shapes (written by normalizeFigma/normalizeDom, consumed by measure):
//   figma.json  { frame:{id,name,width,height},
//                 nodes:[{id,name,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 variables?:{"color/primary":"#0055FF", ...} }
//                 (x,y relative to the frame's own origin)
//   dom.json    { route, viewport:{width,height},
//                 elements:[{component,selector,x,y,width,height,fontSize?,fontFamily?,fontWeight?}],
//                 tokens?:{"--color-primary":"#0055ff", ...} }
//                 (getBoundingClientRect at scroll 0 — same coordinate space)

// ---- value canonicalizers ---------------------------------------------------------

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

export const normalizeFontFamily = s => String(s == null ? '' : s).split(',')[0].trim().toLowerCase().replace(/['"]/g, '')
export const normalizeFontWeight = s => {
  const v = String(s == null ? '' : s).trim().toLowerCase()
  return v === 'normal' ? '400' : v === 'bold' ? '700' : v
}
export const pxNumber = s => {
  const n = parseFloat(String(s == null ? '' : s))
  return Number.isFinite(n) ? n : null
}

// ---- raw-capture normalizers ----------------------------------------------------------

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
// depth<=2 walk, component/named filter, absolute OR parent-relative -> frame-relative
// coordinates. REST-style dumps carry absoluteBoundingBox (subtract the frame origin);
// MCP get_metadata dumps carry flat x/y relative to the immediate PARENT, so nested
// coordinates must accumulate ancestor offsets — subtracting the origin alone leaves
// depth>=2 boxes parent-relative, which poisons every expected box in the ledger.
export const normalizeFigma = (raw, { frameId, variables = {} } = {}) => {
  const root = (frameId && findNodeById(raw, frameId))
    || (raw && typeof raw === 'object' && raw.id && raw.children ? raw : null)
  if (!root) throw new Error(`frame node ${JSON.stringify(frameId)} not found in raw metadata`)
  const origin = boxOf(root)
  const nodes = []
  const walk = (children, depth, offset) => {
    for (const c of children || []) {
      const type = String(c.type || '').toUpperCase()
      const keep = ALWAYS_KEEP.has(type)
        || (KEEP_IF_NAMED.has(type) && c.name && !DEFAULT_NAME.test(String(c.name).trim()))
      const b = boxOf(c)
      const pos = (c.absoluteBoundingBox || c.boundingBox)
        ? { x: b.x - origin.x, y: b.y - origin.y }
        : { x: offset.x + b.x, y: offset.y + b.y }
      if (keep) {
        const node = { id: c.id, name: c.name, x: pos.x, y: pos.y, width: b.width, height: b.height }
        if ((c.children || []).length) node.hasChildren = true
        if (type === 'TEXT') {
          node.isText = true
          const style = c.style || c
          if (style.fontSize != null) node.fontSize = style.fontSize
          if (style.fontFamily != null) node.fontFamily = style.fontFamily
          if (style.fontWeight != null) node.fontWeight = style.fontWeight
        }
        nodes.push(node)
      }
      if (depth < 2) walk(c.children, depth + 1, pos)
    }
  }
  walk(root.children, 1, { x: 0, y: 0 })
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
      ...(e.textLength != null ? { textLength: num(e.textLength) } : {}),
      ...(e.childCount != null ? { childCount: num(e.childCount) } : {}),
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
