// The Figma half of crg-ui-prep's audit: a tolerant census over a raw get_metadata
// dump plus the pairing, sizing, and variable-mirror verdicts the checklist needs.
// The audit agent transcribes MCP output verbatim; every verdict is computed here.
// No CLI of its own — lib/crg-ui.prep.mjs dispatches normalize-figma-audit.

import { pairFrames, parseFrameName } from './crg-ui.map.mjs'
import { itemsSeal } from './crg-ui.seal.mjs'
import { figmaVarToCssVar, normalizeVars } from './crg-ui.normalize.mjs'

// Tolerant census over a raw get_metadata dump: JSON (walk any object tree) or the
// XML-ish tag format (attributes only — nesting is not needed for a census).
export function parseMetadataNodes(rawText) {
  const nodes = []
  const push = n => { if (n && n.id && n.name != null) nodes.push({ id: String(n.id), name: String(n.name), type: String(n.type || '').toUpperCase() }) }
  try {
    const walk = v => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (v && typeof v === 'object') { push(v); Object.values(v).forEach(walk) }
    }
    walk(JSON.parse(rawText))
  } catch {
    for (const m of String(rawText).matchAll(/<([a-zA-Z][\w-]*)\b([^>]*?)\/?>/g)) {
      const attrs = Object.fromEntries([...m[2].matchAll(/([\w-]+)="([^"]*)"/g)].map(a => [a[1], a[2]]))
      push({ id: attrs.id, name: attrs.name, type: m[1] })
    }
  }
  return nodes
}

// frames: [{id,name,width,height}] (transcribed top-level frames). answers: the prep
// answers block (breakpoints + screens drive the pairing verdicts). repo: audit-repo's
// output (tokenNames drive the 1.5 mirror check).
export function auditFigma({ frames = [], metadataRaw, variablesRaw, codeConnectRaw, answers = {}, repoFacts = {} } = {}) {
  const breakpoints = answers.breakpoints || []
  const screenNames = (answers.screens || []).map(s => s.name)
  const pairing = pairFrames(frames, breakpoints, screenNames)
  const bpWidth = new Map(breakpoints.map(bp => [bp.name, bp.width]))
  const offSize = pairing.paired.filter(p => bpWidth.get(p.breakpoint) !== p.width)

  const census = {}
  for (const n of metadataRaw ? parseMetadataNodes(metadataRaw) : []) census[n.type] = (census[n.type] || 0) + 1
  const components = (census.COMPONENT || 0) + (census.COMPONENT_SET || 0)

  let variables = {}
  try { variables = variablesRaw ? normalizeVars(JSON.parse(variablesRaw)) : {} } catch { variables = {} }
  const varNames = Object.keys(variables)
  const tokenNames = new Set(repoFacts.tokenNames || [])
  const mirrored = varNames.filter(n => tokenNames.has(figmaVarToCssVar(n)))

  let codeConnect = null
  try { const cc = codeConnectRaw ? JSON.parse(codeConnectRaw) : null; codeConnect = cc ? (Array.isArray(cc) ? cc.length : Object.keys(cc).length) : null } catch { codeConnect = -1 }

  const paired = pairing.paired.length
  const canPair = breakpoints.length && screenNames.length
  const allScreensPaired = canPair && screenNames.every(s => pairing.paired.some(p => p.screen.toLowerCase() === s.toLowerCase()))
  const items = {
    '1.1': frames.length ? { status: 'pass', evidence: `${frames.length} top-level frame(s)` } : { status: 'gap', evidence: 'no top-level frames — the bootstrap gate is the first stop' },
    '1.2': !canPair
      ? { status: 'unknown', evidence: `no breakpoints/screens answered yet — ${frames.filter(f => parseFrameName(f.name).label).length}/${frames.length} frame names parse as "<Screen> / <Breakpoint>"` }
      : allScreensPaired
        ? { status: 'pass', evidence: `pairer: ${paired} paired, ${pairing.unmatched.length} unmatched (every declared screen paired)` }
        : { status: 'gap', evidence: `pairer: ${paired} paired, ${pairing.unmatched.length} unmatched — some declared screen has no frame` },
    '1.3': !canPair || !paired
      ? { status: 'unknown', evidence: 'needs a pairing to check sizes against breakpoints' }
      : offSize.length === 0
        ? { status: 'pass', evidence: `all ${paired} paired frame(s) at exact breakpoint width` }
        : { status: 'gap', evidence: `${offSize.length} paired frame(s) off-size: ${offSize.map(p => `${p.frameName}@${p.width}`).join(', ')}` },
    '1.4': varNames.length ? { status: 'pass', evidence: `${varNames.length} design variable(s) defined (binding depth is the gate's judgment)` } : { status: 'gap', evidence: 'get_variable_defs returned no variables' },
    '1.5': !varNames.length
      ? { status: 'unknown', evidence: 'no variables to mirror (see 1.4)' }
      : mirrored.length === varNames.length
        ? { status: 'pass', evidence: `${mirrored.length}/${varNames.length} variable names mirror a code token` }
        : { status: 'gap', evidence: `${mirrored.length}/${varNames.length} variable names mirror a code token — unmirrored: ${varNames.filter(n => !tokenNames.has(figmaVarToCssVar(n))).slice(0, 8).join(', ')}` },
    '1.6': components ? { status: 'pass', evidence: `${components} component(s) in the metadata census` } : { status: 'gap', evidence: `0 COMPONENT nodes in the census (${JSON.stringify(census)})` },
    '1.7': codeConnect === null
      ? { status: 'unknown', evidence: 'no code-connect dump supplied' }
      : codeConnect > 0
        ? { status: 'pass', evidence: `${codeConnect} Code Connect entr(ies)` }
        : { status: 'gap', evidence: codeConnect === 0 ? 'Code Connect map is empty' : 'code-connect dump unparseable' },
    '1.8': { status: 'unknown', evidence: 'export settings are not in the metadata dump — the gate decides' },
    '1.9': { status: 'unknown', evidence: 'font families are not in the metadata dump — the audit agent supplies them' },
  }
  return { items, facts: { frames: frames.length, pairing, census, variableCount: varNames.length, mirrored: mirrored.length, codeConnect }, seal: itemsSeal(items) }
}
