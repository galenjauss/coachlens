// PURE: text clipping that never cuts mid-word.

/**
 * Trims, collapses whitespace and cuts to at most `max` chars at a word boundary, ending in an ellipsis
 * (or no mark when `ellipsis` is false). A single word longer than `max` is hard-cut.
 */
export function clip(s: string, max: number, ellipsis = true): string {
  const t = s.trim().replace(/\s+/g, ' ')
  if (t.length <= max) return t
  const room = ellipsis ? max - 1 : max
  let cut = t.slice(0, room)
  if (t[room] !== ' ') {
    const sp = cut.lastIndexOf(' ')
    if (sp >= Math.floor(room * 0.4)) cut = cut.slice(0, sp)
  }
  cut = cut.replace(/[\s,;:\-–—(]+$/, '')
  return ellipsis ? `${cut}…` : cut
}
