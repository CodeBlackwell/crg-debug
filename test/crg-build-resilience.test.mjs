import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Protects: one agent exhausting its StructuredOutput retry cap fails ITS phase with a
// phase-scoped message, instead of throwing past every `if (!x) throw` guard and
// discarding a run's already-successful phases.

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

const buildTryAgent = (agent, log = () => {}) => {
  const decl = declOf(src, 'tryAgent')
  assert.ok(decl, 'crg-build.js must declare tryAgent')
  return new Function('agent', 'log', 'capText', `${decl}\nreturn tryAgent`)(
    agent,
    log,
    (s, n) => String(s == null ? '' : s).trim().slice(0, n),
  )
}

test('tryAgent passes a successful result straight through', async () => {
  const tryAgent = buildTryAgent(async () => ({ gaps: [] }))
  assert.deepEqual(await tryAgent('x', { label: 'map' }), { gaps: [] })
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
  await tryAgent('x', { label: 'verify-env' })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /verify-env/)
  assert.match(lines[0], /retry cap/)
})

test('tryAgent survives a thrown non-Error and an absent label', async () => {
  const lines = []
  const tryAgent = buildTryAgent(async () => { throw 'plain string' }, m => lines.push(m))
  assert.equal(await tryAgent('x'), null)
  assert.match(lines[0], /unlabeled/)
})

test('crg-build.js calls agent() only through tryAgent', () => {
  const decl = declOf(src, 'tryAgent')
  // Prose about agent() is not a call site; only code counts.
  const outside = src.replace(decl, '').replace(/^\s*\/\/.*$/gm, '')
  const bare = [...outside.matchAll(/(?<![A-Za-z0-9_])agent\(/g)]
  assert.equal(bare.length, 0, `${bare.length} unguarded agent( call(s) — route them through tryAgent`)
  assert.equal([...decl.matchAll(/(?<![A-Za-z0-9_])agent\(/g)].length, 1, 'tryAgent must wrap exactly one agent() call')
})

test('tryAgent is defined before the first call site', () => {
  const first = src.indexOf('await tryAgent(')
  assert.notEqual(first, -1, 'no tryAgent call site')
  assert.ok(src.indexOf('const tryAgent = ') < first, 'tryAgent used before definition')
})

test('a failed load-bearing agent still fails its own phase with a phase-scoped message', () => {
  // Containment is not silence: the null path must still abort the phase that needed it.
  for (const guard of [/if \(!setup\) throw new Error\('Phase 0 \(Verify-Env\)/, /if \(!map\) throw new Error\('Phase 1 \(Map\)/]) {
    assert.match(src, guard)
  }
})
