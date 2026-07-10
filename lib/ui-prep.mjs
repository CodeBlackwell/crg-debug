// crg-ui-prep's deterministic core: every scorecard status, verification, and the
// ready packet come out of this tool — never out of a model.
//   node ui-prep.mjs audit-repo <repoRoot> [--scope <dir>] --out <repo.json>
//   node ui-prep.mjs audit-env [--e2 <pass|gap>] [--e2-evidence <s>] [--e5-dpr <n>] --out <env.json>
//   node ui-prep.mjs normalize-figma-audit <frames.json> [--metadata <raw>] [--variables <raw>]
//                    [--code-connect <raw>] [--repo <repo.json>] [--prep <prep.json>] --out <figma.json>
//   node ui-prep.mjs scorecard <repo.json> [--figma <figma.json>] [--env <env.json>] --prep <prep.json>
//   node ui-prep.mjs record <prep.json> --item <id> --status <s> [--evidence <s>] [--reason <s>]
//   node ui-prep.mjs verify <itemId> --repo-root <r> [--scope <dir>] [--captures <a,b>]
//                    [--frames <frames.json>] [--profile <profile.json>]   (exit 0 green / 1 red / 2 no verifier)
//   node ui-prep.mjs packet <repoRoot>                 (writes .crg-ui/prep-packet.json, prints {wrote, seal})
//   node ui-prep.mjs verify-packet <repoRoot>          (exit 0 ready / 1 with reasons — /crg-ui's Stage 0 handshake)
//
// Statuses are computed from facts (counts, exit codes, greps); anything that needs
// judgment comes back as `unknown` with raw evidence — the gate decides, this tool
// never guesses. `done` / `descoped` / `n/a` in prep.json are settled human decisions
// and are NEVER downgraded by a re-audit.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { validateProfile, pairFrames, parseFrameName } from './ui-map.mjs'
import { sealOf, figmaVarToCssVar, normalizeVars } from './ui-measure.mjs'

// Checklist loop order (skills/crg-ui-prep/checklist.md) — the scorecard's row order.
export const ITEM_ORDER = ['1.1', 'E1', 'E2', 'E3', 'E5', '2.1', '2.2', '2.8', '2.5', '2.3', '2.4',
  '1.4', '1.5', '1.2', '2.6', '1.3', '1.6', '1.7', '1.8', '2.9', '1.9', 'E4', '2.7']
export const SETTLED = new Set(['done', 'descoped', 'n/a'])
export const itemsSeal = items =>
  sealOf(Object.entries(items || {}).map(([id, it]) => `${id}=${(it && it.status) || 'unknown'}`))

// ---- repo audit -------------------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.crg-ui'])
const CODE_RE = /\.(tsx|jsx|ts|js|mjs)$/
const COMPONENT_RE = /\.[tj]sx$/

const walkFiles = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) walkFiles(p, out)
    else out.push(p)
  }
  return out
}

const countMatches = (text, re) => (String(text).match(re) || []).length

// Pure over an in-memory file list: [{path, text}] — the CLI walks and reads.
// extras: {gitHeadTime, graphDbMtime, storybook, fixturesDir} gathered by the CLI.
export function auditRepo(files, extras = {}) {
  const code = files.filter(f => CODE_RE.test(f.path))
  const css = files.filter(f => f.path.endsWith('.css'))
  const isTokenFile = f => /token/i.test(basename(f.path)) || countMatches(f.text, /--[\w-]+\s*:/g) >= 3
  const tokenFiles = css.filter(isTokenFile)
  const tokenNames = [...new Set(tokenFiles.flatMap(f => [...f.text.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1])))]

  const componentFiles = code.filter(f => COMPONENT_RE.test(f.path))
  const taggedFiles = componentFiles.filter(f => /data-component=|data-testid=/.test(f.text))
  const coverage = componentFiles.length ? taggedFiles.length / componentFiles.length : 0

  const nonToken = code.filter(f => !/token/i.test(basename(f.path)))
  const colorLiterals = nonToken.reduce((n, f) => n + countMatches(f.text, /#[0-9a-fA-F]{3,8}\b/g), 0)

  const clockSeam = code.some(f => f.text.includes('__CRG_NOW__'))
  const reducedMotion = css.some(f => f.text.includes('prefers-reduced-motion'))
  const dateNowCount = code.reduce((n, f) => n + countMatches(f.text, /Date\.now\(\)|Math\.random\(\)/g), 0)

  const routes = [...new Set(code.flatMap(f =>
    [...f.text.matchAll(/path\s*[:=]\s*["'`]([^"'`]+)["'`]/g)].map(m => m[1]).filter(r => r.startsWith('/'))))]

  const pkg = extras.packageJson || {}
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const framework = deps.react ? 'react' : Object.keys(deps).find(d => ['vue', 'svelte', '@angular/core'].includes(d)) || null
  const devScripts = Object.keys(pkg.scripts || {}).filter(s => /dev|start/.test(s))

  const graphExists = extras.graphDbMtime != null
  const graphFresh = graphExists && extras.gitHeadTime != null && extras.graphDbMtime >= extras.gitHeadTime

  const items = {
    '2.1': framework === 'react'
      ? { status: 'pass', evidence: `react app at ${extras.appRoot || '.'} · dev-relevant scripts: ${devScripts.join(', ') || 'none'}` }
      : { status: 'gap', evidence: `framework detected: ${framework || 'none'} — v0.1 adapters require react` },
    '2.2': devScripts.length
      ? { status: 'pass', evidence: `scripts: ${devScripts.join(', ')} (devUrl confirmed at the gate, not guessed)` }
      : { status: 'gap', evidence: 'no dev/start script in the manifest' },
    '2.3': componentFiles.length && coverage >= 0.8
      ? { status: 'pass', evidence: `data-component/testid in ${taggedFiles.length}/${componentFiles.length} component files (${Math.round(coverage * 100)}%)` }
      : { status: 'gap', evidence: componentFiles.length ? `only ${taggedFiles.length}/${componentFiles.length} component files carry a tag` : 'no component files found in scope' },
    '2.4': tokenFiles.length && colorLiterals === 0
      ? { status: 'pass', evidence: `${tokenNames.length} token defs in ${tokenFiles.map(f => basename(f.path)).join(', ')} · 0 raw hex literals in scope` }
      : { status: 'gap', evidence: `${tokenFiles.length} token file(s), ${colorLiterals} raw hex literal(s) in code files` },
    '2.5': clockSeam && reducedMotion
      ? { status: 'pass', evidence: `clock seam (__CRG_NOW__) + reduced-motion block present · fixtures dir: ${extras.fixturesDir || 'none'} · ${dateNowCount} Date.now/Math.random site(s)` }
      : { status: 'gap', evidence: `clock seam: ${clockSeam} · reduced-motion: ${reducedMotion} · fixtures dir: ${extras.fixturesDir || 'none'} · ${dateNowCount} Date.now/Math.random site(s)` },
    '2.6': routes.length
      ? { status: 'pass', evidence: `${routes.length} route(s) from router source: ${routes.slice(0, 12).join(' ')}` }
      : { status: 'unknown', evidence: 'no path literals found — routes manifest needs the gate' },
    '2.7': extras.storybook ? { status: 'pass', evidence: '.storybook/ present' } : { status: 'gap', evidence: 'no .storybook/ (optional item)' },
    '2.8': graphFresh
      ? { status: 'pass', evidence: 'graph.db present and at least as new as HEAD' }
      : { status: 'gap', evidence: graphExists ? 'graph.db is older than HEAD — run code-review-graph update' : 'no .code-review-graph/graph.db — run code-review-graph build' },
    '2.9': { status: 'unknown', evidence: 'auth seam is not computable — the gate decides (tokenCmd pattern, crg-build parity)' },
  }
  return { items, facts: { framework, devScripts, componentFiles: componentFiles.length, taggedFiles: taggedFiles.length, coverage, colorLiterals, tokenNames, routes, clockSeam, reducedMotion, dateNowCount, graphExists, graphFresh }, seal: itemsSeal(items) }
}

// ---- env audit --------------------------------------------------------------------

const probe = (cmd, cmdArgs) => {
  try { return { ok: true, out: execFileSync(cmd, cmdArgs, { encoding: 'utf8', timeout: 60000 }).trim().split('\n')[0] } }
  catch (e) { return { ok: false, out: String((e && e.message) || e).slice(0, 200) } }
}

export function auditEnv({ e2, e2Evidence, e5Dpr, probeFn = probe } = {}) {
  const uv = probeFn('uv', ['--version'])
  const pw = probeFn('npx', ['playwright', '--version'])
  const items = {
    E1: uv.ok ? { status: 'pass', evidence: uv.out } : { status: 'gap', evidence: 'uv not on PATH' },
    E2: e2 ? { status: e2, evidence: e2Evidence || '' } : { status: 'unknown', evidence: 'figma whoami is an MCP call — supplied by the audit agent' },
    E3: pw.ok ? { status: 'pass', evidence: pw.out } : { status: 'gap', evidence: 'npx playwright --version failed' },
    E5: e5Dpr ? { status: 'pass', evidence: `dpr ${e5Dpr} recorded` } : { status: 'unknown', evidence: 'host DPR not supplied' },
  }
  const out = { items, seal: itemsSeal(items) }
  if (e5Dpr) out.dpr = Number(e5Dpr)
  return out
}

// ---- figma audit ------------------------------------------------------------------

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

// ---- scorecard --------------------------------------------------------------------

// Merge computed facts into prep.json. Settled human decisions (done/descoped/n/a)
// always win; a fresh pass/gap beats a stale pass/gap; unknown never overwrites.
export function scorecard(prev, ...computed) {
  const merged = { ...(prev && prev.items) }
  for (const c of computed) {
    for (const [id, item] of Object.entries((c && c.items) || {})) {
      const old = merged[id]
      if (old && SETTLED.has(old.status)) continue
      if (item.status === 'unknown' && old) continue
      merged[id] = item
    }
  }
  const items = {}
  for (const id of ITEM_ORDER) if (merged[id]) items[id] = merged[id]
  for (const id of Object.keys(merged)) if (!items[id]) items[id] = merged[id]
  const gaps = Object.entries(items).filter(([, it]) => it.status === 'gap').map(([id]) => id)
  const unknowns = Object.entries(items).filter(([, it]) => it.status === 'unknown').map(([id]) => id)
  return { items, gaps, unknowns, seal: itemsSeal(items) }
}

// ---- packet -----------------------------------------------------------------------

// The seal covers everything /crg-ui relies on, recomputed from the LIVE files at
// verify time — any drift in profile, allowlist, settled items, or pairing breaks it.
export const packetSealLines = ({ profile, allowlist, items, pairing }) => [
  `profile:${JSON.stringify(profile)}`,
  `allowlist:${JSON.stringify(allowlist)}`,
  ...Object.entries(items || {}).map(([id, it]) => `${id}=${it.status}`),
  pairing ? `pairing:${pairing.paired.length}/${pairing.unmatched.length}` : 'pairing:none',
]

// Items whose absence re-opens GATE-PROFILE questions or breaks measurement. Open
// gaps OUTSIDE this set ride along in the packet as openGaps — visible, not blocking.
export const PROFILE_CRITICAL = ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '2.5', '2.6', 'E1', 'E2', 'E3', 'E5']

export function buildPacket({ profile, allowlist, prep, frames }) {
  const errors = []
  const v = validateProfile(profile)
  if (!v.ok) errors.push(...v.errors.map(e => `profile: ${e}`))
  const open = Object.entries((prep && prep.items) || {}).filter(([, it]) => it.status === 'gap' || it.status === 'unknown')
  const blocking = open.filter(([id]) => PROFILE_CRITICAL.includes(id))
  if (blocking.length) errors.push(`profile-critical items still open (gap/unknown): ${blocking.map(([id]) => id).join(', ')} — gate them (done) or descope them first`)
  const pairing = frames ? pairFrames(frames, profile.breakpoints || [], (profile.screens || []).map(s => s.name)) : null
  if (pairing) {
    for (const s of profile.screens || []) {
      if (!pairing.paired.some(p => p.screen.toLowerCase() === s.name.toLowerCase())) errors.push(`pairing: screen "${s.name}" has no matching frame in frames.json`)
    }
  }
  if (errors.length) return { ok: false, errors }
  const items = (prep && prep.items) || {}
  return {
    ok: true,
    packet: {
      schemaVersion: 1,
      project: profile.project,
      figmaFileKey: profile.figma && profile.figma.fileKey,
      openGaps: open.map(([id]) => id),
      attestations: items,
      answers: (prep && prep.answers) || {},
      pairing: pairing ? { paired: pairing.paired.length, unmatched: pairing.unmatched.length } : null,
      seal: sealOf(packetSealLines({ profile, allowlist, items, pairing })),
    },
  }
}

export function verifyPacket({ packet, profile, allowlist, prep, frames }) {
  const reasons = []
  if (!packet || packet.schemaVersion !== 1) return { ok: false, reasons: ['no prep-packet.json (schemaVersion 1) — run /crg-ui-prep'] }
  if (!profile) reasons.push('profile.json missing')
  else {
    const v = validateProfile(profile)
    if (!v.ok) reasons.push(...v.errors.map(e => `profile: ${e}`))
  }
  const items = (prep && prep.items) || {}
  const pairing = frames && profile ? pairFrames(frames, profile.breakpoints || [], (profile.screens || []).map(s => s.name)) : null
  if (profile && sealOf(packetSealLines({ profile, allowlist, items, pairing })) !== packet.seal) {
    reasons.push('seal mismatch — profile, allowlist, prep items, or pairing changed since the packet was assembled; re-run prep')
  }
  return { ok: reasons.length === 0, reasons }
}

// ---- verify dispatch ---------------------------------------------------------------

// Re-run exactly one item's audit check. Returns {green, evidence} or {unsupported}.
export function verifyItem(id, ctx) {
  const fromRepo = () => auditRepo(ctx.files, ctx.extras).items[id]
  if (['2.1', '2.2', '2.3', '2.4', '2.6', '2.7', '2.8'].includes(id)) {
    const it = fromRepo()
    return { green: it.status === 'pass', evidence: it.evidence }
  }
  if (id === '2.5') {
    if (ctx.captures && ctx.captures.length === 2) {
      const [a, b] = ctx.captures
      const same = a === b
      return { green: same, evidence: same ? 'two captures byte-identical' : 'captures differ — render is not deterministic' }
    }
    const it = fromRepo()
    return { green: it.status === 'pass', evidence: it.evidence }
  }
  if (id === '1.2' || id === '1.3') {
    if (!ctx.frames || !ctx.profile) return { unsupported: true, evidence: 'needs --frames and --profile' }
    const fa = auditFigma({ frames: ctx.frames, answers: { breakpoints: ctx.profile.breakpoints, screens: ctx.profile.screens } })
    const it = fa.items[id]
    return { green: it.status === 'pass', evidence: it.evidence }
  }
  return { unsupported: true, evidence: `no deterministic verifier for ${id} — use the audit evidence and the gate` }
}

// ---- CLI --------------------------------------------------------------------------

const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
const readMaybe = p => { try { return readFileSync(p, 'utf8') } catch { return undefined } }
const today = () => new Date().toISOString().slice(0, 10)

// scope: comma-separated dirs/files relative to repoRoot (a profile fences.allow glob
// like "frontend/src/public/**" is accepted — the glob tail is stripped).
const gatherRepo = (repoRoot, scope) => {
  const entries = (scope ? scope.split(',') : [''])
    .map(s => join(repoRoot, s.trim().replace(/\/\*+$/, '')))
    .filter(existsSync)
  if (!entries.length) entries.push(repoRoot)
  const paths = entries.flatMap(p => statSync(p).isDirectory() ? walkFiles(p) : [p])
  const files = paths.filter(p => CODE_RE.test(p) || p.endsWith('.css'))
    .map(p => ({ path: p, text: readFileSync(p, 'utf8') }))
  let appRoot = statSync(entries[0]).isDirectory() ? entries[0] : dirname(entries[0])
  while (appRoot.length >= repoRoot.length && !existsSync(join(appRoot, 'package.json'))) appRoot = dirname(appRoot)
  const packageJson = existsSync(join(appRoot, 'package.json')) ? readJson(join(appRoot, 'package.json')) : {}
  let gitHeadTime = null
  try { gitHeadTime = Number(execFileSync('git', ['-C', repoRoot, 'log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim()) } catch { /* not a repo */ }
  const graphDb = join(repoRoot, '.code-review-graph', 'graph.db')
  const graphDbMtime = existsSync(graphDb) ? statSync(graphDb).mtimeMs / 1000 : null
  const fixturesDir = [join(appRoot, 'fixtures'), ...entries.map(e => join(e, 'fixtures'))].find(existsSync) || null
  const storybook = existsSync(join(appRoot, '.storybook')) || existsSync(join(repoRoot, '.storybook'))
  return { files, extras: { packageJson, gitHeadTime, graphDbMtime, fixturesDir, storybook, appRoot: appRoot.replace(repoRoot + '/', '') } }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2)
  const flag = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined }
  const [cmd, argA] = argv
  const emit = obj => process.stdout.write(JSON.stringify(obj) + '\n')
  const writeOut = (path, obj) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(obj, null, 2) + '\n') }

  if (cmd === 'audit-repo' && argA && flag('out')) {
    const { files, extras } = gatherRepo(argA, flag('scope'))
    const res = auditRepo(files, extras)
    writeOut(flag('out'), res)
    emit({ wrote: flag('out'), items: Object.keys(res.items).length, seal: res.seal })
  } else if (cmd === 'audit-env' && flag('out')) {
    const res = auditEnv({ e2: flag('e2'), e2Evidence: flag('e2-evidence'), e5Dpr: flag('e5-dpr') })
    writeOut(flag('out'), res)
    emit({ wrote: flag('out'), items: Object.keys(res.items).length, seal: res.seal })
  } else if (cmd === 'normalize-figma-audit' && argA && flag('out')) {
    const repo = flag('repo') ? readJson(flag('repo')) : {}
    const prep = flag('prep') ? readJson(flag('prep')) : {}
    const res = auditFigma({
      frames: readJson(argA),
      metadataRaw: flag('metadata') ? readMaybe(flag('metadata')) : undefined,
      variablesRaw: flag('variables') ? readMaybe(flag('variables')) : undefined,
      codeConnectRaw: flag('code-connect') ? readMaybe(flag('code-connect')) : undefined,
      answers: prep.answers || {},
      repoFacts: repo.facts || {},
    })
    writeOut(flag('out'), res)
    emit({ wrote: flag('out'), items: Object.keys(res.items).length, seal: res.seal })
  } else if (cmd === 'scorecard' && argA && flag('prep')) {
    const prev = existsSync(flag('prep')) ? readJson(flag('prep')) : {}
    const parts = [readJson(argA), flag('figma') && readJson(flag('figma')), flag('env') && readJson(flag('env'))].filter(Boolean)
    const res = scorecard(prev, ...parts)
    writeOut(flag('prep'), { schemaVersion: 1, ...prev, items: res.items, auditedAt: today() })
    emit({ wrote: flag('prep'), items: res.items, gaps: res.gaps, unknowns: res.unknowns, seal: res.seal })
  } else if (cmd === 'record' && argA && flag('item') && flag('status')) {
    const prep = existsSync(argA) ? readJson(argA) : { schemaVersion: 1, items: {} }
    const entry = { status: flag('status'), at: today() }
    if (flag('evidence')) entry.evidence = flag('evidence')
    if (flag('reason')) entry.reason = flag('reason')
    prep.items = { ...(prep.items || {}), [flag('item')]: entry }
    writeOut(argA, prep)
    emit({ wrote: argA, item: flag('item'), status: flag('status'), seal: itemsSeal(prep.items) })
  } else if (cmd === 'verify' && argA && flag('repo-root')) {
    const ctx = { ...gatherRepo(flag('repo-root'), flag('scope')) }
    if (flag('captures')) ctx.captures = flag('captures').split(',').map(p => readFileSync(p.trim(), 'utf8'))
    if (flag('frames')) ctx.frames = readJson(flag('frames'))
    if (flag('profile')) ctx.profile = readJson(flag('profile'))
    // Mid-loop, before profile.json exists, prep.json's answers carry breakpoints+screens.
    else if (flag('prep')) ctx.profile = (readJson(flag('prep')).answers) || {}
    const res = verifyItem(argA, ctx)
    emit({ item: argA, ...res })
    process.exit(res.unsupported ? 2 : res.green ? 0 : 1)
  } else if (cmd === 'packet' && argA) {
    const dir = join(argA, '.crg-ui')
    const frames = existsSync(join(dir, 'frames.json')) ? readJson(join(dir, 'frames.json')) : undefined
    const res = buildPacket({
      profile: readJson(join(dir, 'profile.json')),
      allowlist: existsSync(join(dir, 'allowlist.json')) ? readJson(join(dir, 'allowlist.json')) : [],
      prep: existsSync(join(dir, 'prep.json')) ? readJson(join(dir, 'prep.json')) : {},
      frames,
    })
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    res.packet.createdAt = new Date().toISOString()
    writeOut(join(dir, 'prep-packet.json'), res.packet)
    emit({ wrote: join(dir, 'prep-packet.json'), seal: res.packet.seal, openGaps: res.packet.openGaps })
  } else if (cmd === 'verify-packet' && argA) {
    const dir = join(argA, '.crg-ui')
    const load = n => existsSync(join(dir, n)) ? readJson(join(dir, n)) : undefined
    const res = verifyPacket({
      packet: load('prep-packet.json'), profile: load('profile.json'),
      allowlist: load('allowlist.json') || [], prep: load('prep.json') || {}, frames: load('frames.json'),
    })
    emit({ ready: res.ok, reasons: res.reasons })
    process.exit(res.ok ? 0 : 1)
  } else {
    process.stderr.write(
      'usage: ui-prep.mjs audit-repo <repoRoot> [--scope <dir>] --out <repo.json>\n'
      + '     | audit-env [--e2 <pass|gap>] [--e2-evidence <s>] [--e5-dpr <n>] --out <env.json>\n'
      + '     | normalize-figma-audit <frames.json> [--metadata <raw>] [--variables <raw>] [--code-connect <raw>] [--repo <repo.json>] [--prep <prep.json>] --out <figma.json>\n'
      + '     | scorecard <repo.json> [--figma <figma.json>] [--env <env.json>] --prep <prep.json>\n'
      + '     | record <prep.json> --item <id> --status <s> [--evidence <s>] [--reason <s>]\n'
      + '     | verify <itemId> --repo-root <r> [--scope <dir>] [--captures <a,b>] [--frames <f>] [--profile <p>]\n'
      + '     | packet <repoRoot> | verify-packet <repoRoot>\n')
    process.exit(1)
  }
}
