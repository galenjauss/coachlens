// PURE: a glanceable (<= 4 lines, <= 38 chars each) summary of how a plan changed, for the glasses.
import { VOICE_LINE_MAX, VOICE_LINES_MAX } from '@matside/shared'
import { clip } from './text'

export type SummaryDrill = { id: string; name: string; minutes: number }

const ORD = ['1st', '2nd', '3rd']
const ordinal = (n: number) => ORD[n - 1] ?? `${n}th`

/** `<prefix><name><suffix>` with the name word-trimmed so the whole line fits the budget. */
function fit(prefix: string, name: string, suffix = ''): string {
  const room = VOICE_LINE_MAX - prefix.length - suffix.length
  return `${prefix}${clip(name, Math.max(room, 4))}${suffix}`
}

/** Indices (into `seq`) of one longest strictly increasing subsequence; everything else is "moved". */
function stayers(seq: number[]): Set<number> {
  const best: number[] = [] // best[i] = length of LIS ending at i
  const prev: number[] = []
  let end = -1
  seq.forEach((v, i) => {
    best[i] = 1; prev[i] = -1
    for (let j = 0; j < i; j++) if (seq[j]! < v && best[j]! + 1 > best[i]!) { best[i] = best[j]! + 1; prev[i] = j }
    if (end < 0 || best[i]! > best[end]!) end = i
  })
  const keep = new Set<number>()
  for (let i = end; i >= 0; i = prev[i]!) keep.add(i)
  return keep
}

/** Added, removed, re-timed/renamed and reordered items, by drill id, as short lines. More than 4 changes end in "+N more". */
export function diffSummary(before: readonly SummaryDrill[], after: readonly SummaryDrill[]): string[] {
  const was = new Map(before.map(d => [d.id, d]))
  const now = new Map(after.map(d => [d.id, d]))
  const lines: string[] = []
  for (const d of after) if (!was.has(d.id)) lines.push(fit('+ ', d.name, ` ${d.minutes}m`))
  for (const d of before) if (!now.has(d.id)) lines.push(fit('- ', d.name))
  for (const d of after) {
    const o = was.get(d.id)
    if (!o) continue
    if (o.name !== d.name) lines.push(fit('~ ', d.name, o.minutes !== d.minutes ? ` ${o.minutes}→${d.minutes}m` : ' renamed'))
    else if (o.minutes !== d.minutes) lines.push(fit('~ ', d.name, ` ${o.minutes}→${d.minutes}m`))
  }
  // Reorder: among items present on both sides, those outside the longest in-order run were moved.
  const common = before.filter(d => now.has(d.id)).map(d => d.id)
  const afterCommon = after.filter(d => was.has(d.id))
  const seq = afterCommon.map(d => common.indexOf(d.id))
  const keep = stayers(seq)
  afterCommon.forEach((d, i) => {
    if (!keep.has(i)) lines.push(fit('↕ ', d.name, ` moved to ${ordinal(after.findIndex(x => x.id === d.id) + 1)}`))
  })
  if (lines.length <= VOICE_LINES_MAX) return lines
  return [...lines.slice(0, VOICE_LINES_MAX - 1), `+${lines.length - (VOICE_LINES_MAX - 1)} more`]
}
