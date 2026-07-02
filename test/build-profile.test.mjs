import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProfile, autoApprove, scoreUx } from '../lib/build-profile.mjs'

const goodProfile = () => ({
  app: 'methodproof',
  subrepos: [{ name: 'platform', path: 'methodproof-platform' }],
  boot: { up: 'just up-local' },
  health: [{ name: 'api', url: 'http://localhost:8000/health', expect: 200 }],
  frontends: [
    {
      name: 'dashboard', url: 'http://localhost:5173',
      auth: { kind: 'localStorage', key: 'mp_token', tokenCmd: 'python scripts/local-token.py' },
      identities: ['anon', 'personal'],
    },
    {
      name: 'portal', url: 'http://localhost:5174',
      auth: { kind: 'url-token', tokenCmd: 'mint-session', routeTemplate: '/assess/{token}' },
      identities: ['session'],
    },
  ],
})

test('validateProfile accepts a complete profile', () => {
  assert.deepEqual(validateProfile(goodProfile()), { ok: true, errors: [] })
})

test('validateProfile rejects missing sections with named errors', () => {
  const { ok, errors } = validateProfile({})
  assert.equal(ok, false)
  for (const want of ['app:', 'subrepos:', 'boot.up:', 'health:', 'frontends:']) {
    assert.ok(errors.some(e => e.includes(want)), `expected an error mentioning ${want}`)
  }
})

test('validateProfile enforces auth-kind-specific fields', () => {
  const p = goodProfile()
  delete p.frontends[0].auth.key
  p.frontends[1].auth.routeTemplate = '/assess/fixed' // no {token}
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false)
  assert.ok(errors.some(e => e.includes('auth.key')))
  assert.ok(errors.some(e => e.includes('routeTemplate')))
})

test('validateProfile rejects duplicate frontend ports', () => {
  const p = goodProfile()
  p.frontends[1].url = 'http://localhost:5173'
  const { ok, errors } = validateProfile(p)
  assert.equal(ok, false)
  assert.ok(errors.some(e => e.includes('port 5173 collides')))
})

test('validateProfile requires tokenCmd, never stored tokens', () => {
  const p = goodProfile()
  p.frontends[0].auth.tokenCmd = ''
  assert.equal(validateProfile(p).ok, false)
})

const g = (gapId, over = {}) => ({ gapId, dimension: 'completeness', impact: 'High', effort: 'S', ...over })

test('autoApprove excludes launch-blockers ALWAYS, plus Low impact and L effort', () => {
  const approved = autoApprove([
    g('ok1'),
    g('lb', { dimension: 'launch-blockers' }),
    g('low', { impact: 'Low' }),
    g('big', { effort: 'L' }),
    g('ok2', { impact: 'Medium', effort: 'M' }),
  ])
  assert.deepEqual(approved.map(x => x.gapId), ['ok1', 'ok2'])
})

test('autoApprove honors the cap and preserves rank order deterministically', () => {
  const gaps = Array.from({ length: 20 }, (_, i) => g(`g${i}`))
  const approved = autoApprove(gaps, { cap: 3 })
  assert.deepEqual(approved.map(x => x.gapId), ['g0', 'g1', 'g2'])
  assert.deepEqual(autoApprove(gaps, { cap: 3 }), approved)
  assert.equal(autoApprove(gaps).length, 12, 'default cap is 12')
})

test('scoreUx means agreement, takes MIN on wide disagreement, flags below threshold', () => {
  const a = [{ criterion: 'clarity', score: 4 }, { criterion: 'consistency', score: 5 }, { criterion: 'states', score: 2 }]
  const b = [{ criterion: 'clarity', score: 5 }, { criterion: 'consistency', score: 2 }, { criterion: 'states', score: 3 }]
  const { scores, below } = scoreUx(a, b)
  const byC = Object.fromEntries(scores.map(s => [s.criterion, s.score]))
  assert.equal(byC.clarity, 4.5) // |4-5|<=2 -> mean
  assert.equal(byC.consistency, 2) // |5-2|>2 -> min
  assert.equal(byC.states, 2.5) // mean
  assert.deepEqual(below.sort(), ['consistency', 'states'])
})

test('scoreUx keeps a criterion scored by only one scorer', () => {
  const { scores } = scoreUx([{ criterion: 'copy', score: 5 }], [])
  assert.deepEqual(scores, [{ criterion: 'copy', score: 5 }])
})
