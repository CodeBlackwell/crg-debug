// Protects what a finder is actually handed during a sweep: a bounded slice of the map with
// the ranked functions named, an instruction to judge them one at a time, and a submit
// shape that shows whether it did — plus the one log line per finder that a run is read by.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
  .replace(/^export\s+const\s+meta/m, 'const meta')
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { ledgerDisk } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { ledgerDisk }`)()
const DISK = ledgerDisk(SRC)
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor
const parallel = async thunks => Promise.all(thunks.map(t => t())).then(rows => JSON.parse(JSON.stringify(rows)))

const names = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}_${i}`)
// backend-logic: 14 + 10 fill one slice, 30 is over the cap alone, then two small files.
const TARGETS = [
  { file: 'src/core.py', concern: 'backend-logic', functions: names('core', 14) },
  { file: 'src/types.py', concern: 'backend-logic', functions: names('types', 10) },
  { file: 'src/parser.py', concern: 'backend-logic', functions: names('parser', 30) },
  { file: 'src/utils.py', concern: 'backend-logic', functions: ['echo', 'style'] },
  { file: 'src/_compat.py', concern: 'backend-logic' },
  { file: 'src/auth.py', concern: 'security', functions: ['check_token'] },
]
const FINDING = { file: 'src/utils.py:40', concern: 'backend-logic', symptom: 's', rootCause: 'echo drops the newline', severity: 'Medium', whyRepro: 'w', confidence: 'high' }

// `answer(label)` is what a finder returns; everything else in the sweep answers plainly.
const sweep = async ({ answer = () => ({ audited: [], findings: [] }), args = {} } = {}) => {
  const calls = []
  const logs = []
  const agent = async (prompt, opts = {}) => {
    const label = opts.label || ''
    calls.push({ label, prompt, opts })
    if (label === 'setup') return { graphStats: '6 files', resolvedScope: 'full repo', toolchain: [{ package: 'app', test: 'pytest' }], baselineFailures: [] }
    if (label === 'map') return { overview: 'o', targets: TARGETS }
    if (label.startsWith('find:')) return answer(label)
    const onDisk = DISK.answer(prompt)
    if (onDisk !== undefined) return onDisk
    if (opts.phase === 'Verify' && opts.schema) return { confirmed: true, reason: 'r', classification: 'real-bug' }
    return 'written'
  }
  const res = await new AsyncFunction('args', 'agent', 'parallel', 'log', 'workflow', 'phase', SRC)(
    { repoRoot: '/tmp/crg-fixture', methodologyPath: '/tmp/METHODOLOGY.md', ...args }, (prompt, opts) => Promise.resolve(agent(prompt, opts)).then(r => (r === undefined ? r : JSON.parse(JSON.stringify(r)))), parallel, m => logs.push(m), undefined, () => {},
  )
  return { calls, logs, res, finders: calls.filter(c => c.label.startsWith('find:')) }
}
// The scoped list only — the residual brief also lists, earlier, the files other finders hold.
const fileList = prompt =>
  prompt.slice(prompt.indexOf('Your scoped files'), prompt.indexOf('WORK ONE FUNCTION')).split('\n').filter(line => line.startsWith('- '))

test('a concern is split into one finder per slice, and a single-slice concern keeps its plain label', async () => {
  const { finders } = await sweep()
  assert.deepEqual(finders.map(f => f.label), ['find:backend-logic/1', 'find:backend-logic/2', 'find:backend-logic/3', 'find:security', 'find:residual'])
  assert.deepEqual(finders.map(f => fileList(f.prompt).map(line => line.split(' — ')[0])), [
    ['- src/core.py', '- src/types.py'],
    ['- src/parser.py'],
    ['- src/utils.py', '- src/_compat.py'],
    ['- src/auth.py'],
    [],
  ])
})

test('each scoped file is listed with the functions the map ranked in it', async () => {
  const { finders } = await sweep()
  const third = finders[2].prompt
  assert.ok(third.includes('the hot path never imports): After each file are the functions the map ranked in it:\n- src/utils.py — echo, style\n- src/_compat.py\n\nWORK ONE FUNCTION AT A TIME, NOT ONE FILE AT A TIME.'))
  assert.equal(fileList(finders[0].prompt)[0], `- src/core.py — ${names('core', 14).join(', ')}`)
  assert.equal(fileList(finders[1].prompt)[0].split(', ').length, 30, 'a file over the cap keeps every ranked function')
})

const AUDIT_PARAGRAPH = 'WORK ONE FUNCTION AT A TIME, NOT ONE FILE AT A TIME. For every function named above, in order: read its body, its docstring and the tests that exercise it; write one `audited` row saying what it is meant to do (from its docstring, the docs or its tests, and name which) and whether the code does exactly that; only then move to the next function. After the named functions, go through the remaining functions of each file the same way and add a row for each one you audit. A function you did not open gets no row. Every row with verdict "defect" needs a matching findings row.'

test('every finder is told to work one function at a time and submits an audit before its findings', async () => {
  const { finders } = await sweep()
  for (const f of finders) {
    assert.equal(f.prompt.split(AUDIT_PARAGRAPH).length, 2, `${f.label}: the paragraph appears once, verbatim`)
    assert.ok(f.prompt.includes(`\n\n${AUDIT_PARAGRAPH}\n\nPrefer CRG tools`), `${f.label}: it sits between the file list and the tool guidance`)
    assert.deepEqual(f.opts.schema.required, ['audited', 'findings'])
    assert.equal(f.opts.agentType, 'Explore')
  }
})

test('the residual finder is handed no files and no function sentence', async () => {
  const { finders } = await sweep()
  const residual = finders.at(-1).prompt
  assert.ok(residual.includes(`the hot path never imports):\n(no files pre-assigned — sweep the uncovered surface yourself)\n\n${AUDIT_PARAGRAPH}`))
  assert.ok(!residual.includes('After each file are the functions'))
  assert.ok(residual.includes('RESIDUAL PASS'))
})

test('the script logs how many ranked functions each finder gave a verdict', async () => {
  const answer = label => {
    if (label === 'find:backend-logic/1') return { audited: [...names('core', 14), 'TYPES_0', 'unranked_helper'].map(fn => ({ file: 'f', function: fn, intended: 'i', verdict: 'matches' })), findings: [] }
    if (label === 'find:backend-logic/2') return null
    if (label === 'find:backend-logic/3') return { audited: [{ file: 'src/utils.py', function: 'echo', intended: 'docstring: writes a line', verdict: 'defect' }], findings: [FINDING] }
    if (label === 'find:security') return { findings: [] }
    return { audited: [{ file: 'x.py', function: 'whatever', intended: 'i', verdict: 'matches' }], findings: [] }
  }
  const { logs, res } = await sweep({ answer })
  const start = logs.indexOf('find:backend-logic/1: 15 of 24 ranked functions given a verdict')
  assert.deepEqual(logs.slice(start, start + 5), [
    'find:backend-logic/1: 15 of 24 ranked functions given a verdict',
    'find:backend-logic/2: returned nothing',
    'find:backend-logic/3: 1 of 2 ranked functions given a verdict',
    'find:security: 0 of 1 ranked functions given a verdict',
    'find:residual: 0 of 0 ranked functions given a verdict',
  ])
  assert.deepEqual(res.confirmedBugs, [FINDING], 'downstream still reads findings only, and a dead or lazy finder gates nothing')
})

test('a later round keeps the slice number and puts the round suffix last', async () => {
  let asked = 0
  const answer = label => ({ audited: [], findings: label === 'find:backend-logic/3' && asked++ === 0 ? [FINDING] : [] })
  const { finders } = await sweep({ answer, args: { discoveryRounds: 2 } })
  assert.deepEqual(finders.slice(5).map(f => f.label), ['find:backend-logic/1#2', 'find:backend-logic/2#2', 'find:backend-logic/3#2', 'find:security#2', 'find:residual#2'])
})
