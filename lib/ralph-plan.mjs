// crg-ralph plan/profile validation + deterministic Army-PRD emission, in real code.
//   node ralph-plan.mjs validate <plan.json>            (exit 0 ok / 1 with errors on stderr)
//   node ralph-plan.mjs validate-profile <profile.json> (exit 0 ok / 1 with errors on stderr)
//   node ralph-plan.mjs emit-prd <plan.json> <outDir>   (writes PRD.md + agents/ + progress/)
// The emitted PRD dir is STANDARD Army format — runnable by the `ralph` CLI with zero
// knowledge of CRG. renderPrd is a pure function of the plan for testability.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

const TIERS = ['haiku', 'sonnet', 'opus']
const EFFORTS = ['S', 'M', 'L']
const CRITERION_KINDS = ['command', 'browser']

export function validateProfile(p) {
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

const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'misc'
const storyById = plan => new Map(plan.stories.map(s => [s.id, s]))

// Wave × lane → one Army agent. Deterministic name, ≤4 stories per the Army
// context-budget rule (the packer already caps stories per wave).
const agentsOf = plan => {
  const byId = storyById(plan)
  const agents = []
  for (const [w, wave] of plan.waves.entries()) {
    const byLane = new Map()
    for (const id of wave) {
      const s = byId.get(id)
      const lane = slug(s.lane)
      if (!byLane.has(lane)) byLane.set(lane, [])
      byLane.get(lane).push(s)
    }
    for (const [lane, stories] of [...byLane.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      agents.push({ name: `${lane}-w${w}`, wave: w, lane, stories })
    }
  }
  return agents
}

// Pure: plan -> {relativePath: contents}. The CLI writes; tests assert on strings.
export function renderPrd(plan) {
  const agents = agentsOf(plan)
  const fenceList = ss => [...new Set(ss.flatMap(s => s.fence))].sort()
  const roster = agents.map(a =>
    `| ${a.name} | ${a.wave} | ${a.stories.map(s => s.id).join(', ')} | ${fenceList(a.stories).map(f => `\`${f}\``).join(', ')} |`)
  const wavePlan = plan.waves.map((_, w) => {
    const names = agents.filter(a => a.wave === w).map(a => a.name)
    return `Wave ${w}: ${names.join(' ║ ')}`
  })
  const waveConfig = plan.waves.map((_, w) =>
    `WAVE_${w}_AGENTS=(${agents.filter(a => a.wave === w).map(a => `"${a.name}"`).join(' ')})`)
  const criteria = c => `- [ ] ${c.desc || c.check}`
  const domains = agents.map(a => [
    `### Domain: ${a.lane} (Wave ${a.wave})`,
    `**Owner:** ${a.name}-agent`,
    '',
    ...a.stories.flatMap(s => [
      `#### ${s.id}: ${s.title}`,
      `**Description:** ${s.story}`,
      s.dependsOn && s.dependsOn.length ? `**Depends on:** ${s.dependsOn.join(', ')}` : '',
      '**Acceptance Criteria:**',
      ...s.acceptanceCriteria.map(criteria),
      '',
    ].filter(Boolean)),
  ].join('\n'))
  const offLimits = plan.offLimits || []
  const files = {}
  files['PRD.md'] = [
    `# PRD: ${plan.feature}`,
    '',
    '## Introduction',
    `${plan.feature} — planned by crg-ralph: stories, waves, and file ownership are computed from the repo's code-review-graph (fences are explicit file allowlists, not guesses).`,
    '',
    '## Agent Roster',
    '',
    '| Agent | Wave | Stories | Owned Paths |',
    '|-------|------|---------|-------------|',
    ...roster,
    '',
    '## Wave Plan',
    '',
    '```',
    ...wavePlan,
    '```',
    '',
    '## Orchestrator Config',
    '',
    '```bash',
    ...waveConfig,
    '```',
    '',
    '## Feature Domains',
    '',
    ...domains,
    '## Non-Goals',
    ...(offLimits.length ? offLimits.map(o => `- \`${o}\` is off-limits — never modified by any agent`) : ['- (none declared)']),
    ...(plan.deferredByCap || []).map(id => `- ${id} deferred by wave cap — replan to include it`),
    '',
  ].join('\n')
  for (const a of agents) {
    files[`agents/${a.name}-agent.md`] = [
      `# ${a.name} Agent Specification`,
      '',
      '## Identity',
      `- **Name**: ${a.name}-agent`,
      `- **Wave**: ${a.wave}`,
      `- **Stories**: ${a.stories.map(s => s.id).join(', ')}`,
      '',
      '## Mission',
      `Build the ${a.lane} stories of "${plan.feature}" inside the owned paths only.`,
      '',
      '## Owned Paths (WRITE access)',
      ...fenceList(a.stories).map(f => `- \`${f}\``),
      '',
      '## DO NOT MODIFY',
      ...(offLimits.length ? offLimits.map(o => `- \`${o}\``) : []),
      '- Any path not listed under Owned Paths',
      '',
      '## Stories',
      '',
      ...a.stories.flatMap(s => [
        `### ${s.id}: ${s.title}`,
        `${s.story}`,
        '**Acceptance Criteria:**',
        ...s.acceptanceCriteria.map(criteria),
        '',
      ]),
    ].join('\n')
    files[`progress/progress-${a.name}.txt`] = [
      `# Progress — ${a.name}-agent`,
      '',
      ...a.stories.map(s => `[ ] ${s.id}: ${s.title}`),
      '',
      '## Learnings',
      '',
    ].join('\n')
  }
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg, outDir] = process.argv.slice(2)
  if (cmd === 'validate' || cmd === 'validate-profile') {
    const res = (cmd === 'validate' ? validatePlan : validateProfile)(JSON.parse(readFileSync(arg, 'utf8')))
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
    process.stderr.write('usage: ralph-plan.mjs validate <plan.json> | validate-profile <profile.json> | emit-prd <plan.json> <outDir>\n')
    process.exit(1)
  }
}
