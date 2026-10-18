/** One line, at most `n` chars, ending in an ellipsis when cut. Only for one-line headers. */
export const clip = (text: string, n: number): string => (text.length <= n ? text : `${text.slice(0, n - 1).trimEnd()}…`)

/**
 * Word-wrap into lines of at most `cols` chars. Nothing is dropped: words longer than a line are
 * hard-broken. With `maxLines`, the last kept line ends in an ellipsis when text was cut.
 */
export function wrap(text: string, cols: number, maxLines = Number.POSITIVE_INFINITY): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean).flatMap(w => {
    const parts: string[] = []
    for (let i = 0; i < w.length; i += cols) parts.push(w.slice(i, i + cols))
    return parts
  })
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    if (cur && cur.length + 1 + w.length <= cols) cur += ` ${w}`
    else { if (cur) lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const out = lines.slice(0, maxLines)
  const last = out[out.length - 1]!
  out[out.length - 1] = last.length < cols ? `${last}…` : `${last.slice(0, cols - 1).trimEnd()}…`
  return out
}

/**
 * The transcript on the agent card spans the full 576 px. Conservative ~14.5 px per char (G2 font,
 * from the 576 px ≈ 40 col history) → 38 columns; 5 lines fit the 164 px transcript container.
 */
export const SAID_COLS = 38
export const SAID_LINES = 5

/** The whole transcript, wrapped and split into pages of SAID_LINES lines (at least one page). */
export function transcriptPages(transcript: string): string[][] {
  const lines = wrap(transcript ? `"${transcript}"` : '(no transcript)', SAID_COLS)
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += SAID_LINES) pages.push(lines.slice(i, i + SAID_LINES))
  return pages.length ? pages : [[]]
}
