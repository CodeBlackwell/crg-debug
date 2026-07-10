import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProfile, parseFrameName, inferBreakpoint, pairFrames, pollUntilUp, blessEntry } from '../lib/ui-map.mjs'

const goodProfile = () => ({
  schemaVersion: 1,
  project: 'demo',
  figma: { fileKey: 'abc123' },
  stack: { framework: 'react', devCommand: 'npm run dev', devUrl: 'http://localhost:5173', readyTimeoutSec: 60 },
  mode: 'desktop-only',
  breakpoints: [{ name: 'desktop', width: 1440, height: 900 }],
  screens: [{ name: 'Home', route: '/', frames: { desktop: '1:100' } }],
  tolerance: { geometryPx: 1 },
  fences: { allow: ['src/**'], forbid: [] },
  intentionalDeviations: [],
})

test('validateProfile accepts the reference shape', () => {
  assert.deepEqual(validateProfile(goodProfile()), { ok: true, errors: [] })
})

test('validateProfile rejects the contracts the workflow cannot recover from', () => {
  const cases = [
    [p => delete p.figma.fileKey, /figma\.fileKey/],
    [p => (p.mode = 'kiosk'), /mode/],
    [p => (p.screens[0].frames = { tablet: '1:1' }), /unknown breakpoint/],
    [p => (p.screens[0].route = 'home'), /route starting with \//],
    [p => (p.fences.allow = []), /fences\.allow/],
    [p => delete p.intentionalDeviations, /intentionalDeviations/],
    [p => (p.stack.framework = 'angular'), /stack\.framework/],
    [p => (p.tolerance.geometryPx = 0), /geometryPx/],
  ]
  for (const [mutate, rx] of cases) {
    const p = goodProfile()
    mutate(p)
    const res = validateProfile(p)
    assert.equal(res.ok, false)
    assert.ok(res.errors.some(e => rx.test(e)), `expected an error matching ${rx}: ${res.errors.join(' | ')}`)
  }
})

// ---- frame name parsing + breakpoint inference -----------------------------------

test('parseFrameName splits screen from breakpoint label', () => {
  assert.deepEqual(parseFrameName('Home / Desktop 1440'), { screen: 'Home', label: 'desktop 1440' })
  assert.deepEqual(parseFrameName('Settings / Profile / Mobile 375'), { screen: 'Settings / Profile', label: 'mobile 375' })
  assert.deepEqual(parseFrameName('Homepage v3 FINAL'), { screen: 'Homepage v3 FINAL', label: '' })
})

const BPS = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 375, height: 812 }]

test('inferBreakpoint: name hit wins, width is fallback, ambiguity returns null', () => {
  assert.deepEqual(inferBreakpoint('desktop 1440', 375, BPS), { name: 'desktop', confidence: 'name' }, 'name beats width')
  assert.deepEqual(inferBreakpoint('', 375, BPS), { name: 'mobile', confidence: 'width' })
  assert.equal(inferBreakpoint('web final', 800, BPS), null)
})

test('pairFrames pairs the convention and surfaces the orphans with reasons', () => {
  const frames = [
    { id: '1:100', name: 'Home / Desktop 1440', width: 1440, height: 900 },
    { id: '1:101', name: 'Home / Mobile', width: 375, height: 812 },
    { id: '1:102', name: 'Homepage v3 FINAL', width: 1440, height: 900 },
    { id: '1:103', name: 'Pricing / Web', width: 800, height: 600 },
  ]
  const { paired, unmatched } = pairFrames(frames, BPS, ['Home', 'Pricing'])
  assert.deepEqual(paired.map(p => [p.screen, p.breakpoint, p.confidence]),
    [['Home', 'desktop', 'name'], ['Home', 'mobile', 'name']])
  assert.equal(unmatched.length, 2)
  assert.ok(unmatched.find(u => u.nodeId === '1:103').reason.includes('no breakpoint match'))
})

test('pairFrames with no declared screens accepts any screen segment', () => {
  const { paired } = pairFrames([{ id: '9:1', name: 'Anything / Desktop', width: 1440, height: 900 }], BPS, [])
  assert.equal(paired.length, 1)
  assert.equal(paired[0].screen, 'Anything')
})

// ---- dev-server readiness ------------------------------------------------------------

test('pollUntilUp returns as soon as the probe answers', async () => {
  let calls = 0
  const probe = async () => ++calls >= 3
  const res = await pollUntilUp(probe, { timeoutSec: 60, intervalSec: 0.001, sleep: () => Promise.resolve() })
  assert.deepEqual(res, { up: true })
  assert.equal(calls, 3)
})

test('pollUntilUp times out with the last error preserved', async () => {
  const probe = async () => { throw new Error('ECONNREFUSED') }
  const res = await pollUntilUp(probe, { timeoutSec: 0, sleep: () => Promise.resolve() })
  assert.equal(res.up, false)
  assert.match(res.lastError, /ECONNREFUSED/)
})

// ---- deviation blessing ----------------------------------------------------------------

test('blessEntry appends to the profile and mirrors the whole list to the allowlist', () => {
  const profile = { intentionalDeviations: [{ class: 'layout', figmaNodeId: '1:1', reason: 'old' }] }
  const entry = { screen: 'Home', class: 'token', token: 'color/primary', reason: 'brand exception' }
  const res = blessEntry(profile, entry)
  assert.equal(res.ok, true)
  assert.equal(res.profile.intentionalDeviations.length, 2)
  assert.deepEqual(res.allowlist, res.profile.intentionalDeviations, 'allowlist is always the full profile list')
  assert.equal(profile.intentionalDeviations.length, 1, 'input profile is not mutated')
})

test('blessEntry rejects entries without a subject or a reason', () => {
  assert.equal(blessEntry({}, { class: 'token', token: 'x' }).ok, false, 'no reason')
  assert.equal(blessEntry({}, { class: 'layout', reason: 'r' }).ok, false, 'no subject')
  assert.ok(blessEntry({}, null).errors.length)
})
