// Dev-server readiness polling, lifted out of lib/crg-ui.map.mjs so that file stays about
// Figma frame pairing and profile validation. The `waitup` CLI subcommand deliberately
// stays in crg-ui.map.mjs — skills/crg-ui invokes it as `node crg-ui.map.mjs waitup <url>`
// and that path is a frozen contract.

// Poll until probeFn resolves truthy or the deadline passes. probeFn is injected so
// the loop is testable without a network; the CLI wires in a real fetch probe.
export async function pollUntilUp(probeFn, { timeoutSec, intervalSec = 5, sleep } = {}) {
  const wait = sleep || (ms => new Promise(r => setTimeout(r, ms)))
  const deadline = Date.now() + timeoutSec * 1000
  let lastError = 'no probe attempted'
  for (;;) {
    try {
      if (await probeFn()) return { up: true }
    } catch (e) {
      lastError = String((e && e.message) || e)
    }
    if (Date.now() >= deadline) return { up: false, lastError }
    await wait(intervalSec * 1000)
  }
}
