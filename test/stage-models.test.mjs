// Protects the stageModels arg: each phase's agents run on that phase's model, a phase the
// map leaves out runs on the run's model, a map the script cannot read is refused before any
// agent starts, and the ledger and the return record the model of every phase.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { STAGE_KEYS, stageModelsOf, stageModelNames, stageModelsNote }`)()
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const every = model => ({ graph: model, map: model, discover: model, verify: model, fix: model })

// ---- the helper ------------------------------------------------------------------

test('with no map every phase runs on the run model, haiku by default', () => {
  assert.deepEqual(H.STAGE_KEYS, ['graph', 'map', 'discover', 'verify', 'fix'])
  assert.deepEqual(H.stageModelsOf(undefined, undefined), every('haiku'))
  assert.deepEqual(H.stageModelsOf(null, undefined), every('haiku'))
  assert.deepEqual(H.stageModelsOf({}, 'opus'), every('opus'))
  assert.deepEqual(H.stageModelsOf(undefined, 'session'), every(undefined))
  assert.deepEqual(H.stageModelsOf(undefined, null), every(undefined))
})

test('a phase the map names runs on its model and the others on the run model', () => {
  assert.deepEqual(H.stageModelsOf({ discover: 'haiku', verify: 'sonnet' }, 'opus'), { ...every('opus'), discover: 'haiku', verify: 'sonnet' })
  assert.deepEqual(H.stageModelsOf({ fix: 'opus' }, undefined), { ...every('haiku'), fix: 'opus' })
})

test("null or 'session' makes one phase inherit the session model", () => {
  assert.deepEqual(H.stageModelsOf({ verify: null, fix: 'session' }, 'haiku'), { ...every('haiku'), verify: undefined, fix: undefined })
  assert.deepEqual(H.stageModelsOf({ discover: 'haiku' }, 'session'), { ...every(undefined), discover: 'haiku' })
})

test('an unknown phase is refused by name, with the five that exist', () => {
  for (const key of ['Verify', 'verfy', 'review', 'model', '']) {
    assert.throws(() => H.stageModelsOf({ [key]: 'sonnet' }, 'haiku'), err =>
      err.message.includes(`Unknown stageModels key ${JSON.stringify(key)}`) && err.message.includes('graph, map, discover, verify, fix'))
  }
})

test('a value that is neither a model name nor null is refused, naming its phase', () => {
  for (const value of ['', '   ', 5, true, false, {}, ['sonnet'], undefined]) {
    assert.throws(() => H.stageModelsOf({ verify: value }, 'haiku'), /Unusable stageModels\.verify /, `accepted ${JSON.stringify(value)}`)
  }
})

test('a map that is not an object is refused', () => {
  for (const map of ['sonnet', '{"verify":"sonnet"}', 5, true, ['verify', 'sonnet']]) {
    assert.throws(() => H.stageModelsOf(map, 'haiku'), /Unusable stageModels .* it must be an object keyed by phase: graph, map, discover, verify, fix/, `accepted ${JSON.stringify(map)}`)
  }
})

test("the record names every phase's model, 'session' where it inherits", () => {
  assert.deepEqual(H.stageModelNames(every('haiku')), every('haiku'))
  assert.deepEqual(H.stageModelNames({ ...every('haiku'), verify: 'sonnet', fix: undefined }), { ...every('haiku'), verify: 'sonnet', fix: 'session' })
})

test('the log note is empty unless a phase differs from the run model', () => {
  assert.equal(H.stageModelsNote(every('haiku'), 'haiku'), '')
  assert.equal(H.stageModelsNote(every(undefined), undefined), '')
  assert.equal(H.stageModelsNote({ ...every('haiku'), verify: 'sonnet' }, 'haiku'), ' · stage models: graph haiku, map haiku, discover haiku, verify sonnet, fix haiku')
  assert.equal(H.stageModelsNote({ ...every('haiku'), fix: undefined }, 'haiku'), ' · stage models: graph haiku, map haiku, discover haiku, verify haiku, fix session')
})

// ---- every agent call, read from the script ---------------------------------------
// Counted by the call, not by an `await` in front of it: most calls here are the body of
// an arrow (`const reviewer = (...) => tryAgent(`), which a probe for `await` never sees.

const CODE = SRC.slice(SRC.indexOf('// <<< pure-helpers')).split('\n').filter(line => !/^\s*\/\//.test(line))
// The two retries that go off the model that produced the first failure, on purpose.
const SESSION_RETRIES = ["'setup-retry'", "'map-retry'"]

test('every agent call takes the model of the phase it names', () => {
  const calls = CODE.join('\n').match(/\btryAgent\(/g).length
  assert.equal(CODE.join('\n').match(/\bagent\(/g).length, 1, 'the only bare agent() call is the one inside tryAgent')
  const options = CODE.filter(line => /\bphase: '/.test(line))
  assert.equal(options.length, calls, 'every tryAgent call carries one options line that names its phase')
  for (const line of options) {
    const found = /\bphase: '(\w+)'(?:, schema: [\w()]+)?, model: (\S+) \}/.exec(line)
    assert.ok(found, `phase and model must sit together on the options line: ${line.trim()}`)
    const [, phase, model] = found
    assert.ok(H.STAGE_KEYS.includes(phase.toLowerCase()), `${phase} has no stageModels key`)
    const isRetry = SESSION_RETRIES.some(label => line.includes(`label: ${label},`))
    assert.equal(model, isRetry ? 'undefined' : `models.${phase.toLowerCase()}`, line.trim())
  }
  for (const label of SESSION_RETRIES) assert.equal(options.filter(line => line.includes(`label: ${label},`)).length, 1, `${label} is still in the script`)
})

// ---- stubbed runs -----------------------------------------------------------------

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const run = new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC.replace(/^export\s+const\s+meta/m, 'const meta'))
const FINDING = { file: 'src/a.py:7', concern: 'security', symptom: 's', rootCause: 'r', severity: 'High', whyRepro: 'in -> out', confidence: 'high' }
// A read-only sweep: one mapped file, one finding per finder, both reviewers confirm.
// `dead` names labels whose agent returns nothing.
const sweep = async (args, dead = []) => {
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, phase: opts.phase, model: opts.model, prompt })
    if (dead.includes(opts.label)) return null
    if (/^setup/.test(opts.label)) return { graphStats: '1 file', resolvedScope: 'full repo', toolchain: [], baselineFailures: [] }
    if (/^map/.test(opts.label)) return { overview: 'o', targets: [{ file: 'src/a.py', concern: 'security', functions: ['check'] }] }
    if (opts.label.startsWith('find:')) return { audited: [], findings: [{ ...FINDING, rootCause: opts.label }] }
    if (opts.label === 'dedup') return { duplicateGroups: [] }
    if (opts.phase === 'Verify' && opts.schema) return { confirmed: true, reason: 'traced it', classification: 'real-bug' }
    return 'written'
  }
  const result = await run({ repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md', ...args }, agent, thunks => Promise.all(thunks.map(t => t())), m => logs.push(m), undefined, () => {})
  return { calls, logs, result }
}
const assertByPhase = (calls, want) => {
  for (const call of calls) assert.equal(call.model, want[call.phase.toLowerCase()], `${call.label} ran in ${call.phase}`)
}
const ledgerOf = calls => JSON.parse(calls.find(c => c.label === 'persist').prompt.split('\n\n').slice(1).join('\n\n'))
const phasesOf = calls => [...new Set(calls.map(c => c.phase))]

test('with no stageModels every agent runs on haiku and nothing is said about stages', async () => {
  const { calls, logs, result } = await sweep({})
  assert.deepEqual(phasesOf(calls), ['Graph', 'Map', 'Discover', 'Verify'])
  assertByPhase(calls, every('haiku'))
  assert.deepEqual(result.models, every('haiku'))
  assert.equal(ledgerOf(calls).model, 'haiku')
  assert.deepEqual(ledgerOf(calls).models, every('haiku'))
  assert.ok(!logs.some(line => line.includes('stage models')))
})

test('--model alone still moves every phase', async () => {
  const named = await sweep({ model: 'opus' })
  assertByPhase(named.calls, every('opus'))
  assert.deepEqual(named.result.models, every('opus'))
  const inherited = await sweep({ model: 'session' })
  assertByPhase(inherited.calls, every(undefined))
  assert.deepEqual(inherited.result.models, every('session'))
  assert.ok(!inherited.logs.some(line => line.includes('stage models')))
})

test('a haiku finder and a sonnet verify: each phase runs on its own model', async () => {
  const { calls, logs, result } = await sweep({ model: 'opus', stageModels: { discover: 'haiku', verify: 'sonnet' } })
  const want = { ...every('opus'), discover: 'haiku', verify: 'sonnet' }
  assertByPhase(calls, want)
  assert.ok(calls.some(c => c.label.startsWith('find:')) && calls.some(c => c.label === 'dedup'), 'the finders and the merge both ran')
  assert.deepEqual(calls.filter(c => c.phase === 'Verify').map(c => c.label), ['refute:a.py', 'confirm:a.py', 'refute:a.py', 'confirm:a.py', 'persist'])
  assert.deepEqual(result.models, want)
  assert.deepEqual(ledgerOf(calls).models, want)
  assert.equal(ledgerOf(calls).model, 'opus', 'the run model is still recorded beside them')
  assert.match(logs[0], / · model: opus · stage models: graph opus, map opus, discover haiku, verify sonnet, fix opus/)
})

test("a phase set to null or 'session' inherits while the others keep the run model", async () => {
  const { calls, result } = await sweep({ stageModels: { verify: null, map: 'session' } })
  assertByPhase(calls, { ...every('haiku'), verify: undefined, map: undefined })
  assert.deepEqual(result.models, { ...every('haiku'), verify: 'session', map: 'session' })
})

test('the setup and map retries still go to the session model, whatever their phase is set to', async () => {
  const { calls } = await sweep({ stageModels: { graph: 'opus', map: 'sonnet' } }, ['setup', 'map'])
  const modelOf = label => calls.find(c => c.label === label).model
  assert.equal(modelOf('setup'), 'opus')
  assert.equal(modelOf('map'), 'sonnet')
  assert.equal(modelOf('setup-retry'), undefined)
  assert.equal(modelOf('map-retry'), undefined)
})

test('a map the script cannot read stops the run before any agent starts', async () => {
  const refused = async (stageModels, message) => {
    const calls = []
    await assert.rejects(run({ repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md', fix: true, stageModels }, async (_p, opts) => calls.push(opts), t => t, () => {}, undefined, () => {}), message)
    assert.deepEqual(calls, [])
  }
  await refused({ verfy: 'sonnet' }, /Unknown stageModels key "verfy" — the phases are: graph, map, discover, verify, fix/)
  await refused({ verify: '' }, /Unusable stageModels\.verify ""/)
  await refused('sonnet', /Unusable stageModels "sonnet"/)
})

test('a fix-from-ledger run reads the ledger on the graph model and fixes on the fix model', async () => {
  const { calls, logs, result } = await fixRun(SRC, { bugs: [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')], args: { stageModels: { graph: 'opus', fix: 'sonnet' } } })
  const flat = calls.map(c => ({ label: c.label, phase: c.opts.phase, model: c.opts.model }))
  assert.deepEqual(phasesOf(flat), ['Graph', 'Fix'])
  assertByPhase(flat, { ...every('haiku'), graph: 'opus', fix: 'sonnet' })
  assert.deepEqual(flat.filter(c => c.phase === 'Graph').map(c => c.label), ['tree-status', 'ingest-ledger'])
  assert.ok(flat.filter(c => c.phase === 'Fix').length > 8, 'the fixers, gates, commits and checks all ran')
  assert.deepEqual(result.models, { ...every('haiku'), graph: 'opus', fix: 'sonnet' })
  assert.match(logs.find(line => line.includes('fix-from-ledger')), / · model: haiku · stage models: graph opus, map haiku, discover haiku, verify haiku, fix sonnet$/)
})

test('a Verify replay over supplied findings reviews on the verify model', async () => {
  const { calls, result } = await sweep({ fromFindings: [FINDING], stageModels: { verify: 'sonnet' } })
  assert.deepEqual(calls.map(c => `${c.label} ${c.model}`), ['setup haiku', 'refute:a.py sonnet', 'confirm:a.py sonnet', 'persist sonnet'])
  assert.equal(result.mode, 'verify-from-findings')
  assert.deepEqual(result.models, { ...every('haiku'), verify: 'sonnet' })
})
