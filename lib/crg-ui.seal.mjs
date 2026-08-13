// The two crg-ui seal twins, deliberately co-located. Each has a byte-identical copy
// inside a Workflow's pure-helpers block — `sealOf` in workflows/crg-ui.js, `itemsSeal`
// in workflows/crg-ui-prep.js — because the sandbox forbids imports and a script must
// be able to recompute a relayed seal itself. Keeping both twins in one small module
// makes the two-place edit obvious: change a body here, change the workflow copy too.
// Parity tests enforce it. This module imports nothing, so every tool can depend on it.

// FNV-1a 32-bit over the sorted keys. Not cryptographic — it detects accidental
// truncation/paraphrase when tool output travels through an agent relay. MUST stay
// byte-identical to the sealOf in workflows/crg-ui.js's pure-helpers (parity-tested).
export const sealOf = keys => {
  const s = [...(keys || [])].sort().join('\n')
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

// Seal over "id=status" of the scorecard rows. MUST stay byte-identical to the
// itemsSeal in workflows/crg-ui-prep.js's pure-helpers (parity-tested).
export const itemsSeal = items =>
  sealOf(Object.entries(items || {}).map(([id, it]) => `${id}=${(it && it.status) || 'unknown'}`))
