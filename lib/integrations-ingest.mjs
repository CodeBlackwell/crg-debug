#!/usr/bin/env node
// Deterministic matrix ingest for crg-integrations. Reads a reference-shape
// matrix (schemaVersion 1: {fingerprint?, hosts:[{id, scenarios:[{id, status,
// tests:[{name, status, error?}]}]}]}) and prints a COMPACT summary to stdout:
//
//   {
//     fingerprint,                       // "" if absent
//     hostCounts: { <hostId>: {pass, fail, partial, skipped, notrun, other} },
//     redGroups: [ { host, testName, error, count, scenarios[<=5] } ],
//   }
//
// redGroups collapses failing (scenario x test) cells by (host, test name,
// error prefix) — cells sharing those fail the same way, so downstream flake
// retries and clustering operate on one representative per group. This tool
// exists so no agent ever relays bulk matrix rows through model output (they
// truncate); an agent RUNS this and returns its already-small JSON.
//
// Usage: node integrations-ingest.mjs <matrix.json path>
import { readFileSync } from 'node:fs'

const ERROR_PREFIX_LEN = 80
const MAX_SAMPLE_SCENARIOS = 5

export function ingestMatrix(matrix) {
  const hostCounts = {}
  const groups = new Map()
  for (const h of matrix.hosts || []) {
    const counts = { pass: 0, fail: 0, partial: 0, skipped: 0, notrun: 0, other: 0 }
    for (const s of h.scenarios || []) {
      const status = String(s.status || '')
      if (status in counts) counts[status]++
      else counts.other++
      for (const t of s.tests || []) {
        if (t.status !== 'fail') continue
        const error = String(t.error || '')
        const key = `${h.id}::${t.name}::${error.slice(0, ERROR_PREFIX_LEN)}`
        if (!groups.has(key)) groups.set(key, { host: h.id, testName: t.name, error, count: 0, scenarios: [] })
        const g = groups.get(key)
        g.count++
        if (g.scenarios.length < MAX_SAMPLE_SCENARIOS) g.scenarios.push(s.id)
      }
    }
    hostCounts[h.id] = counts
  }
  return { fingerprint: String(matrix.fingerprint || ''), hostCounts, redGroups: [...groups.values()] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2]
  if (!path) { console.error('usage: integrations-ingest.mjs <matrix.json>'); process.exit(1) }
  let matrix
  try {
    matrix = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    console.error(`unreadable matrix at ${path}: ${e.message}`)
    process.exit(1)
  }
  if (!Array.isArray(matrix.hosts)) { console.error('matrix-invalid: no hosts[] array'); process.exit(1) }
  process.stdout.write(JSON.stringify(ingestMatrix(matrix)) + '\n')
}
