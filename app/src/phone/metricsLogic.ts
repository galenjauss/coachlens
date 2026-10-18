// PURE: grouping and text sparklines for a student's metrics (phone StudentDetail).
import type { StudentMetric } from '@matside/shared'

export const keyLabel = (key: string) => key.replace(/_/g, ' ')

/** "225 lb", "88%", or the spoken value when there is no number. */
export function reading(m: Pick<StudentMetric, 'value' | 'num' | 'unit'>): string {
  if (m.num === null) return m.value
  const n = String(Math.round(m.num * 10) / 10)
  return !m.unit ? n : m.unit === '%' ? `${n}%` : `${n} ${m.unit}`
}

const BARS = '▁▂▃▄▅▆▇█'
/** One block per reading, oldest first; flat history sits mid-height. Needs 2+ numbers, else ''. */
export function sparkline(nums: readonly number[]): string {
  if (nums.length < 2) return ''
  const lo = Math.min(...nums), hi = Math.max(...nums)
  return nums.map(n => (hi === lo ? BARS[3]! : BARS[Math.round(((n - lo) / (hi - lo)) * (BARS.length - 1))]!)).join('')
}

export interface MetricGroup {
  key: string
  label: string
  latest: StudentMetric
  /** Newest first, as listed. */
  history: StudentMetric[]
  spark: string
  /** Latest number minus the one before it, when both exist. */
  delta: number | null
  /** True when the latest number beats every earlier one (and there is an earlier one). */
  best: boolean
}

/** Metrics grouped by key, groups ordered by most recent reading. Input is newest first. */
export function groupMetrics(metrics: readonly StudentMetric[]): MetricGroup[] {
  const by = new Map<string, StudentMetric[]>()
  for (const m of metrics) by.set(m.key, [...(by.get(m.key) ?? []), m])
  return [...by.entries()].map(([key, history]) => {
    const nums = history.map(h => h.num).filter((n): n is number => n !== null).reverse() // oldest first
    const latestNum = history[0]!.num
    const prev = nums.length >= 2 ? nums[nums.length - 2]! : null
    const earlierBest = nums.length >= 2 ? Math.max(...nums.slice(0, -1)) : null
    return {
      key, label: keyLabel(key), latest: history[0]!, history, spark: sparkline(nums.slice(-8)),
      delta: latestNum !== null && prev !== null ? Math.round((latestNum - prev) * 10) / 10 : null,
      best: latestNum !== null && earlierBest !== null && latestNum > earlierBest,
    }
  })
}

export const signedDelta = (d: number) => (d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${Math.abs(d)}`)

export type CustomFieldDraft = { key: string; value: string; num: string; unit: string }
/** Validates the "Add a custom field" form; a number, if given, must parse. A bare number doubles as the value. */
export function parseCustomField(d: CustomFieldDraft): { ok: true; body: { key: string; value: string; num: number | null; unit: string | null } } | { ok: false; error: string } {
  const key = d.key.trim()
  if (!key) return { ok: false, error: 'Give the field a name.' }
  const numText = d.num.trim()
  const num = numText === '' ? null : Number(numText)
  if (num !== null && !Number.isFinite(num)) return { ok: false, error: 'The number needs to be a number.' }
  const unit = d.unit.trim() || null
  const value = d.value.trim() || (num === null ? '' : `${num}${unit ? ` ${unit}` : ''}`)
  if (!value) return { ok: false, error: 'Add a value or a number.' }
  return { ok: true, body: { key, value, num, unit } }
}

export const isoDate = (iso: string) => iso.slice(0, 10)
