// Protects what happens to a finding one reviewer confirmed and the other called
// "intentional": it is kept, carries the objection as `dissent`, and is fixed like any other
// confirmed bug — while a finding one reviewer plainly refused is still held, and the fixer is
// told exactly what it was told before.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { bucketVerdicts, verifyLine }`)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const FINDING = { file: 'src/a.ts:12', concern: 'security', symptom: 's', rootCause: 'r', severity: 'High', whyRepro: 'w' }
const yes = { confirmed: true, classification: 'real-bug', reason: 'reproduced' }
const no = { confirmed: false, classification: 'real-bug', reason: 'guard upstream' }
const byDesign = { confirmed: false, classification: 'intentional', reason: 'documented fallback' }
const both = { confirmed: true, classification: 'intentional', reason: 'reproduces, by design' }
const row = (refute, confirm, over) => ({ f: { ...FINDING, ...over }, refute, confirm })
const bucket = (refute, confirm) => H.bucketVerdicts([row(refute, confirm)])

// ---- the survivor rule ----------------------------------------------------------------

test('a confirm beside an "intentional" keeps the finding, with the objection as dissent', () => {
  const kept = [{ ...FINDING, dissent: 'documented fallback' }]
  assert.deepEqual(bucket(byDesign, yes), { confirmedBugs: kept, deferred: [], rejected: [] })
  assert.deepEqual(bucket(yes, byDesign), { confirmedBugs: kept, deferred: [], rejected: [] }, 'whichever stance each reviewer held')
  assert.equal('conflicted' in bucket(byDesign, yes).confirmedBugs[0], false, 'Fix holds conflicted rows, and this one has to be fixed')
  assert.equal('conflictNote' in bucket(byDesign, yes).confirmedBugs[0], false)
})

test('the kept finding takes the confirming reviewer’s severity, never the dissenter’s', () => {
  assert.equal(bucket(byDesign, { ...yes, adjustedSeverity: 'Low' }).confirmedBugs[0].severity, 'Low')
  assert.equal(bucket({ ...byDesign, adjustedSeverity: 'Low' }, yes).confirmedBugs[0].severity, 'High')
})

test('"intentional" with no confirm beside it still defers', () => {
  const deferred = [{ ...FINDING, deferReason: 'documented fallback' }]
  assert.deepEqual(bucket(byDesign, no), { confirmedBugs: [], deferred, rejected: [] })
  assert.deepEqual(bucket(no, byDesign), { confirmedBugs: [], deferred, rejected: [] })
  assert.deepEqual(bucket(byDesign, { ...byDesign, reason: 'named for it' }), { confirmedBugs: [], deferred, rejected: [] }, 'the first reviewer’s reason is the one kept, as before')
  assert.deepEqual(bucket(null, byDesign), { confirmedBugs: [], deferred, rejected: [] }, 'a dead reviewer confirms nothing')
})

test('a confirm beside a plain refusal is still held as conflicted, with no dissent', () => {
  const held = [{ ...FINDING, conflicted: true, conflictNote: 'guard upstream' }]
  assert.deepEqual(bucket(no, yes), { confirmedBugs: held, deferred: [], rejected: [] })
  assert.deepEqual(bucket(yes, no), { confirmedBugs: held, deferred: [], rejected: [] })
})

test('agreement, refusal and silence bucket as they did', () => {
  assert.deepEqual(bucket(yes, yes), { confirmedBugs: [FINDING], deferred: [], rejected: [] })
  assert.deepEqual(bucket(null, yes), { confirmedBugs: [FINDING], deferred: [], rejected: [] })
  assert.deepEqual(bucket(no, { ...no, reason: 'unreachable' }).rejected, [{ ...FINDING, refutationReason: 'guard upstream | unreachable' }])
  assert.deepEqual(bucket(null, null).rejected, [{ ...FINDING, refutationReason: 'both reviewers failed to return a verdict' }])
})

// The schema lets one reviewer say both. That reviewer speaks as "intentional": it can be
// outranked by a real confirm, and it can never be the confirm that outranks.
test('a verdict that is both confirmed and "intentional" does not confirm', () => {
  const deferred = [{ ...FINDING, deferReason: 'reproduces, by design' }]
  assert.deepEqual(bucket(both, both), { confirmedBugs: [], deferred, rejected: [] })
  assert.deepEqual(bucket(null, both), { confirmedBugs: [], deferred, rejected: [] })
  assert.deepEqual(bucket(no, both), { confirmedBugs: [], deferred, rejected: [] }, 'it is not a confirm, so there is no conflict to hold either')
  assert.deepEqual(bucket(both, byDesign).deferred, deferred)
  assert.deepEqual(bucket(both, yes).confirmedBugs, [{ ...FINDING, dissent: 'reproduces, by design' }], 'against a real confirm it is the dissent')
  assert.deepEqual(bucket({ ...both, adjustedSeverity: 'Low' }, yes).confirmedBugs[0].severity, 'High', 'and its severity is not a confirming reviewer’s')
})

test('dissent rows sort with the other confirmed bugs, by severity', () => {
  const out = H.bucketVerdicts([
    row(yes, yes, { file: 'low.ts', severity: 'Low' }),
    row(byDesign, { ...yes, adjustedSeverity: 'Critical' }, { file: 'raised.ts', severity: 'Low' }),
    row(no, yes, { file: 'held.ts', severity: 'High' }),
  ])
  assert.deepEqual(out.confirmedBugs.map(b => b.file), ['raised.ts', 'held.ts', 'low.ts'])
})

// ---- what Verify says ----------------------------------------------------------------

test('the Verify line counts the findings kept over a dissent, and reads as before with none', () => {
  const bugs = n => Array.from({ length: n }, () => FINDING)
  assert.equal(
    H.verifyLine({ confirmedBugs: [...bugs(8), ...bugs(4).map(b => ({ ...b, dissent: 'x' }))], deferred: bugs(9), rejected: bugs(1) }),
    'Verify: 12 confirmed (4 over an "intentional" dissent) · 9 deferred (intentional) · 1 rejected',
  )
  assert.equal(H.verifyLine({ confirmedBugs: bugs(2), deferred: [], rejected: bugs(3) }), 'Verify: 2 confirmed · 0 deferred (intentional) · 3 rejected')
  assert.equal(
    H.verifyLine({ confirmedBugs: [{ ...FINDING, conflicted: true, conflictNote: 'n' }, { ...FINDING, dissent: '' }], deferred: [], rejected: [] }),
    'Verify: 2 confirmed (1 over an "intentional" dissent) · 0 deferred (intentional) · 0 rejected',
    'a dissent with an empty reason is still a dissent; a conflicted row is not one',
  )
})

// ---- a Verify run: the log, the result, the ledger on disk -----------------------------

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const FINDINGS = [
  { file: 'src/alpha-widget.ts:10', concern: 'backend-logic', symptom: 's1', rootCause: 'off-by-one bound', severity: 'Low', whyRepro: 'w1', confidence: 'high' },
  { file: 'src/beta-cache.ts:4', concern: 'security', symptom: 's2', rootCause: 'stale read', severity: 'High', whyRepro: 'w2', confidence: 'low' },
]
const replay = async verdictFor => {
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push({ label, prompt })
    if (label === 'setup') return { graphStats: '12 files', toolchain: [{ package: 'app', test: 'npm test' }], baselineFailures: [] }
    if (opts.phase === 'Verify' && opts.schema) return verdictFor(label)
    return 'written'
  }
  const result = await new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC.replace(/^export\s+const\s+meta/m, 'const meta'))(
    { repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md', fromFindings: FINDINGS },
    agent, thunks => Promise.all(thunks.map(t => t())), m => logs.push(m), undefined, () => {},
  )
  return { result, logs, persisted: JSON.parse(calls.find(c => c.label === 'persist').prompt.split('\n\n').slice(1).join('\n\n')) }
}

test('a Verify run reports the dissent in its log line, its result and the ledger it writes', async () => {
  const { result, logs, persisted } = await replay(label =>
    label === 'refute:alpha-widget.ts' ? { confirmed: false, classification: 'intentional', reason: 'documented fallback' } : { confirmed: true, classification: 'real-bug', reason: 'reproduced' })
  const kept = [FINDINGS[1], { ...FINDINGS[0], dissent: 'documented fallback' }]
  assert.ok(logs.includes('Verify: 2 confirmed (1 over an "intentional" dissent) · 0 deferred (intentional) · 0 rejected'), logs.join('\n'))
  assert.deepEqual(result.confirmedBugs, kept)
  assert.deepEqual(result.deferred, [])
  assert.deepEqual(persisted.confirmedBugs, kept)
})

test('a Verify run with no dissent logs the line it always logged', async () => {
  const { logs } = await replay(() => ({ confirmed: true, classification: 'real-bug', reason: 'reproduced' }))
  assert.ok(logs.includes('Verify: 2 confirmed · 0 deferred (intentional) · 0 rejected'), logs.join('\n'))
})

// ---- the fix queue, from a ledger -------------------------------------------------------

const TWO = () => [bug('b1', 'src/alpha.py'), bug('b2', 'src/bravo.py')]
const withB1 = extra => TWO().map(b => (b.bugId === 'b1' ? { ...b, ...extra } : b))

test('a ledger row with a dissent is ingested untouched and fixed', async () => {
  const { result, labels } = await fixRun(SRC, { bugs: withB1({ dissent: 'documented fallback' }) })
  assert.ok(labels.includes('fix:alpha.py'), labels.join(' '))
  assert.deepEqual(result.confirmedBugs.map(b => b.dissent), ['documented fallback', undefined])
  assert.deepEqual(result.fix.fixed.map(b => [b.bugId, b.dissent]), [['b1', 'documented fallback'], ['b2', undefined]])
  assert.deepEqual(result.fix.unfixed, [])
})

test('a conflicted ledger row is still held out of the fix queue', async () => {
  const { result, labels, logs } = await fixRun(SRC, { bugs: withB1({ conflicted: true, conflictNote: 'guard upstream' }) })
  assert.equal(labels.some(l => l.endsWith(':alpha.py')), false, labels.join(' '))
  assert.ok(labels.includes('fix:bravo.py'))
  assert.ok(logs.includes('Fix: holding 1 conflicted finding(s) unfixed (mixed verdicts)'), logs.join('\n'))
  assert.deepEqual(result.fix.fixed.map(b => b.bugId), ['b2'])
})

// One thing changes per variant: the dissent is in the result and the ledger, and no agent
// in the Fix phase is told about it.
test('every Fix agent is asked the same thing whether or not a row carries a dissent', async () => {
  const asked = run => run.calls.map(c => ({ label: c.label, prompt: c.prompt, opts: c.opts }))
  const plain = await fixRun(SRC, { bugs: TWO() })
  const dissent = await fixRun(SRC, { bugs: withB1({ dissent: 'DISSENT-MARKER documented fallback' }) })
  assert.deepEqual(asked(dissent), asked(plain))
  assert.equal(dissent.calls.some(c => c.prompt.includes('DISSENT-MARKER')), false)
  assert.deepEqual(dissent.logs, plain.logs)
})
