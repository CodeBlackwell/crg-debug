import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePlan, validateProfile, renderPrd } from '../lib/ralph-plan.mjs'

// A minimal plan shaped like the FOREX dogfood: directory fences, declared lanes,
// two waves with the foundation story alone in wave 0.
const plan = () => ({
  repoRoot: '/repo',
  feature: 'FOREX Phase 1',
  stories: [
    {
      id: 'US-001', title: 'asset taxonomy', story: 'As a service, I want asset classes.',
      lane: 'foundation', effort: 'S',
      fence: ['shared/src/trader_shared/', 'shared/tests/test_assets.py'],
      dependsOn: [],
      checklist: ['AssetClass enum with crypto/forex'],
      acceptanceCriteria: [{ desc: 'unit test green', kind: 'command', check: 'pytest shared/tests/test_assets.py' }],
    },
    {
      id: 'US-010', title: 'oanda connector', story: 'As the pipeline, I want OANDA candles.',
      lane: 'dp-connector', effort: 'M',
      fence: ['services/data-pipeline/src/data_pipeline/connectors/'],
      dependsOn: ['US-001'],
      checklist: ['get_candles returns OHLCV'],
      acceptanceCriteria: [{ desc: 'connector test green', kind: 'command', check: 'pytest services/data-pipeline/tests/test_oanda.py' }],
    },
  ],
  waves: [['US-001'], ['US-010']],
  offLimits: ['scripts/autonomous_engine/'],
})

// ---- validatePlan ---------------------------------------------------------------

test('validatePlan accepts a well-formed plan', () => {
  assert.deepEqual(validatePlan(plan()), { ok: true, errors: [] })
})

test('validatePlan rejects missing fences, bad criteria, unknown deps, and double-waved stories', () => {
  const noFence = plan(); noFence.stories[0].fence = []
  assert.ok(validatePlan(noFence).errors.some(e => e.includes('fence')))
  const badCrit = plan(); badCrit.stories[0].acceptanceCriteria = [{ kind: 'magic', check: 'x' }]
  assert.ok(validatePlan(badCrit).errors.some(e => e.includes('acceptanceCriteria')))
  const ghostDep = plan(); ghostDep.stories[1].dependsOn = ['US-999']
  assert.ok(validatePlan(ghostDep).errors.some(e => e.includes('unknown story id')))
  const doubled = plan(); doubled.waves = [['US-001'], ['US-001', 'US-010']]
  assert.ok(validatePlan(doubled).errors.some(e => e.includes('two waves')))
  const dupId = plan(); dupId.stories[1].id = 'US-001'
  assert.ok(validatePlan(dupId).errors.some(e => e.includes('duplicate')))
})

// ---- validateProfile ------------------------------------------------------------

test('validateProfile: minimal valid profile, and each failure mode', () => {
  assert.equal(validateProfile({ project: 'spice', offLimits: [] }).ok, true)
  assert.equal(validateProfile({ project: '', offLimits: [] }).ok, false)
  assert.equal(validateProfile({ project: 'x' }).ok, false, 'offLimits required (may be empty)')
  assert.equal(validateProfile({ project: 'x', offLimits: [], maxTier: 'gpt4' }).ok, false)
  assert.equal(validateProfile({ project: 'x', offLimits: [], runtime: { devUrl: 'not-a-url' } }).ok, false)
  assert.equal(validateProfile({ project: 'x', offLimits: [], runtime: { devUrl: 'http://localhost:3000' }, maxTier: 'sonnet', toolchain: [{ package: 'root' }] }).ok, true)
})

// ---- renderPrd ------------------------------------------------------------------

test('renderPrd emits standard Army files: PRD.md + one agent + progress file per wave×lane', () => {
  const files = renderPrd(plan())
  assert.deepEqual(Object.keys(files).sort(), [
    'PRD.md',
    'agents/dp-connector-w1-agent.md',
    'agents/foundation-w0-agent.md',
    'progress/progress-dp-connector-w1.txt',
    'progress/progress-foundation-w0.txt',
  ])
})

test('renderPrd PRD.md carries roster, wave config, stories, and off-limits non-goals', () => {
  const prd = renderPrd(plan())['PRD.md']
  assert.ok(prd.includes('# PRD: FOREX Phase 1'))
  assert.ok(prd.includes('| foundation-w0 | 0 | US-001 |'))
  assert.ok(prd.includes('WAVE_0_AGENTS=("foundation-w0")'))
  assert.ok(prd.includes('WAVE_1_AGENTS=("dp-connector-w1")'))
  assert.ok(prd.includes('#### US-010: oanda connector'))
  assert.ok(prd.includes('- [ ] unit test green'))
  assert.ok(prd.includes('`scripts/autonomous_engine/` is off-limits'))
})

test('renderPrd agent spec lists owned paths (fences) and DO NOT MODIFY', () => {
  const spec = renderPrd(plan())['agents/foundation-w0-agent.md']
  assert.ok(spec.includes('- **Wave**: 0'))
  assert.ok(spec.includes('- `shared/src/trader_shared/`'))
  assert.ok(spec.includes('- `scripts/autonomous_engine/`'))
  assert.ok(spec.includes('- Any path not listed under Owned Paths'))
  assert.ok(spec.includes('### US-001: asset taxonomy'))
})

test('renderPrd is a pure function of the plan', () => {
  assert.deepEqual(renderPrd(plan()), renderPrd(plan()))
})
