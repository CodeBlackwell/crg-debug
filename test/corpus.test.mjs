import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitHoldout, detectEras, eraOf, buildInventory, estTokens } from '../lib/corpus.mjs'

const pr = (number, reviewer, mergedAt, state = 'merged') => ({
  number, state, author: 'contrib', createdAt: mergedAt, mergedAt,
  reviewers: reviewer ? [reviewer] : [], reviewCount: reviewer ? 1 : 0, files: [],
})

const prs = [
  ...Array.from({ length: 15 }, (_, i) => pr(i + 1, 'alice', `2024-0${(i % 9) + 1}-01`)),
  ...Array.from({ length: 10 }, (_, i) => pr(i + 100, 'bob', `2025-0${(i % 9) + 1}-01`)),
  pr(200, null, '2025-06-01'),              // unreviewed — never held out
  pr(201, 'alice', null, 'closed-unmerged'), // unmerged — never held out
]

test('splitHoldout is deterministic and only holds out reviewed merged PRs', () => {
  const a = splitHoldout(prs, 0.2)
  const b = splitHoldout(prs, 0.2)
  assert.deepEqual(a.holdout, b.holdout)
  assert.equal(a.reviewed, 25)
  assert.ok(a.holdout.length >= 2 && a.holdout.length <= 7)
  assert.ok(!a.holdout.includes(200) && !a.holdout.includes(201))
})

test('splitHoldout draws from every large stratum', () => {
  const { holdout } = splitHoldout(prs, 0.2)
  assert.ok(holdout.some(n => n < 100), 'alice stratum represented')
  assert.ok(holdout.some(n => n >= 100), 'bob stratum represented')
})

test('detectEras + eraOf bucket the timeline into thirds', () => {
  const eras = detectEras(prs.filter(p => p.state === 'merged' && p.reviewers.length))
  assert.equal(eras.length, 2)
  assert.equal(eraOf(pr(1, 'x', '2023-01-01'), eras), 'early')
  assert.equal(eraOf(pr(2, 'x', '2025-12-01'), eras), 'recent')
})

test('buildInventory math and thin-corpus gate', () => {
  const comments = [
    { pr: 1, author: 'alice', body: 'use the model manager here' },
    { pr: 1, author: 'alice', body: 'x'.repeat(400) },
    { pr: 100, author: 'bob', body: 'wrong layer' },
  ]
  const inv = buildInventory({ prs, comments, gitRows: [{}, {}], holdout: [100], minReviewedPRs: 30 })
  assert.equal(inv.reviewedPRs, 25)
  assert.equal(inv.holdoutPRs, 1)
  assert.equal(inv.trainPRs, 24)
  assert.equal(inv.trainReviewComments, 2)
  assert.equal(inv.holdoutReviewComments, 1)
  assert.equal(inv.trainCommentTokens, estTokens(comments[0].body) + 100)
  assert.equal(inv.archaeologyCommits, 2)
  assert.equal(inv.thinCorpus, true)
  assert.equal(inv.maintainerRoster[0].login, 'alice')
  const rich = buildInventory({ prs, comments, gitRows: [], holdout: [], minReviewedPRs: 20 })
  assert.equal(rich.thinCorpus, false)
})
