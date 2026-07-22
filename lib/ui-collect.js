// The crg-ui DOM collector — a static browser-side script. Capture agents (or the
// main loop in prose mode) read this file and pass its EXACT contents to
// browser_evaluate; it is never re-derived per run, so every capture collects the
// same data the same way. Output is the RAW dump `ui-measure.mjs normalize-dom`
// canonicalizes — nothing downstream reads it directly.
(() => {
  window.scrollTo(0, 0)
  const attr = document.querySelector('[data-component]') ? 'data-component' : 'data-testid'
  const seen = {}
  const elements = [...document.querySelectorAll('[' + attr + ']')].map(el => {
    const name = el.getAttribute(attr) || ''
    const n = (seen[name] = (seen[name] || 0) + 1)
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return {
      component: name,
      // nth-match keeps duplicates distinguishable in the report; duplicated names
      // are ambiguous for pairing regardless (they land in unmatchedDom).
      selector: '[' + attr + '="' + name + '"]' + (n > 1 ? ':nth-match(' + n + ')' : ''),
      x: rect.x, y: rect.y, width: rect.width, height: rect.height,
      textLength: (el.innerText || '').trim().length, childCount: el.childElementCount,
      fontSize: cs.fontSize, fontFamily: cs.fontFamily, fontWeight: cs.fontWeight,
    }
  })
  const tokens = {}
  const rootStyle = getComputedStyle(document.documentElement)
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue } // cross-origin sheets are opaque
    for (const rule of rules || []) {
      if (!rule.selectorText || !/(^|,)\s*:root\s*(,|$)/.test(rule.selectorText)) continue
      for (const prop of rule.style || []) {
        if (prop.startsWith('--')) tokens[prop] = rootStyle.getPropertyValue(prop).trim()
      }
    }
  }
  return { elements, tokens }
})()
