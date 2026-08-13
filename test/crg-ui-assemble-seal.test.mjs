import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The assemble gate compares the tool's seal against the seal of the keys the script
// relayed cell-by-cell. That equality is only honest because the call passes --cells: the
// captures dir is NEVER cleaned, so an unscoped assemble also ingests a renamed cell's
// orphan measure file, or last run's file for a cell that failed this one, and folds their
// keys into allKeys — the no-regression baseline a repair run slices, where a stale key
// makes a genuine new regression read as pre-existing.
const uiSrc = readFileSync(fileURLToPath(new URL('../workflows/crg-ui.js', import.meta.url)), 'utf8')
const toolPath = fileURLToPath(new URL('../lib/crg-ui.measure.mjs', import.meta.url))

test('the assemble phase scopes the ingest to the cells this run measured', () => {
  const section = uiSrc.slice(uiSrc.indexOf('---- Assemble'), uiSrc.indexOf("status: 'measured'"))
  assert.ok(/--cells \$\{JSON\.stringify\(good\.map\(/.test(section),
    'assemble must name the good cells — an unscoped ingest folds orphan capture files into allKeys')
  assert.ok(/assembled\.seal !== sealOf\(allKeysMem\)/.test(section),
    'with the ingest scoped the two key sets are equal by construction — compare the seals directly')
  assert.ok(!/'allKeys'/.test(section),
    'a scoped ingest needs no allKeys relay — the script already knows every key it measured')
})

// Exercises the shipped CLI, not a reimplementation of it.
const runAssemble = cellsFlag => {
  const dir = mkdtempSync(join(tmpdir(), 'crg-ui-assemble-'))
  const cell = (slug, screen, key) => writeFileSync(join(dir, `${slug}.measure.json`), JSON.stringify({
    screen, breakpoint: 'Desktop', pairs: [],
    discrepancies: [{ id: 'd-001', key, class: 'layout', node: 'n1' }],
  }))
  cell('home-desktop', 'Home', 'Home::Desktop::layout::1:1')
  cell('pricing-desktop', 'Pricing', 'Pricing::Desktop::layout::9:9') // renamed out of the profile
  const profile = join(dir, 'profile.json')
  writeFileSync(profile, JSON.stringify({ project: 'p', screens: [{ name: 'Home', route: '/' }] }))
  const args = ['assemble', dir, '--profile', profile, '--repo-root', dir, '--out', join(dir, 'ledger.json')]
  if (cellsFlag) args.push('--cells', cellsFlag)
  return JSON.parse(execFileSync('node', [toolPath, ...args], { encoding: 'utf8' }))
}

test('assemble --cells drops an orphan capture file the run never measured', () => {
  const scoped = runAssemble('home-desktop')
  assert.equal(scoped.cells, 1)
  assert.equal(scoped.discrepancies, 1, 'the stale Pricing key must not reach the ledger')
  assert.deepEqual(scoped.allKeys, ['Home::Desktop::layout::1:1'])
})

test('assemble without --cells still ingests the whole directory', () => {
  const unscoped = runAssemble(null)
  assert.equal(unscoped.cells, 2)
  assert.notEqual(unscoped.seal, runAssemble('home-desktop').seal,
    'the orphan file changes the seal — which is exactly what --cells exists to prevent')
})
