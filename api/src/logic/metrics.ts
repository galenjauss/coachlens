// PURE: formatting and change detection for student metrics (PRs, grade deltas, time in rank, attendance dots).
import { clip } from './text'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** A metric key as the coach would say it: "bench_press" -> "bench press". */
export const keyLabel = (key: string) => key.replace(/_/g, ' ')

/** Canonical stored key: lower-case words joined by underscores ("Bench Press" -> "bench_press"). */
export function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

const trim = (n: number) => String(Math.round(n * 10) / 10)

/** "225 lb", "88%", or the spoken text when there is no number. */
export function measure(value: string, num: number | null, unit: string | null): string {
  if (num === null) return value
  if (!unit) return trim(num)
  return unit === '%' ? `${trim(num)}%` : `${trim(num)} ${unit}`
}

export const signed = (n: number) => (n === 0 ? '±0' : `${n > 0 ? '+' : '-'}${trim(Math.abs(n))}`)

export type Change = { kind: 'pr'; delta: number } | { kind: 'delta'; delta: number } | null

/**
 * What a new numeric reading means against the earlier ones (oldest first).
 * Grades: the delta vs the last value. Everything else: a PR when it beats every earlier value.
 * The first reading is neither.
 */
export function changeFor(isGrade: boolean, num: number | null, earlier: readonly number[]): Change {
  if (num === null || !earlier.length) return null
  if (isGrade) return { kind: 'delta', delta: num - earlier[earlier.length - 1]! }
  const best = Math.max(...earlier)
  return num > best ? { kind: 'pr', delta: num - best } : null
}

export const changeText = (c: Change) => (c === null ? '' : c.kind === 'pr' ? `PR ${signed(c.delta)}` : signed(c.delta))

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${MONTHS[Number(m) - 1] ?? '?'} ${Number(d)}`
}

const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 86_400_000)

/** "5d", "3 wk", "4 mo", "1y 2mo"; null when there is no start date. */
export function timeInRank(since: string | null, today: string): string | null {
  if (!since) return null
  const days = Math.max(0, dayNumber(today) - dayNumber(since))
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)} wk`
  const months = Math.round(days / 30.4)
  if (months < 12) return `${months} mo`
  const m = months % 12
  return m ? `${Math.floor(months / 12)}y ${m}mo` : `${Math.floor(months / 12)}y`
}

export type Trend = 'steady' | 'improving' | 'dropping'

/** Oldest-first statuses -> "●●○●●●" plus a trend word (latest half vs the earlier half; needs 4+ sessions). */
export function attendanceDots(statuses: readonly ('present' | 'absent')[]): { dots: string; trend: Trend } {
  const dots = statuses.map(s => (s === 'present' ? '●' : '○')).join('')
  if (statuses.length < 4) return { dots, trend: 'steady' }
  const half = Math.floor(statuses.length / 2)
  const rate = (xs: readonly string[]) => xs.filter(x => x === 'present').length / xs.length
  const early = rate(statuses.slice(0, half)), late = rate(statuses.slice(statuses.length - half))
  return { dots, trend: late > early ? 'improving' : late < early ? 'dropping' : 'steady' }
}

/** One metric reading as a card/brief phrase: "deadlift 225 lb (PR +10)". */
export function metricPhrase(key: string, value: string, num: number | null, unit: string | null, change: Change): string {
  const c = changeText(change)
  return `${keyLabel(key)} ${measure(value, num, unit)}${c ? ` (${c})` : ''}`
}

export const isGradeMetric = (modeId: string, unit: string | null) => unit === '%' || modeId === 'tutoring'
export { clip }
