/**
 * Lens text budgets. The G2 font averages ≤ 14.5 px per char (conservative: 576 px ≈ 39 cols), and a
 * text line needs ~30 px (+4 px padding); a bordered container loses ~8 px each side to its frame.
 */
export const PX_PER_CHAR = 14.5
export const LINE_PX = 30

/** Chars that safely fit on one line of a container `w` px wide. */
export const colsFor = (w: number, border = false): number => Math.floor((w - (border ? 16 : 0)) / PX_PER_CHAR)
/** Lines that fit in a container `h` px tall (at least one). */
export const rowsFor = (h: number, border = false): number => Math.max(1, Math.floor((h - (border ? 8 : 4)) / LINE_PX))

/**
 * Word-wrap into lines of at most `cols` chars. Nothing is dropped: only a single word longer than a
 * whole line is hard-broken. With `maxLines`, the last kept line ends in an ellipsis when text was cut,
 * always at a word boundary (a trailing word is dropped to make room for the ellipsis, never split).
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
  out[out.length - 1] = withEllipsis(out[out.length - 1]!, cols)
  return out
}

/** `line…` within `cols`, dropping whole trailing words (never splitting one) to make room. */
function withEllipsis(line: string, cols: number): string {
  let words = line.split(' ')
  while (words.join(' ').length + 1 > cols && words.length > 1) words = words.slice(0, -1)
  const kept = words.join(' ').replace(/[\s·,:;-]+$/, '')
  return kept.length + 1 <= cols ? `${kept}…` : `${kept.slice(0, cols - 1)}…` // a lone over-long word: unavoidable
}

/** One line, at most `n` chars, cut only at a word boundary (ellipsis when cut). */
export const clip = (text: string, n: number): string => wrap(text, n, 1)[0] ?? ''

/** `text` clipped at a word boundary so that `text + suffix` fits `cols` (the suffix, e.g. a time, is never cut). */
export function clipWithSuffix(text: string, suffix: string, cols: number): string {
  const room = cols - suffix.length
  if (room < 4) return clip(`${text}${suffix}`, cols)
  return `${clip(text, room)}${suffix}`
}

/** Remove the words of `drop` (e.g. the mode label) from `text`, tidying the separators left behind. */
function without(text: string, drop: string): string {
  const words = new Set(drop.toLowerCase().split(/\s+/).filter(Boolean))
  return text.split(/\s+/).filter(w => !words.has(w.toLowerCase())).join(' ')
    .replace(/(\s*·\s*)+/g, ' · ').replace(/^\s*·\s*|\s*·\s*$/g, '').trim()
}

/**
 * The class line: theme first, then class. Tries "THEME · Class", then the class without its mode
 * word, then the class's first part, then the theme alone; finally the theme cut at a word boundary.
 */
export function classHeader(theme: string, className: string, modeLabel: string, cols: number): string {
  const t = theme.toUpperCase()
  if (!t) return clip(className, cols)
  const bare = without(className, modeLabel)
  const first = bare.split(' · ')[0] ?? ''
  const candidates = [className, bare, first].filter(Boolean).map(c => `${t} · ${c}`)
  return candidates.find(c => c.length <= cols) ?? clip(t, cols)
}

/**
 * The transcript on the agent card spans the full 576 px (bordered): 38 columns; 5 lines fit the
 * 164 px transcript container.
 */
export const SAID_COLS = colsFor(576, true)
export const SAID_LINES = 5

/** Split lines into pages of `size` lines (at least one, possibly empty, page). */
export function paginate(lines: string[], size: number): string[][] {
  const pages: string[][] = []
  for (let i = 0; i < lines.length; i += size) pages.push(lines.slice(i, i + size))
  return pages.length ? pages : [[]]
}

/** The whole transcript, wrapped and split into pages of SAID_LINES lines (at least one page). */
export function transcriptPages(transcript: string): string[][] {
  return paginate(wrap(transcript ? `"${transcript}"` : '(no transcript)', SAID_COLS), SAID_LINES)
}

/**
 * Names joined with ", " within `room` chars. `more` (default): names that don't fit become "+N", and
 * "N kids" when even one doesn't. Without it, the names that don't fit are simply left out (the
 * list is shown in full elsewhere); "N kids" when even the first doesn't fit.
 */
export function fitNames(names: readonly string[], room: number, more = true): string {
  for (let k = names.length; k >= 1; k--) {
    const shown = `${names.slice(0, k).join(', ')}${k < names.length && more ? ` +${names.length - k}` : ''}`
    if (shown.length <= room) return shown
  }
  return `${names.length} ${names.length === 1 ? 'kid' : 'kids'}`
}
