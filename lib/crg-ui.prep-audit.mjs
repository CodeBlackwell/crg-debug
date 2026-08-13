// The repo and environment halves of crg-ui-prep's audit: what the checklist can
// learn by reading files in scope and probing the toolchain. Every status here is
// computed from a count, a grep, or an exit code; anything needing judgment comes
// back `unknown` with raw evidence for the gate.
// No CLI of its own — lib/crg-ui.prep.mjs dispatches audit-repo and audit-env.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { execFileSync } from 'node:child_process'
import { itemsSeal } from './crg-ui.seal.mjs'

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

// ---- repo audit -------------------------------------------------------------------

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

// ---- scope gathering ----------------------------------------------------------------

// scope: comma-separated dirs/files relative to repoRoot (a profile fences.allow glob
// like "frontend/src/public/**" is accepted — the glob tail is stripped).
export const gatherRepo = (repoRoot, scope) => {
  const readJson = p => JSON.parse(readFileSync(p, 'utf8'))
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
