// crg-ralph's Army-PRD rendering layer — import-only, no CLI (crg-ralph.plan.mjs owns the
// `emit-prd` subcommand and does the writing). The emitted dir is STANDARD Army format,
// runnable by the `ralph` CLI with zero knowledge of CRG. renderPrd is a pure function
// of the plan — {relativePath: contents} — so tests assert on strings, not on disk.

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

const fenceList = ss => [...new Set(ss.flatMap(s => s.fence))].sort()
const criteria = c => `- [ ] ${c.desc || c.check}`
const offLimitsOf = plan => plan.offLimits || []

// The PRD.md document: roster, wave plan, orchestrator config, domains, non-goals.
function renderPrdDoc(plan, agents) {
  const roster = agents.map(a =>
    `| ${a.name} | ${a.wave} | ${a.stories.map(s => s.id).join(', ')} | ${fenceList(a.stories).map(f => `\`${f}\``).join(', ')} |`)
  const wavePlan = plan.waves.map((_, w) => {
    const names = agents.filter(a => a.wave === w).map(a => a.name)
    return `Wave ${w}: ${names.join(' ║ ')}`
  })
  const waveConfig = plan.waves.map((_, w) =>
    `WAVE_${w}_AGENTS=(${agents.filter(a => a.wave === w).map(a => `"${a.name}"`).join(' ')})`)
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
  const offLimits = offLimitsOf(plan)
  return [
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
}

// One agent's spec: identity, mission, the write fence, and its stories.
function renderAgentSpec(plan, a) {
  const offLimits = offLimitsOf(plan)
  return [
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
}

// One agent's progress file: the Army loop's own checkbox + learnings scratchpad.
function renderProgress(a) {
  return [
    `# Progress — ${a.name}-agent`,
    '',
    ...a.stories.map(s => `[ ] ${s.id}: ${s.title}`),
    '',
    '## Learnings',
    '',
  ].join('\n')
}

// Pure: plan -> {relativePath: contents}. The CLI writes; tests assert on strings.
export function renderPrd(plan) {
  const agents = agentsOf(plan)
  const files = { 'PRD.md': renderPrdDoc(plan, agents) }
  for (const a of agents) {
    files[`agents/${a.name}-agent.md`] = renderAgentSpec(plan, a)
    files[`progress/progress-${a.name}.txt`] = renderProgress(a)
  }
  return files
}
