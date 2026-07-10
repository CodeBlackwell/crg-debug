// crg-ui profile validation, Figma frame pairing, dev-server readiness, and
// deviation blessing — in real code.
//   node ui-map.mjs validate <profile.json>            (exit 0 ok / 1 with errors on stderr)
//   node ui-map.mjs pair <frames.json> <profile.json>  (prints one line of JSON)
//   node ui-map.mjs waitup <url> --timeout <sec> [--interval <sec>]
//                                                      (exit 0 once the app answers, 1 on timeout)
//   node ui-map.mjs bless <profile.json> --entry '<json>' --allowlist <allowlist.json>
//                                                      (append to intentionalDeviations, rewrite allowlist)
//
// The profile is crg-ui's genericity seam: it records everything GATE-PROFILE
// resolved (stack, mode, breakpoints, screen<->frame pairing, fences, blessed
// deviations) so re-runs never re-ask an answered question. The validator enforces
// the contracts the Workflow's JS relies on and cannot recover from at run time.
//
// frames.json: [{id, name, width, height}] — the file's top-level frames from
// figma get_metadata. Pairing parses the "<Screen> / <Breakpoint>" convention;
// anything it cannot place lands in unmatched for the human at GATE-PROFILE.

import { readFileSync, writeFileSync } from 'node:fs'

const MODES = ['desktop-only', 'mobile-only', 'responsive', 'adaptive']
const FRAMEWORKS = ['react'] // v0.1 stack adapters; extend as adapters land

export function validateProfile(p) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(p && typeof p === 'object', 'profile must be an object')
  if (!p || typeof p !== 'object') return { ok: false, errors }

  need(p.schemaVersion === 1, 'schemaVersion: must be 1')
  need(typeof p.project === 'string' && p.project.length > 0, 'project: non-empty string required')

  const figma = p.figma || {}
  need(typeof figma.fileKey === 'string' && figma.fileKey.length > 0, 'figma.fileKey: non-empty string required')

  const stack = p.stack || {}
  need(FRAMEWORKS.includes(stack.framework), `stack.framework: one of ${FRAMEWORKS.join('|')} required (v0.1 adapters)`)
  need(typeof stack.devCommand === 'string' && stack.devCommand.length > 0, 'stack.devCommand: non-empty command required (must boot in DEV mode — owner resolution needs it)')
  need(typeof stack.devUrl === 'string' && /^https?:\/\//.test(stack.devUrl), 'stack.devUrl: http(s) URL required')
  need(Number.isInteger(stack.readyTimeoutSec) && stack.readyTimeoutSec > 0, 'stack.readyTimeoutSec: positive integer required')

  need(MODES.includes(p.mode), `mode: one of ${MODES.join('|')} required`)

  const bps = p.breakpoints
  need(Array.isArray(bps) && bps.length > 0, 'breakpoints: non-empty array required')
  const bpNames = new Set()
  for (const [i, bp] of (bps || []).entries()) {
    need(bp && typeof bp.name === 'string' && bp.name.length > 0, `breakpoints[${i}].name: non-empty string required`)
    need(Number.isInteger(bp && bp.width) && bp.width > 0, `breakpoints[${i}].width: positive integer required`)
    need(Number.isInteger(bp && bp.height) && bp.height > 0, `breakpoints[${i}].height: positive integer required`)
    if (bp && bp.name) bpNames.add(bp.name)
  }

  const screens = p.screens
  need(Array.isArray(screens) && screens.length > 0, 'screens: non-empty array required')
  for (const [i, s] of (screens || []).entries()) {
    need(s && typeof s.name === 'string' && s.name.length > 0, `screens[${i}].name: non-empty string required`)
    need(s && typeof s.route === 'string' && s.route.startsWith('/'), `screens[${i}].route: route starting with / required`)
    const frames = (s && s.frames) || {}
    need(Object.keys(frames).length > 0, `screens[${i}].frames: at least one breakpoint->frameNodeId entry required`)
    for (const [bp, nodeId] of Object.entries(frames)) {
      need(bpNames.has(bp), `screens[${i}].frames: unknown breakpoint "${bp}" (declare it in breakpoints[])`)
      need(typeof nodeId === 'string' && nodeId.length > 0, `screens[${i}].frames.${bp}: non-empty figma node id required`)
    }
  }

  const tol = p.tolerance || {}
  need(typeof tol.geometryPx === 'number' && tol.geometryPx > 0, 'tolerance.geometryPx: positive number required')

  const fences = p.fences || {}
  need(Array.isArray(fences.allow) && fences.allow.length > 0, 'fences.allow: non-empty glob array required')
  need(Array.isArray(fences.forbid), 'fences.forbid: array required (may be empty)')

  need(Array.isArray(p.intentionalDeviations), 'intentionalDeviations: array required (may be empty — human-blessed "close enough" items)')

  return { ok: errors.length === 0, errors }
}

// ---- frame pairing --------------------------------------------------------------

// "Home / Desktop 1440" -> {screen:"Home", label:"desktop 1440"}. A frame with no
// separator has no screen half and can only pair by exact-width fallback.
export const parseFrameName = name => {
  const parts = String(name == null ? '' : name).split('/').map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return { screen: parts[0] || '', label: '' }
  return { screen: parts.slice(0, -1).join(' / '), label: parts[parts.length - 1].toLowerCase() }
}

// Breakpoint resolution ladder: name substring in the label -> exact frame width ->
// null (human decides). Width alone never overrides a name hit.
export const inferBreakpoint = (label, width, breakpoints) => {
  for (const bp of breakpoints || []) {
    if (label && label.includes(String(bp.name).toLowerCase())) return { name: bp.name, confidence: 'name' }
  }
  const byWidth = (breakpoints || []).filter(bp => bp.width === width)
  if (byWidth.length === 1) return { name: byWidth[0].name, confidence: 'width' }
  return null
}

export const pairFrames = (frames, breakpoints, screenNames) => {
  const known = new Set((screenNames || []).map(s => s.toLowerCase()))
  const paired = []
  const unmatched = []
  for (const f of frames || []) {
    const { screen, label } = parseFrameName(f.name)
    const bp = inferBreakpoint(label, f.width, breakpoints)
    const screenKnown = !known.size || known.has(screen.toLowerCase())
    if (screen && bp && screenKnown) {
      paired.push({ screen, breakpoint: bp.name, nodeId: f.id, frameName: f.name, width: f.width, height: f.height, confidence: bp.confidence })
    } else {
      unmatched.push({ nodeId: f.id, frameName: f.name, width: f.width, height: f.height,
        reason: !screen ? 'no screen segment in name' : !bp ? 'no breakpoint match by name or width' : 'screen not in profile' })
    }
  }
  return { paired, unmatched }
}

// ---- dev-server readiness -----------------------------------------------------------

// Poll until probeFn resolves truthy or the deadline passes. probeFn is injected so
// the loop is testable without a network; the CLI wires in a real fetch probe.
export async function pollUntilUp(probeFn, { timeoutSec, intervalSec = 5, sleep } = {}) {
  const wait = sleep || (ms => new Promise(r => setTimeout(r, ms)))
  const deadline = Date.now() + timeoutSec * 1000
  let lastError = 'no probe attempted'
  for (;;) {
    try {
      if (await probeFn()) return { up: true }
    } catch (e) {
      lastError = String((e && e.message) || e)
    }
    if (Date.now() >= deadline) return { up: false, lastError }
    await wait(intervalSec * 1000)
  }
}

// ---- deviation blessing ---------------------------------------------------------------

// One command keeps profile.intentionalDeviations and allowlist.json in sync: the
// profile is the single source; the allowlist is always rewritten from it whole.
export function blessEntry(profile, entry) {
  const errors = []
  if (!entry || typeof entry !== 'object') errors.push('entry must be an object')
  else {
    if (typeof entry.class !== 'string' || !entry.class) errors.push('entry.class: non-empty string required')
    if (!entry.figmaNodeId && !entry.token) errors.push('entry needs figmaNodeId or token — the subject being blessed')
    if (typeof entry.reason !== 'string' || !entry.reason) errors.push('entry.reason: non-empty string required — deviations are never blessed silently')
    if (entry.screen !== undefined && typeof entry.screen !== 'string') errors.push('entry.screen: string when present')
  }
  if (errors.length) return { ok: false, errors }
  const deviations = [...(profile.intentionalDeviations || []), entry]
  return { ok: true, profile: { ...profile, intentionalDeviations: deviations }, allowlist: deviations }
}

// ---- CLI --------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
  const [cmd, argA, argB] = argv
  if (cmd === 'validate' && argA) {
    const res = validateProfile(JSON.parse(readFileSync(argA, 'utf8')))
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    process.stdout.write('ok\n')
  } else if (cmd === 'pair' && argA && argB) {
    const frames = JSON.parse(readFileSync(argA, 'utf8'))
    const profile = JSON.parse(readFileSync(argB, 'utf8'))
    const res = pairFrames(frames, profile.breakpoints || [], (profile.screens || []).map(s => s.name))
    process.stdout.write(JSON.stringify(res) + '\n')
  } else if (cmd === 'waitup' && argA && flag('timeout')) {
    const probe = async () => {
      const res = await fetch(argA, { redirect: 'manual' }).catch(e => { throw e })
      return res.status < 500
    }
    const { up, lastError } = await pollUntilUp(probe, {
      timeoutSec: Number(flag('timeout')),
      intervalSec: flag('interval') !== undefined ? Number(flag('interval')) : 5,
    })
    if (!up) { process.stderr.write(`waitup: ${argA} did not answer — ${lastError}\n`); process.exit(1) }
    process.stdout.write('up\n')
  } else if (cmd === 'bless' && argA && flag('entry') && flag('allowlist')) {
    const profile = JSON.parse(readFileSync(argA, 'utf8'))
    const res = blessEntry(profile, JSON.parse(flag('entry')))
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    writeFileSync(argA, JSON.stringify(res.profile, null, 2) + '\n')
    writeFileSync(flag('allowlist'), JSON.stringify(res.allowlist, null, 2) + '\n')
    process.stdout.write(JSON.stringify({ blessed: res.allowlist.length }) + '\n')
  } else {
    process.stderr.write(
      'usage: ui-map.mjs validate <profile.json> | pair <frames.json> <profile.json>\n'
      + '     | waitup <url> --timeout <sec> [--interval <sec>]\n'
      + '     | bless <profile.json> --entry \'<json>\' --allowlist <allowlist.json>\n')
    process.exit(1)
  }
}
