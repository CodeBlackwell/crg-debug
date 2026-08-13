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
const S = new Function(
  `${block}\nreturn { TARGETMAP_SCHEMA, TARGETS_SCHEMA, TARGET_ITEM, CONCERN_KEYS, SETUP_SCHEMA, SETUP_LEAN_SCHEMA, TOOLCHAIN_ROW, BASELINE_ROW, PROSE_LEAK }`,
)()

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

// Every agent() call outside the tryAgent declaration, tagged with the `const NAME =`
// it sits under. The bare token is what matters, not `await agent(`: a one-line wrapper
// (`const gateAgent = touched => agent(…)`) is exactly as uncontained as a bare call,
// and its await site reads as an ordinary helper call.
const unguardedAgentCalls = text => {
  const decl = declOf(text, 'tryAgent')
  const outside = decl ? text.replace(decl, '') : text
  return [...outside.matchAll(/(?<![\w$.])agent\(/g)]
    .filter(m => !outside.slice(outside.lastIndexOf('\n', m.index) + 1, m.index).includes('//'))
    .map(m => {
      const owner = [...outside.slice(0, m.index).matchAll(/^const ([\w$]+) = /gm)].pop()
      return owner ? owner[1] : 'top-level'
    })
}

// A wrapper helper is the shape the old `await agent(` proxy waved through, so it is the
// shape the invariant has to catch — otherwise the tryAgent port ships green and uncontained.
const WRAPPER_FIXTURE = `
const tryAgent = async (prompt, opts) => {
  try {
    return await agent(prompt, opts)
  } catch (err) {
    return null
  }
}

const gateAgent = touched => {
  return agent('run the gate', { label: 'gate' })
}

const finalGate = await gateAgent(['a.ts'])
`

test('an agent() call hidden behind a wrapper helper counts as unguarded', () => {
  assert.deepEqual(unguardedAgentCalls(WRAPPER_FIXTURE), ['gateAgent'])
})

test('source whose only agent() call is tryAgent’s reports nothing unguarded', () => {
  const contained = `
const tryAgent = async (prompt, opts) => {
  try {
    return await agent(prompt, opts)
  } catch (err) {
    return null
  }
}

const map = await tryAgent('x', { label: 'map' })
`
  assert.deepEqual(unguardedAgentCalls(contained), [])
})

// The wrapper helpers crg-debug.js has not yet routed through tryAgent. The backlog is
// EMPTY and must stay empty: every entry left here would whitelist a future regression,
// which is exactly what it did while the nine ported wrappers were still listed.
const KNOWN_UNGUARDED = []

test('crg-debug.js adds no new agent() call outside tryAgent', () => {
  const added = [...new Set(unguardedAgentCalls(src))].filter(name => !KNOWN_UNGUARDED.includes(name))
  assert.deepEqual(added, [], `unguarded agent() call(s) in ${added.join(', ')} — route them through tryAgent`)
  assert.equal(
    [...declOf(src, 'tryAgent').matchAll(/(?<![\w$.])agent\(/g)].length,
    1,
    'tryAgent must wrap exactly one agent() call',
  )
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

// ---- the Phase 0 fallback -------------------------------------------------------
// The same leak hit SETUP_SCHEMA (`resolvedScope` prose → `toolchain` array). Phase 0 is
// load-bearing and cannot drop to one property, so the fallback drops the PROSE instead.

test('SETUP_LEAN_SCHEMA keeps every required field of the full schema', () => {
  assert.deepEqual(S.SETUP_LEAN_SCHEMA.required, S.SETUP_SCHEMA.required)
})

test('SETUP_LEAN_SCHEMA is a strict, prose-free subset of SETUP_SCHEMA', () => {
  const lean = Object.keys(S.SETUP_LEAN_SCHEMA.properties)
  const full = Object.keys(S.SETUP_SCHEMA.properties)
  assert.ok(lean.every(k => full.includes(k)), 'lean must not invent fields the full schema lacks')
  assert.ok(lean.length < full.length, 'lean must actually drop something')
  // The dropped fields are exactly the free-text ones; what remains is graphStats (a short
  // fixed-format line) plus the two arrays. No prose → no prose/array boundary to leak at.
  assert.deepEqual(full.filter(k => !lean.includes(k)), ['resolvedScope', 'provisioned', 'containerImage'])
})

test('both setup schemas share their row definitions, so the fallback cannot drift', () => {
  assert.equal(S.SETUP_SCHEMA.properties.toolchain.items, S.TOOLCHAIN_ROW)
  assert.equal(S.SETUP_LEAN_SCHEMA.properties.toolchain.items, S.TOOLCHAIN_ROW)
  assert.equal(S.SETUP_SCHEMA.properties.baselineFailures.items, S.BASELINE_ROW)
  assert.equal(S.SETUP_LEAN_SCHEMA.properties.baselineFailures.items, S.BASELINE_ROW)
})

test('the Graph phase wires the fallback and reuses one brief for both attempts', () => {
  assert.match(src, /const setupBrief = /)
  assert.match(src, /label: 'setup', phase: 'Graph', schema: SETUP_SCHEMA/)
  assert.match(src, /label: 'setup-retry', phase: 'Graph', schema: SETUP_LEAN_SCHEMA/)
  assert.ok(src.indexOf("label: 'setup',") < src.indexOf("label: 'setup-retry'"))
})

// ---- retries escalate off the model that leaks ----------------------------------

test('every retry drops to the session model instead of repeating on the cheap one', () => {
  // `model: undefined` inherits the session model. Retrying the same shape on the same
  // model that just failed it five times is a coin flip, so neither retry passes `model`.
  for (const label of ["'setup-retry'", "'map-retry'"]) {
    const at = src.indexOf(`label: ${label}`)
    assert.notEqual(at, -1, `${label} call site missing`)
    const opts = src.slice(at, src.indexOf('\n', at))
    assert.match(opts, /model: undefined/, `${label} must escalate off the leaking model`)
  }
})

test('both retries carry the shared shape-correction directive', () => {
  assert.match(S.PROSE_LEAK, /<parameter>/)
  assert.match(S.PROSE_LEAK, /well-formed JSON/)
  assert.equal([...src.matchAll(/RETRY — \$\{PROSE_LEAK\}/g)].length, 2)
})

test('an empty-but-valid target map takes the fallback, then aborts', () => {
  // A submit that VALIDATES with targets:[] is as useless as a failed one: the finders
  // get nothing to partition. Both the retry guard and the final throw must test length,
  // not just truthiness — `if (!map)` alone was the original hole.
  const guards = [...src.matchAll(/!map \|\| !\(map\.targets \|\| \[\]\)\.length/g)]
  assert.equal(guards.length, 2, 'both the fallback trigger and the abort must check targets length')
  assert.match(src, /Phase 1 \(Map\) produced no targets/)
})
