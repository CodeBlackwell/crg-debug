import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Regression cover for the failure that killed a crg-debug run on 2026-08-13.
//
// The Map agent emitted a MALFORMED tool call: it JSON-encoded `overview` and then
// appended the raw wire format — `</overview>\n<parameter name="targets">[...]` —
// INSIDE that string. So the harness parsed `{overview: "..."}`, the schema rejected it
// for a missing `targets`, and the retry feedback ("must have required property
// 'targets'") never told the model its SERIALIZATION was wrong. It reproduced the same
// shape all five attempts, `agent()` threw on the retry cap, and the throw walked past
// every `if (!x)` guard in the workflow — discarding an already-successful Graph phase.
//
// Two invariants keep that from recurring: agent failures are contained (tryAgent), and
// the Map phase has a one-property fallback the glitch structurally cannot hit.

const src = readFileSync(fileURLToPath(new URL('../workflows/crg-debug.js', import.meta.url)), 'utf8')
const block = src.slice(src.indexOf('// >>> pure-helpers'), src.indexOf('// <<< pure-helpers'))
const S = new Function(`${block}\nreturn { TARGETMAP_SCHEMA, TARGETS_SCHEMA, TARGET_ITEM, CONCERN_KEYS }`)()

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

// tryAgent is not pure (it closes over the injected `agent` and `log` globals), so it
// lives below the pure-helpers block. Eval its real declaration with those two faked.
const buildTryAgent = (agent, log = () => {}) =>
  new Function('agent', 'log', 'capText', `${declOf(src, 'tryAgent')}\nreturn tryAgent`)(
    agent,
    log,
    (s, n) => String(s == null ? '' : s).trim().slice(0, n),
  )

// ---- tryAgent: both failure shapes become null ----------------------------------

test('tryAgent passes a successful result straight through', async () => {
  const tryAgent = buildTryAgent(async () => ({ targets: [{ file: 'a.ts', concern: 'frontend' }] }))
  assert.deepEqual(await tryAgent('x', { label: 'map' }), { targets: [{ file: 'a.ts', concern: 'frontend' }] })
})

test('tryAgent converts a THROWN agent failure into null — the retry-cap shape', async () => {
  const tryAgent = buildTryAgent(async () => {
    throw new Error('agent({schema}): StructuredOutput retry cap (5) exceeded — 5 failed calls with no valid output')
  })
  assert.equal(await tryAgent('x', { label: 'map' }), null)
})

test('tryAgent preserves the null agent() already returns', async () => {
  const tryAgent = buildTryAgent(async () => null)
  assert.equal(await tryAgent('x', { label: 'map' }), null)
})

test('tryAgent logs the failure with its label — no silent swallow', async () => {
  const lines = []
  const tryAgent = buildTryAgent(async () => { throw new Error('retry cap (5) exceeded') }, m => lines.push(m))
  await tryAgent('x', { label: 'map' })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /map/)
  assert.match(lines[0], /retry cap/)
})

test('tryAgent survives a thrown non-Error and an absent label', async () => {
  const lines = []
  const tryAgent = buildTryAgent(async () => { throw 'plain string' }, m => lines.push(m))
  assert.equal(await tryAgent('x'), null)
  assert.match(lines[0], /unlabeled/)
})

// ---- every agent call in crg-debug.js is contained ------------------------------
// The bug was not that one call lacked a guard — it was that NO call had one, while the
// whole file was written as if agent() only ever returns null.

test('crg-debug.js calls agent() only through tryAgent', () => {
  const decl = declOf(src, 'tryAgent')
  const outside = src.replace(decl, '')
  const bare = [...outside.matchAll(/await agent\(/g)]
  assert.equal(bare.length, 0, `${bare.length} unguarded await agent( call(s) — route them through tryAgent`)
  assert.equal([...decl.matchAll(/await agent\(/g)].length, 1, 'tryAgent must wrap exactly one agent() call')
})

test('tryAgent is defined before the first call site', () => {
  assert.ok(src.indexOf('const tryAgent = ') < src.indexOf('await tryAgent('), 'tryAgent used before definition')
})

// ---- the Map fallback -----------------------------------------------------------

test('TARGETS_SCHEMA has exactly one property — the glitch needs two to occur', () => {
  assert.deepEqual(S.TARGETS_SCHEMA.required, ['targets'])
  assert.deepEqual(Object.keys(S.TARGETS_SCHEMA.properties), ['targets'])
})

test('the primary map schema is the two-property shape that failed', () => {
  assert.deepEqual(S.TARGETMAP_SCHEMA.required, ['overview', 'targets'])
})

test('both map schemas share one target row, so the fallback cannot drift', () => {
  assert.equal(S.TARGETMAP_SCHEMA.properties.targets.items, S.TARGET_ITEM)
  assert.equal(S.TARGETS_SCHEMA.properties.targets.items, S.TARGET_ITEM)
  assert.deepEqual(S.TARGET_ITEM.required, ['file', 'concern'])
  assert.deepEqual(S.TARGET_ITEM.properties.concern.enum, S.CONCERN_KEYS)
})

test('the Map phase wires the fallback and reuses one brief for both attempts', () => {
  assert.match(src, /const mapBrief = /, 'the brief must be a const both attempts can share')
  assert.match(src, /label: 'map', phase: 'Map', schema: TARGETMAP_SCHEMA/)
  assert.match(src, /label: 'map-retry', phase: 'Map', schema: TARGETS_SCHEMA/)
  // Ordering: primary first, then the retry.
  assert.ok(src.indexOf("label: 'map',") < src.indexOf("label: 'map-retry'"))
})

test('an empty-but-valid target map takes the fallback, then aborts', () => {
  // A submit that VALIDATES with targets:[] is as useless as a failed one: the finders
  // get nothing to partition. Both the retry guard and the final throw must test length,
  // not just truthiness — `if (!map)` alone was the original hole.
  const guards = [...src.matchAll(/!map \|\| !\(map\.targets \|\| \[\]\)\.length/g)]
  assert.equal(guards.length, 2, 'both the fallback trigger and the abort must check targets length')
  assert.match(src, /Phase 1 \(Map\) produced no targets/)
})
