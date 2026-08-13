// crg-ralph plan/profile validation, and the CLI that drives Army-PRD emission.
//   node crg-ralph.plan.mjs validate <plan.json>            (exit 0 ok / 1 with errors on stderr)
//   node crg-ralph.plan.mjs validate-profile <profile.json> (exit 0 ok / 1 with errors on stderr)
//   node crg-ralph.plan.mjs emit-prd <plan.json> <outDir>   (writes PRD.md + agents/ + progress/)
// Validation lives here; the rendering itself is crg-ralph.prd.mjs (pure, no disk).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { renderPrd } from './crg-ralph.prd.mjs'

const TIERS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['S', 'M', 'L']
const CRITERION_KINDS = ['command', 'browser']

export function validateRalphProfile(p) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(p && typeof p === 'object', 'profile must be an object')
  if (!p || typeof p !== 'object') return { ok: false, errors }
  need(typeof p.project === 'string' && p.project.length > 0, 'project: non-empty string required')
  need(Array.isArray(p.offLimits), 'offLimits: array required (may be empty)')
  for (const [i, o] of (p.offLimits || []).entries()) {
    need(typeof o === 'string' && o.length > 0, `offLimits[${i}]: non-empty path prefix required`)
  }
  if (p.maxTier !== undefined) need(TIERS.includes(p.maxTier), `maxTier: one of ${TIERS.join('|')}`)
  if (p.toolchain !== undefined) {
    need(Array.isArray(p.toolchain), 'toolchain: array when present')
    for (const [i, t] of (Array.isArray(p.toolchain) ? p.toolchain : []).entries()) {
      need(t && typeof t.package === 'string' && t.package, `toolchain[${i}]: {package} required`)
    }
  }
  if (p.runtime !== undefined) {
    need(p.runtime && typeof p.runtime.devUrl === 'string' && /^https?:\/\//.test(p.runtime.devUrl || ''),
      'runtime.devUrl: http(s) url required when runtime is present')
  }
  return { ok: errors.length === 0, errors }
}

export function validatePlan(plan) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(plan && typeof plan === 'object', 'plan must be an object')
  if (!plan || typeof plan !== 'object') return { ok: false, errors }
  need(typeof plan.repoRoot === 'string' && plan.repoRoot.startsWith('/'), 'repoRoot: absolute path required')
  need(typeof plan.feature === 'string' && plan.feature.length > 0, 'feature: non-empty string required')
  need(Array.isArray(plan.stories) && plan.stories.length > 0, 'stories: non-empty array required')
  const ids = new Set()
  for (const [i, s] of (plan.stories || []).entries()) {
    const at = `stories[${i}]`
    need(s && typeof s.id === 'string' && s.id, `${at}.id: required`)
    if (s && s.id) { need(!ids.has(s.id), `${at}.id: duplicate "${s.id}"`); ids.add(s.id) }
    need(s && typeof s.title === 'string' && s.title, `${at}.title: required`)
    need(s && typeof s.story === 'string' && s.story, `${at}.story: required`)
    need(s && EFFORTS.includes(s.effort), `${at}.effort: one of ${EFFORTS.join('|')}`)
    need(s && Array.isArray(s.fence) && s.fence.length > 0, `${at}.fence: non-empty file allowlist required`)
    need(s && Array.isArray(s.acceptanceCriteria) && s.acceptanceCriteria.length > 0, `${at}.acceptanceCriteria: non-empty array required`)
    for (const [j, c] of ((s && s.acceptanceCriteria) || []).entries()) {
      need(c && CRITERION_KINDS.includes(c.kind) && typeof c.check === 'string' && c.check,
        `${at}.acceptanceCriteria[${j}]: {kind: command|browser, check} required`)
    }
  }
  for (const [i, s] of (plan.stories || []).entries()) {
    for (const d of (s && s.dependsOn) || []) {
      need(ids.has(d), `stories[${i}].dependsOn: unknown story id "${d}"`)
    }
  }
  need(Array.isArray(plan.waves) && plan.waves.length > 0, 'waves: non-empty array required')
  const waved = new Set()
  for (const [w, wave] of (plan.waves || []).entries()) {
    need(Array.isArray(wave) && wave.length > 0, `waves[${w}]: non-empty story-id array required`)
    for (const id of Array.isArray(wave) ? wave : []) {
      need(ids.has(id), `waves[${w}]: unknown story id "${id}"`)
      need(!waved.has(id), `waves[${w}]: story "${id}" appears in two waves`)
      waved.add(id)
    }
  }
  return { ok: errors.length === 0, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg, outDir] = process.argv.slice(2)
  if (cmd === 'validate' || cmd === 'validate-profile') {
    const res = (cmd === 'validate' ? validatePlan : validateRalphProfile)(JSON.parse(readFileSync(arg, 'utf8')))
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    process.stdout.write('ok\n')
  } else if (cmd === 'emit-prd') {
    const plan = JSON.parse(readFileSync(arg, 'utf8'))
    const res = validatePlan(plan)
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    const files = renderPrd(plan)
    for (const [rel, contents] of Object.entries(files)) {
      mkdirSync(dirname(join(outDir, rel)), { recursive: true })
      writeFileSync(join(outDir, rel), contents)
    }
    process.stdout.write(Object.keys(files).sort().join('\n') + '\n')
  } else {
    process.stderr.write('usage: crg-ralph.plan.mjs validate <plan.json> | validate-profile <profile.json> | emit-prd <plan.json> <outDir>\n')
    process.exit(1)
  }
}
