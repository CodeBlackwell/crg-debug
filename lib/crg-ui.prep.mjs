// crg-ui-prep's deterministic front door: the scorecard merge, the per-item verify
// dispatch, and the single CLI the workflow shells out to. The layers themselves live
// one level down — lib/crg-ui.prep-audit.mjs (repo + env facts), lib/crg-ui.prep-figma.mjs
// (the Figma census), lib/crg-ui.prep-packet.mjs (the ready packet). Every status,
// verification, and packet seal comes out of this tool — never out of a model.
//   node crg-ui.prep.mjs audit-repo <repoRoot> [--scope <dir>] --out <repo.json>
//   node crg-ui.prep.mjs audit-env [--e2 <pass|gap>] [--e2-evidence <s>] [--e5-dpr <n>] --out <env.json>
//   node crg-ui.prep.mjs normalize-figma-audit <frames.json> [--metadata <raw>] [--variables <raw>]
//                    [--code-connect <raw>] [--repo <repo.json>] [--prep <prep.json>] --out <figma.json>
//   node crg-ui.prep.mjs scorecard <repo.json> [--figma <figma.json>] [--env <env.json>] --prep <prep.json>
//   node crg-ui.prep.mjs record <prep.json> --item <id> --status <s> [--evidence <s>] [--reason <s>]
//   node crg-ui.prep.mjs verify <itemId> --repo-root <r> [--scope <dir>] [--captures <a,b>]
//                    [--frames <frames.json>] [--profile <profile.json>]   (exit 0 green / 1 red / 2 no verifier)
//   node crg-ui.prep.mjs packet <repoRoot>                 (writes .crg-ui/prep-packet.json, prints {wrote, seal})
//   node crg-ui.prep.mjs verify-packet <repoRoot>          (exit 0 ready / 1 with reasons — /crg-ui's Stage 0 handshake)
//
// Statuses are computed from facts (counts, exit codes, greps); anything that needs
// judgment comes back as `unknown` with raw evidence — the gate decides, this tool
// never guesses. `done` / `descoped` / `n/a` in prep.json are settled human decisions
// and are NEVER downgraded by a re-audit.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { itemsSeal } from './crg-ui.seal.mjs'
import { auditRepo, auditEnv, gatherRepo } from './crg-ui.prep-audit.mjs'
import { auditFigma } from './crg-ui.prep-figma.mjs'
import { buildPacket, verifyPacket } from './crg-ui.prep-packet.mjs'

// Checklist loop order (skills/crg-ui-prep/checklist.md) — the scorecard's row order.
export const ITEM_ORDER = ['1.1', 'E1', 'E2', 'E3', 'E5', '2.1', '2.2', '2.8', '2.5', '2.3', '2.4',
  '1.4', '1.5', '1.2', '2.6', '1.3', '1.6', '1.7', '1.8', '2.9', '1.9', 'E4', '2.7']
export const SETTLED = new Set(['done', 'descoped', 'n/a'])

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
      'usage: crg-ui.prep.mjs audit-repo <repoRoot> [--scope <dir>] --out <repo.json>\n'
      + '     | audit-env [--e2 <pass|gap>] [--e2-evidence <s>] [--e5-dpr <n>] --out <env.json>\n'
      + '     | normalize-figma-audit <frames.json> [--metadata <raw>] [--variables <raw>] [--code-connect <raw>] [--repo <repo.json>] [--prep <prep.json>] --out <figma.json>\n'
      + '     | scorecard <repo.json> [--figma <figma.json>] [--env <env.json>] --prep <prep.json>\n'
      + '     | record <prep.json> --item <id> --status <s> [--evidence <s>] [--reason <s>]\n'
      + '     | verify <itemId> --repo-root <r> [--scope <dir>] [--captures <a,b>] [--frames <f>] [--profile <p>]\n'
      + '     | packet <repoRoot> | verify-packet <repoRoot>\n')
    process.exit(1)
  }
}
