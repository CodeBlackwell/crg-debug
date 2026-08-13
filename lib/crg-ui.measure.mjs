// crg-ui's deterministic tool front door: the ledger layer (assemble + slice) and the
// single CLI every crg-ui phase shells out to. The math itself lives one level down —
// lib/crg-ui.normalize.mjs (raw dumps -> canonical shapes), lib/crg-ui.oracle.mjs (pairing +
// the three comparison layers), lib/crg-ui.seal.mjs (the relay seals).
//
//   node crg-ui.measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>]
//                               [--breakpoint <name>] [--allowlist <path>] [--out <measure.json>]
//   node crg-ui.measure.mjs normalize-vars  <raw.json> --out <variables.json>
//   node crg-ui.measure.mjs normalize-figma <raw.json> --frame <nodeId> --out <slug.figma.json>
//                               [--variables <variables.json>]
//   node crg-ui.measure.mjs normalize-dom   <raw.json> --route <r> --width <w> --height <h>
//                               --out <slug.dom.json>
//   node crg-ui.measure.mjs assemble <capturesDir> --profile <profile.json> --repo-root <path>
//                               --out <ledger.json> [--cells <slug,slug>] [--failed <slug,slug>]
//   node crg-ui.measure.mjs slice    <ledger.json> [--keys <k1,k2,...>] [--ids <slug.d-001,...>]
//
// Each command prints ONE line of JSON. `measure`, `assemble`, and `slice` include a
// `seal` — FNV-1a over the sorted discrepancy keys — so a workflow script can verify
// an agent relayed the output unmangled (the script recomputes the seal from the
// relayed keys; the sandbox has no node:crypto, so the seal is plain JS on purpose).

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { sealOf } from './crg-ui.seal.mjs'
import { normalizeVars, normalizeFigma, normalizeDom } from './crg-ui.normalize.mjs'
import { measure } from './crg-ui.oracle.mjs'

// ---- ledger assembly + slicing ---------------------------------------------------------

// measures: [{slug, out}] where out is a `measure` result. Ids become cell-qualified
// ("<slug>.d-001") so they are unique across the whole ledger.
export const assembleUiLedger = (measures, profile, { repoRoot = '', failed = [] } = {}) => {
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
  crg-ui.measure.mjs measure <figma.json> <dom.json> [--tolerance <px>] [--screen <name>] [--breakpoint <name>] [--allowlist <path>] [--out <measure.json>]
  crg-ui.measure.mjs normalize-vars <raw.json> --out <variables.json>
  crg-ui.measure.mjs normalize-figma <raw.json> --frame <nodeId> --out <figma.json> [--variables <variables.json>]
  crg-ui.measure.mjs normalize-dom <raw.json> --route <r> --width <w> --height <h> --out <dom.json>
  crg-ui.measure.mjs assemble <capturesDir> --profile <profile.json> --repo-root <path> --out <ledger.json> [--cells <slug,slug>] [--failed <slug,slug>]
  crg-ui.measure.mjs slice <ledger.json> [--keys <k1,k2,...>] [--ids <id1,id2,...>]
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
      // --cells names exactly the slugs this run measured. Without it the captures dir is
      // ingested wholesale, so a cell renamed out of the profile — or one that failed this
      // run but left last run's file behind — silently lands stale keys in the ledger, and
      // allKeys is the no-regression baseline a repair run later slices.
      const wanted = new Set(list('cells'))
      const measures = readdirSync(srcPath).filter(f => f.endsWith('.measure.json')).sort()
        .filter(f => !wanted.size || wanted.has(basename(f, '.measure.json')))
        .map(f => ({ slug: basename(f, '.measure.json'), out: readJson(join(srcPath, f)) }))
      if (!measures.length) die(`assemble: no *.measure.json files in ${srcPath}`)
      const ledger = assembleUiLedger(measures, profile, { repoRoot: flag('repo-root') || '', failed: list('failed') })
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
