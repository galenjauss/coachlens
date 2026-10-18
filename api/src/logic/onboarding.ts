// PURE: normalizes what the onboarding extractor returns into strict drafts. No I/O.
import { ClassDraft, CurriculumWeekDraft, StudentDraft, YMD, type ModeId } from '@matside/shared'
import { z } from 'zod'
import { weekStart } from './dates'

/** Case/space-insensitive key used for idempotent matching by name. */
export const nameKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

/** 0-6, or a day name ("Tuesday", "tues", "Thu"), to 0 = Sunday … 6 = Saturday; null if unknown. */
export function normalizeWeekday(v: unknown): number | null {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 && v <= 6 ? v : v === 7 ? 0 : null
  if (typeof v !== 'string') return null
  const t = v.trim().toLowerCase()
  if (/^\d$/.test(t)) return normalizeWeekday(Number(t))
  const i = DAYS.indexOf(t.slice(0, 3))
  return i >= 0 ? i : null
}

/** "17:00", "5pm", "5:30 PM", "0930" → "HH:MM" (24h); null if unreadable. */
export function normalizeTime(v: string): string | null {
  const t = v.trim().toLowerCase().replace(/\./g, '')
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const ap = m[3]?.[0]
  if (min > 59) return null
  if (ap) {
    if (h < 1 || h > 12) return null
    if (ap === 'p' && h !== 12) h += 12
    if (ap === 'a' && h === 12) h = 0
  }
  if (h > 23) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const clip = (s: string | null | undefined, n: number): string | null => {
  const t = (s ?? '').trim().replace(/\s+/g, ' ')
  return t ? t.slice(0, n) : null
}
const isEmail = (s: string) => z.email().safeParse(s).success

// Loose shapes the model fills in (structured output); every field required, nullable where unknown.
export const RawClasses = z.object({
  classes: z.array(z.object({ name: z.string(), weekday: z.string(), startTime: z.string(), mode: z.string().nullable() })),
  notes: z.string(),
})
export const RawRoster = z.object({
  students: z.array(z.object({
    name: z.string(), nickname: z.string().nullable(), level: z.string().nullable(), age: z.number().nullable(),
    guardianName: z.string().nullable(), guardianEmail: z.string().nullable(), classNames: z.array(z.string()),
  })),
  notes: z.string(),
})
export const RawCurriculum = z.object({
  weeks: z.array(z.object({ week: z.number(), weekStart: z.string().nullable(), theme: z.string(), itemsDue: z.array(z.string()) })),
  notes: z.string(),
})

export interface Cleaned<T> { items: T[]; dropped: string[] }

export function cleanClasses(raw: z.infer<typeof RawClasses>, fallbackMode: ModeId, modes: readonly string[]): Cleaned<ClassDraft> {
  const items: ClassDraft[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const c of raw.classes.slice(0, 30)) {
    const name = clip(c.name, 60)
    const weekday = normalizeWeekday(c.weekday)
    const startTime = normalizeTime(c.startTime)
    if (!name || weekday === null || !startTime) { dropped.push(name ?? 'unnamed class'); continue }
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    const mode = (c.mode && modes.includes(c.mode) ? c.mode : fallbackMode) as ModeId
    items.push(ClassDraft.parse({ name, weekday, startTime, mode }))
  }
  return { items, dropped }
}

export function cleanRoster(raw: z.infer<typeof RawRoster>): Cleaned<StudentDraft> {
  const items: StudentDraft[] = []
  const dropped: string[] = []
  const seen = new Set<string>()
  for (const s of raw.students.slice(0, 300)) {
    const name = clip(s.name, 80)
    if (!name) continue
    const key = nameKey(name)
    if (seen.has(key)) continue
    seen.add(key)
    const email = clip(s.guardianEmail, 120)?.toLowerCase() ?? null
    if (email && !isEmail(email)) dropped.push(`${name}: unreadable email "${email}"`)
    const age = s.age !== null && Number.isInteger(s.age) && s.age >= 2 && s.age <= 99 ? s.age : null
    items.push(StudentDraft.parse({
      name,
      nickname: clip(s.nickname, 40),
      level: clip(s.level, 40),
      age,
      guardianName: clip(s.guardianName, 80),
      guardianEmail: email && isEmail(email) ? email : null,
      classNames: [...new Set(s.classNames.map(n => clip(n, 60)).filter((n): n is string => Boolean(n)))].slice(0, 30),
    }))
  }
  return { items, dropped }
}

export function cleanCurriculum(raw: z.infer<typeof RawCurriculum>): Cleaned<CurriculumWeekDraft> {
  const items: CurriculumWeekDraft[] = []
  const dropped: string[] = []
  for (const w of raw.weeks.slice(0, 52)) {
    const theme = clip(w.theme, 80)
    if (!theme) continue
    const week = Number.isInteger(w.week) && w.week >= 1 && w.week <= 52 ? w.week : items.length + 1
    const date = w.weekStart && YMD.test(w.weekStart) && !Number.isNaN(Date.parse(w.weekStart)) ? weekStart(w.weekStart) : null
    items.push(CurriculumWeekDraft.parse({
      week, weekStart: date, theme,
      itemsDue: w.itemsDue.map(i => clip(i, 80)).filter((i): i is string => Boolean(i)).slice(0, 10),
    }))
  }
  return { items, dropped }
}

/** Joins the model's own notes with what normalization had to drop. */
export function mergeNotes(modelNotes: string, dropped: string[], label: string): string {
  const parts = [modelNotes.trim()]
  if (dropped.length) parts.push(`Skipped ${dropped.length} ${label} I couldn't read fully: ${dropped.slice(0, 5).join('; ')}${dropped.length > 5 ? '…' : ''}`)
  return parts.filter(Boolean).join(' ').slice(0, 600)
}

/**
 * Text-only extracts: an email the model returns must appear in the pasted text (case-insensitive),
 * otherwise it is treated as invented and nulled. Returns how many were removed.
 */
export function groundEmails(items: StudentDraft[], text: string): { items: StudentDraft[]; removed: number } {
  const hay = text.toLowerCase()
  let removed = 0
  const out = items.map(s => {
    if (!s.guardianEmail || hay.includes(s.guardianEmail.toLowerCase())) return s
    removed++
    return { ...s, guardianEmail: null }
  })
  return { items: out, removed }
}
