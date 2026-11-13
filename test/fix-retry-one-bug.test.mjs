// Protects the user from losing good fixes to a neighbour's problem: when a fixer that held
// several bugs of one file is taken back for what it did to an existing test, each bug is
// tried again alone, the ones that leave existing tests alone are fixed and committed, and
// only a bug whose own fix needs the test changed is reported as needing a decision.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = SRC.slice(SRC.indexOf('// >>> pure-helpers'), SRC.indexOf('// <<< pure-helpers'))
const H = new Function(`${block}\nreturn { strikeOf, takenBackNote, decisionRow, FIX_SCHEMA, FIX_RETRY_SCHEMA }`)()
// The stubbed fix run is the block fix-regression-gate.test.mjs marks as its harness.
const HARNESS = readFileSync(fileURLToPath(new URL('./fix-regression-gate.test.mjs', import.meta.url)), 'utf8')
const { fixRun, bug } = new Function(`${HARNESS.slice(HARNESS.indexOf('// >>> fix-harness'), HARNESS.indexOf('// <<< fix-harness'))}\nreturn { fixRun, bug }`)()

const names = bugs => bugs.map(b => b.bugId)
const idsIn = prompt => [...prompt.matchAll(/^bugId: (\S+)$/gm)].map(m => m[1])
// The bugs each fix agent was given, in call order.
const fixerLoads = calls => calls.filter(c => c.label.startsWith('fix:')).map(c => idsIn(c.prompt).join('+'))
// A run in which the existing-test check finds tests/test_termui.py changed whenever the
// wave's fixer held one of `pinned` — the bugs whose fix only works with that test changed.
const withPinned = pinned => {
  let held = []
  return {
    fix: ({ prompt }) => { held = idsIn(prompt); return undefined },
    testedits: ({ prompt }) => {
      const id = /crg-test-edits-checked ([0-9a-f]+) /.exec(prompt)[1]
      const rows = held.some(b => pinned.includes(b)) ? ['3\t2\tsrc/termui.py', '1\t1\ttests/test_termui.py'] : ['3\t2\tsrc/termui.py']
      return { results: [{ command: 'check', exitCode: 0, stdout: `${rows.join('\n')}\ncrg-test-edits-checked ${id} ${rows.length}\n` }] }
    },
  }
}

test('five bugs in one file, two of which need the existing test changed: three are fixed and committed, two need a decision', async () => {
  const five = ['b1', 'b2', 'b3', 'b4', 'b5'].map(id => bug(id, 'src/termui.py'))
  const { result, calls, labels } = await fixRun(SRC, { bugs: five, on: withPinned(['b1', 'b2']) })

  assert.deepEqual(fixerLoads(calls), ['b1+b2+b3+b4', 'b1', 'b2', 'b3', 'b4', 'b1', 'b2', 'b5'], 'after the take-back every bug of that fixer is tried alone, in turn')
  assert.deepEqual(names(result.fix.fixed).sort(), ['b3', 'b4', 'b5'])
  assert.deepEqual(result.fix.commits.map(c => c.bugs), [['b3'], ['b4'], ['b5']], 'each fixed alone, each committed')
  assert.deepEqual(result.fix.unfixed, [])
  assert.deepEqual(result.fix.needsDecision.map(d => [d.bugs, d.reason]), [
    [['b1'], 'fix needs an existing test changed: tests/test_termui.py'],
    [['b2'], 'fix needs an existing test changed: tests/test_termui.py'],
  ])
  const [first, second] = result.fix.needsDecision
  assert.notEqual(first.ref, second.ref, 'each has its own proposal')
  assert.equal(labels.filter(l => l.startsWith('propose:')).length, 2)
  assert.equal(labels.includes('fix:coupled'), false, 'none of them is handed to the coupled attempt')
  assert.equal(result.fix.waves.length, 8, 'the single-bug retries are not cut off by the cap on ordinary waves')
  assert.equal(result.fix.halted, undefined)
})

test('a strike comes only from a bug\'s own attempt: a file-mate\'s trouble is not told to it, nor counted against it', async () => {
  const five = ['b1', 'b2', 'b3', 'b4', 'b5'].map(id => bug(id, 'src/termui.py'))
  const { calls } = await fixRun(SRC, { bugs: five, on: withPinned(['b1', 'b2']) })
  const briefs = calls.filter(c => c.label.startsWith('fix:'))
  const [, b1First, , b3Alone, , b1Second] = briefs
  assert.deepEqual([idsIn(b1First.prompt), idsIn(b3Alone.prompt), idsIn(b1Second.prompt)], [['b1'], ['b3'], ['b1']])
  for (const fresh of [b1First, b3Alone]) {
    assert.equal(fresh.prompt.includes('TAKEN BACK'), false, 'the shared fixer\'s take-back is nobody\'s strike')
    assert.deepEqual(fresh.opts.schema, H.FIX_SCHEMA)
  }
  const edited = H.strikeOf([], [{ path: 'tests/test_termui.py', removed: 1 }])
  assert.ok(b1Second.prompt.includes(H.takenBackNote([{ bugId: 'b1' }], new Map([['b1', edited]]))), 'b1\'s second attempt alone is told what its own first did')
  assert.deepEqual(b1Second.opts.schema, H.FIX_RETRY_SCHEMA)
})

const EXISTING = { id: 'tests/test_alpha.py::test_existing', output: 'AssertionError: 1 != 2' }
const BASE_CMD = 'pytest tests/test_alpha.py tests/test_bravo.py'
const failing = (...f) => ({ runs: [{ command: BASE_CMD, exitCode: f.length ? 1 : 0, failing: f }] })
const blameB1 = () => ({ causes: [{ test: EXISTING.id, bugIds: ['b1'] }] })
const PAIR = [bug('b1', 'src/alpha.py'), bug('b2', 'src/alpha.py')] // one fixer holds both

test('a bug taken back with a file-mate and then fixed cleanly alone is committed and carries no strike', async () => {
  // Together they break an existing test; alone, neither does.
  const regress = ({ label }) => (label === 'regress:wave1' ? failing(EXISTING) : undefined)
  const { result, calls } = await fixRun(SRC, { bugs: PAIR, on: { regress, blame: blameB1 } })
  assert.deepEqual(fixerLoads(calls), ['b1+b2', 'b1', 'b2'])
  assert.deepEqual(names(result.fix.fixed), ['b1', 'b2'])
  assert.deepEqual(result.fix.commits.map(c => c.bugs), [['b1'], ['b2']])
  assert.deepEqual(result.fix.needsDecision, [])
  assert.equal(calls.filter(c => c.label.startsWith('fix:')).some(c => c.prompt.includes('TAKEN BACK')), false, 'not even the bug the blame named: that was a shared attempt')
  assert.equal(calls.some(c => c.label.startsWith('propose:')), false)
})

test('a proposal holds one bug: the one whose own attempts broke the test, not its file-mate', async () => {
  // b1 breaks the existing test whenever it is in the tree; b2 never does.
  let held = []
  const fix = ({ prompt }) => { held = idsIn(prompt); return undefined }
  const regress = ({ label }) => (/^regress:wave\d+$/.test(label) && held.includes('b1') ? failing(EXISTING) : undefined)
  const { result, calls } = await fixRun(SRC, { bugs: PAIR, on: { fix, regress, blame: blameB1 } })
  assert.deepEqual(fixerLoads(calls), ['b1+b2', 'b1', 'b2', 'b1'], 'together, then b1 alone (its strike), b2 alone, b1 once more')
  assert.deepEqual(names(result.fix.fixed), ['b2'])
  assert.deepEqual(result.fix.needsDecision.map(d => [d.bugs, d.reason]), [[['b1'], `fix breaks existing test ${EXISTING.id}`]])
  assert.deepEqual(result.fix.unfixed, [])
})

test('a bug that fails its own test alone goes to the coupled attempt without taking the waiting bugs with it', async () => {
  // The shared fixer changed an existing test, so both bugs are owed an attempt alone.
  // b1's own test then stays red; b2 has not had its turn yet and must still get it.
  let held = []
  let coupled = false
  const fix = ({ label, prompt }) => { held = idsIn(prompt); coupled = label === 'fix:coupled'; return undefined }
  const testedits = ({ label, prompt }) => {
    const id = /crg-test-edits-checked ([0-9a-f]+) /.exec(prompt)[1]
    const rows = label === 'testedits:wave1' ? ['1\t1\ttests/test_alpha.py'] : []
    return { results: [{ command: 'check', exitCode: 0, stdout: `${rows.join('\n')}\ncrg-test-edits-checked ${id} ${rows.length}\n` }] }
  }
  const gate = ({ label, prompt }) => (label === 'gate:alpha.py' && prompt.includes('::test_b1') && held.length === 1 && !coupled ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const { result, calls } = await fixRun(SRC, { bugs: PAIR, on: { fix, testedits, gate } })
  assert.deepEqual(fixerLoads(calls), ['b1+b2', 'b1', 'b2', 'b1'], 'b2 gets its own attempt before anything is called coupled')
  assert.deepEqual(calls.filter(c => c.label.startsWith('fix:')).map(c => c.label), ['fix:alpha.py', 'fix:alpha.py', 'fix:alpha.py', 'fix:coupled'], 'and only then is b1, alone, handed on')
  assert.deepEqual(names(result.fix.fixed).sort(), ['b1', 'b2'], 'the coupled attempt closes b1 here; b2 closed on its own')
  assert.deepEqual(result.fix.commits.map(c => c.bugs), [['b2'], ['b1']])
})

test('bugs that each fail their own test alone are handed to the coupled attempt together', async () => {
  // Fixed together they pass (and change an existing test); alone, each one's test stays red.
  let held = []
  let coupled = false
  const fix = ({ label, prompt }) => { held = idsIn(prompt); coupled = label === 'fix:coupled'; return undefined }
  const testedits = ({ label, prompt }) => {
    const id = /crg-test-edits-checked ([0-9a-f]+) /.exec(prompt)[1]
    const rows = label === 'testedits:wave1' ? ['1\t1\ttests/test_alpha.py'] : []
    return { results: [{ command: 'check', exitCode: 0, stdout: `${rows.join('\n')}\ncrg-test-edits-checked ${id} ${rows.length}\n` }] }
  }
  const gate = ({ label }) => (label === 'gate:alpha.py' && held.length === 1 && !coupled ? { results: [{ command: 'pytest', exitCode: 1 }] } : undefined)
  const { result, calls } = await fixRun(SRC, { bugs: PAIR, on: { fix, testedits, gate } })
  assert.deepEqual(fixerLoads(calls), ['b1+b2', 'b1', 'b2', 'b1+b2'], 'each had its turn alone first')
  assert.equal(calls.filter(c => c.label === 'fix:coupled').length, 1)
  assert.deepEqual(names(result.fix.fixed).sort(), ['b1', 'b2'])
})

test('a proposal whose fixer gave no ground says so in words', () => {
  const strike = H.strikeOf([{ id: 't::x', output: '' }], [])
  const proposal = { ref: 'refs/crg-debug/proposed/n-0123456789ab', commit: `0123456789ab${'c'.repeat(28)}` }
  for (const ground of ['', '   ', undefined, null]) {
    assert.equal(H.decisionRow('/work', 2, [{ bugId: 'b1' }], 'src/a.py', strike, proposal, null, ground).fixerClaim, 'none given — the fix agent stated no ground for the change')
  }
  assert.equal(H.decisionRow('/work', 2, [{ bugId: 'b1' }], 'src/a.py', strike, proposal, null, 'docs say so').fixerClaim, 'docs say so')
})
