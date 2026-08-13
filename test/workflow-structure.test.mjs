import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Structural invariants that hold across EVERY workflow script. These files can't
// import each other (the Workflow sandbox has no module loader), so the shared parts
// are deliberate copies — see "Byte-identical twins" in CLAUDE.md. Duplication is the
// mechanism; these tests are what keep it honest.

const dir = fileURLToPath(new URL('../workflows/', import.meta.url))
const files = readdirSync(dir).filter(f => f.endsWith('.js')).sort()
const src = Object.fromEntries(files.map(f => [f, readFileSync(dir + f, 'utf8')]))

assert.ok(files.length >= 8, 'expected the full workflow set')

// Slice from `start` to the brace that closes the object literal opened after it.
const objectLiteralAt = (text, start) => {
  const open = text.indexOf('{', start)
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1)
  }
  throw new Error('unbalanced object literal')
}

// ---- meta.phases <-> phase() contract ------------------------------------------
// The runtime matches phase titles EXACTLY: a phase() call with no meta entry gets an
// orphan group box, and a meta entry nothing references never lights up. Both failures
// are silent at runtime, so they get caught here instead.

for (const f of files) {
  test(`${f}: meta is a pure literal with the required fields`, () => {
    const at = src[f].indexOf('export const meta')
    assert.notEqual(at, -1, 'every workflow must export meta')
    const meta = new Function(`return ${objectLiteralAt(src[f], at)}`)()
    assert.equal(typeof meta.name, 'string')
    assert.equal(typeof meta.description, 'string')
    assert.ok(meta.name.length > 0 && meta.description.length > 0)
  })

  test(`${f}: every declared phase is used, and every used phase is declared`, () => {
    const at = src[f].indexOf('export const meta')
    const meta = new Function(`return ${objectLiteralAt(src[f], at)}`)()
    const declared = new Set((meta.phases || []).map(p => p.title))

    const body = src[f].slice(at + objectLiteralAt(src[f], at).length)
    const used = new Set()
    for (const m of body.matchAll(/\bphase\(\s*'([^']+)'\s*\)/g)) used.add(m[1])
    for (const m of body.matchAll(/\bphase:\s*'([^']+)'/g)) used.add(m[1])

    const undeclared = [...used].filter(p => !declared.has(p)).sort()
    const unused = [...declared].filter(p => !used.has(p)).sort()
    assert.deepEqual(undeclared, [], `phases used in code but absent from meta.phases: ${undeclared}`)
    assert.deepEqual(unused, [], `phases declared in meta.phases but never used: ${unused}`)
  })
}

// ---- pure-helpers block markers -------------------------------------------------

for (const f of files) {
  test(`${f}: pure-helpers markers are intact and ordered`, () => {
    const open = src[f].indexOf('// >>> pure-helpers')
    const close = src[f].indexOf('// <<< pure-helpers')
    assert.notEqual(open, -1, 'missing opening marker')
    assert.notEqual(close, -1, 'missing closing marker')
    assert.ok(open < close, 'markers are out of order')
  })
}

// ---- the block is genuinely self-contained --------------------------------------
// "Dependency-free" is the block's whole premise: the unit tests eval it in isolation,
// so anything reaching out to a runtime global (args, agent, log) or to a declaration
// left below the marker only fails once a real run reaches that line. Evaluating the
// block here turns that into a test failure instead.

for (const f of files) {
  test(`${f}: pure-helpers block evaluates standalone`, () => {
    const s = src[f]
    const block = s.slice(s.indexOf('// >>> pure-helpers'), s.indexOf('// <<< pure-helpers'))
    assert.doesNotThrow(() => new Function(block)(), 'block reaches outside itself')
  })
}

// ---- shared prelude parity ------------------------------------------------------
// These helpers encode ONE piece of knowledge each. Copies exist only because the
// sandbox forbids imports; any divergence between them is drift, not design.

const helpersOf = f => {
  const s = src[f]
  return s.slice(s.indexOf('// >>> pure-helpers'), s.indexOf('// <<< pure-helpers'))
}

// A declaration's full text, from `const NAME` to the line where its brackets balance.
const declOf = (text, name) => {
  const re = new RegExp(`^const ${name} = `, 'm')
  const m = re.exec(text)
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

// resolveModel is checked separately — crg-agentsmd.js has one documented variant.
const SHARED_PRELUDE = ['fence', 'capText', 'norm', 'normPath', 'isSafeAbs', 'commitMessageOk', 'TIERS', 'tryAgent', 'uncommitOk']

// Prelude parity searches the WHOLE workflow, not just the helpers block: only *_SCHEMA
// declarations are required to sit inside the markers, and several prelude copies
// legitimately live below them (isSafeAbs in crg-ui.js, crg-ui-prep.js, crg-integrations.js).
// Scoping the lookup to the block silently resolved isSafeAbs in one file and compared nothing.
for (const name of SHARED_PRELUDE) {
  test(`prelude parity: ${name} is byte-identical everywhere it is defined`, () => {
    const found = files
      .map(f => [f, declOf(src[f], name)])
      .filter(([, d]) => d !== null)
    assert.ok(found.length >= 2, `${name} resolved in ${found.length} workflow(s) — parity compared nothing`)
    const [refFile, ref] = found[0]
    for (const [f, decl] of found.slice(1)) {
      assert.equal(decl, ref, `${name} in ${f} has drifted from ${refFile}`)
    }
  })
}

// Protects the path-traversal guard: a repoRoot like /repo/../etc must never reach a tool.
test('isSafeAbs: every copy rejects traversal and relative paths', () => {
  const found = files.map(f => [f, declOf(src[f], 'isSafeAbs')]).filter(([, d]) => d !== null)
  assert.ok(found.length >= 2, `isSafeAbs resolved in ${found.length} workflow(s)`)
  for (const [f, decl] of found) {
    const isSafeAbs = new Function(`${decl}\nreturn isSafeAbs`)()
    assert.equal(isSafeAbs('/repo/sub'), true, `${f} rejects a safe absolute path`)
    assert.equal(isSafeAbs('/repo/../etc'), false, `${f} accepts a traversal path`)
    assert.equal(isSafeAbs('/repo/..'), false, `${f} accepts a trailing traversal path`)
    assert.equal(isSafeAbs('repo/sub'), false, `${f} accepts a relative path`)
  }
})

test('resolveModel: every copy is identical except the documented agentsmd variant', () => {
  const found = files
    .map(f => [f, declOf(helpersOf(f), 'resolveModel')])
    .filter(([, d]) => d !== null)
  const variants = new Map()
  for (const [f, d] of found) variants.set(d, [...(variants.get(d) || []), f])
  assert.equal(variants.size, 2, `expected exactly 2 resolveModel variants, got ${variants.size}`)
  const odd = [...variants.values()].find(fs => fs.length === 1)
  assert.deepEqual(odd, ['crg-agentsmd.js'], 'the only permitted variant defaults to the session model')
})

// ---- shared schema parity -------------------------------------------------------
// GATE_SCHEMA is the exit-code gate contract — the single most load-bearing schema in
// the repo. Three workflows declare it and all three mean the same thing. crg-agentsmd
// deliberately does NOT: its gate carries an extra code-vs-env discriminator, so it
// declares GATE_KIND_SCHEMA instead rather than hiding a superset behind a shared name.

test('GATE_SCHEMA is byte-identical in every workflow that declares it', () => {
  const found = files
    .map(f => [f, declOf(helpersOf(f), 'GATE_SCHEMA')])
    .filter(([, d]) => d !== null)
  assert.ok(found.length >= 3, `expected GATE_SCHEMA in at least 3 workflows, found ${found.length}`)
  const [refFile, ref] = found[0]
  for (const [f, decl] of found.slice(1)) {
    assert.equal(decl, ref, `GATE_SCHEMA in ${f} has drifted from ${refFile}`)
  }
})

// ---- section spine ---------------------------------------------------------------
// Every workflow reads top-to-bottom in the same shape. The duplicate-title check is
// the one that earns its keep: a header pasted twice looks like two sections and sends
// the next reader hunting for a boundary that isn't there.

for (const f of files) {
  test(`${f}: section spine is present and unambiguous`, () => {
    const titles = [...src[f].matchAll(/^ *\/\/ ---- (.+?) -{2,}$/gm)].map(m => m[1].trim())
    assert.ok(titles.includes('schemas'), 'missing the schemas header')
    assert.ok(titles.includes('args'), 'missing the args header')

    const dupes = titles.filter((t, i) => titles.indexOf(t) !== i)
    assert.deepEqual([...new Set(dupes)], [], `duplicate section headers: ${[...new Set(dupes)]}`)

    // schemas sits inside the helpers block; args opens the orchestration below it.
    const close = src[f].indexOf('// <<< pure-helpers')
    assert.ok(src[f].indexOf('// ---- schemas ') < close, 'schemas header must be inside the block')
    assert.ok(src[f].indexOf('// ---- args ') > close, 'args header must follow the block')
  })
}

// ---- schemas live inside the tested block ---------------------------------------
// Every *_SCHEMA is a static literal, so it belongs in the pure-helpers block where the
// parity and structure tests can reach it. A schema declared outside is invisible here.

for (const f of files) {
  test(`${f}: every *_SCHEMA is declared inside the pure-helpers block`, () => {
    const close = src[f].indexOf('// <<< pure-helpers')
    const outside = [...src[f].matchAll(/^const ([A-Z][A-Z0-9_]*_SCHEMA[A-Z0-9_]*) = /gm)]
      .filter(m => m.index > close)
      .map(m => m[1])
    assert.deepEqual(outside, [], `schemas declared after the pure-helpers block: ${outside}`)
  })
}
