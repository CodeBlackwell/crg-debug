// The ready packet: the handshake /crg-ui's Stage 0 accepts without asking a single
// question. buildPacket refuses to emit one while a profile-critical item is open;
// verifyPacket re-derives the seal from the LIVE files so any later drift in profile,
// allowlist, settled items, or pairing is caught instead of trusted.
// No CLI of its own — lib/crg-ui.prep.mjs dispatches packet and verify-packet.

import { validateUiProfile, pairFrames } from './crg-ui.map.mjs'
import { sealOf } from './crg-ui.seal.mjs'

// The seal covers everything /crg-ui relies on, recomputed from the LIVE files at
// verify time — any drift in profile, allowlist, settled items, or pairing breaks it.
export const packetSealLines = ({ profile, allowlist, items, pairing }) => [
  `profile:${JSON.stringify(profile)}`,
  `allowlist:${JSON.stringify(allowlist)}`,
  ...Object.entries(items || {}).map(([id, it]) => `${id}=${it.status}`),
  pairing ? `pairing:${pairing.paired.length}/${pairing.unmatched.length}` : 'pairing:none',
]

// Items whose absence re-opens GATE-PROFILE questions or breaks measurement. Open
// gaps OUTSIDE this set ride along in the packet as openGaps — visible, not blocking.
export const PROFILE_CRITICAL = ['1.1', '1.2', '1.3', '2.1', '2.2', '2.3', '2.5', '2.6', 'E1', 'E2', 'E3', 'E5']

export function buildPacket({ profile, allowlist, prep, frames }) {
  const errors = []
  const v = validateUiProfile(profile)
  if (!v.ok) errors.push(...v.errors.map(e => `profile: ${e}`))
  const open = Object.entries((prep && prep.items) || {}).filter(([, it]) => it.status === 'gap' || it.status === 'unknown')
  const blocking = open.filter(([id]) => PROFILE_CRITICAL.includes(id))
  if (blocking.length) errors.push(`profile-critical items still open (gap/unknown): ${blocking.map(([id]) => id).join(', ')} — gate them (done) or descope them first`)
  const pairing = frames ? pairFrames(frames, profile.breakpoints || [], (profile.screens || []).map(s => s.name)) : null
  if (pairing) {
    for (const s of profile.screens || []) {
      if (!pairing.paired.some(p => p.screen.toLowerCase() === s.name.toLowerCase())) errors.push(`pairing: screen "${s.name}" has no matching frame in frames.json`)
    }
  }
  if (errors.length) return { ok: false, errors }
  const items = (prep && prep.items) || {}
  return {
    ok: true,
    packet: {
      schemaVersion: 1,
      project: profile.project,
      figmaFileKey: profile.figma && profile.figma.fileKey,
      openGaps: open.map(([id]) => id),
      attestations: items,
      answers: (prep && prep.answers) || {},
      pairing: pairing ? { paired: pairing.paired.length, unmatched: pairing.unmatched.length } : null,
      seal: sealOf(packetSealLines({ profile, allowlist, items, pairing })),
    },
  }
}

export function verifyPacket({ packet, profile, allowlist, prep, frames }) {
  const reasons = []
  if (!packet || packet.schemaVersion !== 1) return { ok: false, reasons: ['no prep-packet.json (schemaVersion 1) — run /crg-ui-prep'] }
  if (!profile) reasons.push('profile.json missing')
  else {
    const v = validateUiProfile(profile)
    if (!v.ok) reasons.push(...v.errors.map(e => `profile: ${e}`))
  }
  const items = (prep && prep.items) || {}
  const pairing = frames && profile ? pairFrames(frames, profile.breakpoints || [], (profile.screens || []).map(s => s.name)) : null
  if (profile && sealOf(packetSealLines({ profile, allowlist, items, pairing })) !== packet.seal) {
    reasons.push('seal mismatch — profile, allowlist, prep items, or pairing changed since the packet was assembled; re-run prep')
  }
  return { ok: reasons.length === 0, reasons }
}
