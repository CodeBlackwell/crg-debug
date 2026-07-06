// Integration-matrix profile validation, in real code.
//   node integrations-profile.mjs validate <profile.json>   (exit 0 ok / 1 with errors on stderr)
//
// The profile is the genericity seam of /crg-integrations: it maps ONE project's
// test runner onto the normalized reference schema (schemaVersion 1) the Workflow's
// deterministic hot-path (clustering, oracle check, judge) runs over. The validator
// enforces the two contracts the Workflow's JS relies on and cannot recover from at
// run time: every command carries the placeholders the Workflow substitutes into it,
// and the fences that keep fixes host-local are present and non-empty.

import { readFileSync } from 'node:fs'

const ADAPTER_KINDS = ['reference', 'command']
// Placeholders the Workflow binds per command. fingerprint takes none.
const COMMAND_PLACEHOLDERS = {
  fullRun: ['{workers}'],
  singleCell: ['{host}', '{grep}'],
  bootHost: ['{host}'],
  regenMatrix: ['{reports}'],
  rebake: ['{host}', '{grep}'],
  fingerprint: [],
}

export function validateProfile(p) {
  const errors = []
  const need = (cond, msg) => { if (!cond) errors.push(msg) }
  need(p && typeof p === 'object', 'profile must be an object')
  if (!p || typeof p !== 'object') return { ok: false, errors }

  need(p.schemaVersion === 1, 'schemaVersion: must be 1 (the normalized reference schema)')
  need(typeof p.project === 'string' && p.project.length > 0, 'project: non-empty string required')
  need(typeof p.cwd === 'string' && p.cwd.length > 0, 'cwd: non-empty string required (runner working dir, repo-relative)')

  const commands = (p && p.commands) || {}
  for (const [name, placeholders] of Object.entries(COMMAND_PLACEHOLDERS)) {
    const cmd = commands[name]
    if (typeof cmd !== 'string' || cmd.length === 0) { errors.push(`commands.${name}: non-empty command required`); continue }
    for (const ph of placeholders) need(cmd.includes(ph), `commands.${name}: must contain the ${ph} placeholder`)
  }
  // The Workflow builds {grep} from grepTemplate by filling these two, so both must be present.
  need(typeof p.grepTemplate === 'string' && p.grepTemplate.includes('{scenario}') && p.grepTemplate.includes('{test}'),
    'grepTemplate: string containing both {scenario} and {test} required')

  const artifacts = (p && p.artifacts) || {}
  for (const key of ['matrix', 'results', 'goldensDir', 'failureArtifactsDir', 'diffPngGlob']) {
    need(typeof artifacts[key] === 'string' && artifacts[key].length > 0, `artifacts.${key}: non-empty path required`)
  }

  const adapter = (p && p.matrixAdapter) || {}
  need(ADAPTER_KINDS.includes(adapter.kind), `matrixAdapter.kind: one of ${ADAPTER_KINDS.join('|')} required`)
  if (adapter.kind === 'command') need(typeof adapter.convert === 'string' && adapter.convert.length > 0,
    'matrixAdapter.convert: required when kind is "command" (the once-at-ingest normalizer)')

  need(typeof p.oracleHost === 'string' && p.oracleHost.length > 0, 'oracleHost: non-empty host name required (the golden oracle)')

  const hosts = (p && p.hosts) || {}
  need(Array.isArray(hosts.underDev), 'hosts.underDev: array required (may be empty)')
  need(hosts.expectedDegradations && typeof hosts.expectedDegradations === 'object' && !Array.isArray(hosts.expectedDegradations),
    'hosts.expectedDegradations: object required (host -> expected-degraded test names)')
  need(hosts.envPerHost && typeof hosts.envPerHost === 'object' && !Array.isArray(hosts.envPerHost),
    'hosts.envPerHost: object required (may be empty)')

  const fences = (p && p.fences) || {}
  need(Array.isArray(fences.allow) && fences.allow.length > 0, 'fences.allow: non-empty glob array required')
  need(Array.isArray(fences.forbid), 'fences.forbid: array required (may be empty)')
  need(Array.isArray(fences.sharedNeedsGate), 'fences.sharedNeedsGate: array required (may be empty)')
  for (const [i, g] of (fences.allow || []).entries()) need(typeof g === 'string' && g.length > 0, `fences.allow[${i}]: non-empty glob string required`)

  const conc = (p && p.concurrency) || {}
  need(Number.isInteger(conc.workers) && conc.workers > 0, 'concurrency.workers: positive integer required')
  need(typeof conc.serializeVerify === 'boolean', 'concurrency.serializeVerify: boolean required')
  need(Number.isInteger(conc.maxParallelFixes) && conc.maxParallelFixes > 0, 'concurrency.maxParallelFixes: positive integer required')

  const flake = (p && p.flakePolicy) || {}
  need(Number.isInteger(flake.isolatedRetries) && flake.isolatedRetries > 0, 'flakePolicy.isolatedRetries: positive integer required')
  need(typeof flake.verdict === 'string' && flake.verdict.length > 0, 'flakePolicy.verdict: non-empty string required')

  const drift = (p && p.drift) || {}
  need(typeof drift.requireFingerprint === 'boolean', 'drift.requireFingerprint: boolean required')
  need(typeof drift.visionFallback === 'boolean', 'drift.visionFallback: boolean required')
  const bar = drift.pixelAsymmetryBar || {}
  for (const key of ['minDiffPct', 'maxDiffPct', 'uniformityMin']) {
    need(typeof bar[key] === 'number', `drift.pixelAsymmetryBar.${key}: number required`)
  }
  if (typeof bar.minDiffPct === 'number' && typeof bar.maxDiffPct === 'number') {
    need(bar.minDiffPct < bar.maxDiffPct, 'drift.pixelAsymmetryBar: minDiffPct must be < maxDiffPct')
  }

  return { ok: errors.length === 0, errors }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'validate') {
    const res = validateProfile(JSON.parse(readFileSync(arg, 'utf8')))
    if (!res.ok) { process.stderr.write(res.errors.join('\n') + '\n'); process.exit(1) }
    process.stdout.write('ok\n')
  } else {
    process.stderr.write('usage: integrations-profile.mjs validate <profile.json>\n')
    process.exit(1)
  }
}
