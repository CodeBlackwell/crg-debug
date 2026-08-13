import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects: a gap whose capability turns out to already exist (stale) does NOT drag its
// dependents out of the campaign — its prerequisite demonstrably EXISTS, so dependents
// stay buildable; only genuinely dead deps cascade to unbuilt.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-build.js', import.meta.url)), 'utf8')

// A declaration's full text, from `const NAME` to where its brackets balance.
const declOf = (text, name) => {
  const m = new RegExp(`^const ${name} = `, 'm').exec(text)
  if (!m) return null
  let depth = 0
  for (let i = m.index; i < text.length; i++) {
    const c = text[i]
    if ('{(['.includes(c)) depth++
    else if ('})]'.includes(c)) depth--
    else if (c === '\n' && depth === 0) return text.slice(m.index, i)
  }
  return text.slice(m.index)
}

const harness = initialOpen => {
  const decl = declOf(src, 'markUnbuilt')
  assert.ok(decl, 'crg-build.js must declare markUnbuilt')
  // open / unbuilt / satisfied / waveNum are the wave loop's own state, supplied here.
  return new Function('initialOpen', `
    let open = initialOpen
    const unbuilt = []
    const satisfied = new Set()
    const waveNum = 1
    ${decl}
    return { markUnbuilt, unbuilt, openIds: () => open.map(o => o.gapId) }
  `)(initialOpen)
}

const GAP_1 = { gapId: 'gap-001', gap: 'add /api/reports endpoint' }
const GAP_2 = { gapId: 'gap-002', gap: 'link Reports from the nav', dependsOn: ['gap-001'] }

// The wave loop removes the marked gap from `open` before calling markUnbuilt, so the
// harness starts with only the still-open gaps.
test('a stale gap leaves its dependent open — the prerequisite already exists', () => {
  const h = harness([GAP_2])
  h.markUnbuilt(GAP_1, 'stale: every command criterion already passed — nothing to build', { cascade: false })
  assert.deepEqual(h.openIds(), ['gap-002'])
  assert.deepEqual(h.unbuilt.map(u => u.gapId), ['gap-001'])
})

test('a genuinely dead gap still cascades its dependents to unbuilt', () => {
  const h = harness([GAP_2])
  h.markUnbuilt(GAP_1, 'RED not observed on a command criterion — gap not reproduced; left untouched')
  assert.deepEqual(h.openIds(), [])
  assert.deepEqual(h.unbuilt.map(u => u.gapId), ['gap-001', 'gap-002'])
  assert.match(h.unbuilt[1].reason, /dependency gap-001 unbuilt/)
})

test('a dependent of a satisfied gap is not cascaded by a later, unrelated death', () => {
  const GAP_3 = { gapId: 'gap-003', gap: 'unrelated' }
  const h = harness([GAP_2])
  h.markUnbuilt(GAP_1, 'stale: nothing to build', { cascade: false })
  h.markUnbuilt(GAP_3, 'RED not observed')
  assert.deepEqual(h.openIds(), ['gap-002'])
})

test('the stale branch opts out of the cascade', () => {
  const line = (src.split('\n').find(l => l.includes('if (r.stale)')) || '').trim()
  assert.match(line, /markUnbuilt\(g, 'stale:[^']*', \{ cascade: false \}\)/)
})
