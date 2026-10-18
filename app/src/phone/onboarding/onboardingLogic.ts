// PURE onboarding quiz logic: draft state, merging AI proposals, table edits, class assignment, commit building.
import {
  MODES, OnboardingCommit, type ClassDraft, type CurriculumWeekDraft, type ModeId, type OnboardingStep, type StudentDraft,
} from '@matside/shared'
import { ApiError, NetworkError } from '../../core/api'

export type StepId = 'mode' | 'basics' | 'classes' | 'roster' | 'curriculum' | 'review'
export const STEPS: readonly { id: StepId; title: string; short: string }[] = [
  { id: 'mode', title: 'What do you teach?', short: 'Type' },
  { id: 'basics', title: 'The basics', short: 'Basics' },
  { id: 'classes', title: 'Classes & schedule', short: 'Classes' },
  { id: 'roster', title: 'Roster', short: 'Roster' },
  { id: 'curriculum', title: 'Curriculum', short: 'Plan' },
  { id: 'review', title: 'Review & confirm', short: 'Review' },
]
export type UploadStep = Extract<OnboardingStep, 'classes' | 'roster' | 'curriculum'>

export const DEFAULT_TIME_ZONE = 'America/Los_Angeles'
export const TIME_ZONES = [
  'America/Los_Angeles', 'America/Denver', 'America/Phoenix', 'America/Chicago', 'America/New_York', 'America/Anchorage',
  'Pacific/Honolulu', 'America/Toronto', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney',
] as const
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export type ClassRow = ClassDraft & { key: string }
export type StudentRow = StudentDraft & { key: string }
export type WeekRow = CurriculumWeekDraft & { key: string }

export interface Draft {
  mode: ModeId | null
  basics: { schoolName: string; coachName: string; timeZone: string }
  classes: ClassRow[]
  students: StudentRow[]
  weeks: WeekRow[]
  notes: Partial<Record<UploadStep, string>>
}

let seq = 0
/** Row keys only need to be unique within one session. */
export const newKey = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export const nameKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

export function initialDraft(timeZone: string = DEFAULT_TIME_ZONE): Draft {
  return { mode: null, basics: { schoolName: '', coachName: '', timeZone }, classes: [], students: [], weeks: [], notes: {} }
}

export function setMode(d: Draft, mode: ModeId): Draft {
  // Classes still on the old default follow the new mode.
  return { ...d, mode, classes: d.classes.map(c => (d.mode && c.mode === d.mode ? { ...c, mode } : c)) }
}

// ---- merging AI proposals (several uploads accumulate) ----

export function mergeClasses(rows: readonly ClassRow[], incoming: readonly ClassDraft[]): ClassRow[] {
  const out = [...rows]
  for (const c of incoming) {
    const i = out.findIndex(r => nameKey(r.name) === nameKey(c.name))
    if (i >= 0) out[i] = { ...out[i]!, ...c }
    else out.push({ ...c, key: newKey('c') })
  }
  return out
}

/** Same name → fill gaps only (never erase what the coach or an earlier upload found); classes are unioned. */
export function mergeStudents(rows: readonly StudentRow[], incoming: readonly StudentDraft[]): StudentRow[] {
  const out = [...rows]
  for (const s of incoming) {
    const i = out.findIndex(r => nameKey(r.name) === nameKey(s.name))
    if (i < 0) { out.push({ ...s, key: newKey('s') }); continue }
    const r = out[i]!
    out[i] = {
      ...r,
      nickname: r.nickname ?? s.nickname,
      level: r.level ?? s.level,
      age: r.age ?? s.age,
      guardianName: r.guardianName ?? s.guardianName,
      guardianEmail: r.guardianEmail ?? s.guardianEmail,
      classNames: unionNames(r.classNames, s.classNames),
    }
  }
  return out
}

/** Same week number → replaced by the newer proposal; sorted by week. */
export function mergeWeeks(rows: readonly WeekRow[], incoming: readonly CurriculumWeekDraft[]): WeekRow[] {
  const out = [...rows]
  for (const w of incoming) {
    const i = out.findIndex(r => r.week === w.week)
    if (i >= 0) out[i] = { ...out[i]!, ...w }
    else out.push({ ...w, key: newKey('w') })
  }
  return out.sort((a, b) => a.week - b.week)
}

function unionNames(a: readonly string[], b: readonly string[]): string[] {
  const out = [...a]
  for (const n of b) if (!out.some(x => nameKey(x) === nameKey(n))) out.push(n)
  return out
}

// ---- table edits (immutable) ----

export function updateRow<T extends { key: string }>(rows: readonly T[], key: string, patch: Partial<T>): T[] {
  return rows.map(r => (r.key === key ? { ...r, ...patch } : r))
}
export function removeRow<T extends { key: string }>(rows: readonly T[], key: string): T[] {
  return rows.filter(r => r.key !== key)
}

export function blankClass(mode: ModeId, n: number): ClassRow {
  return { key: newKey('c'), name: `Class ${n}`, weekday: 1, startTime: '17:00', mode }
}
export function blankStudent(): StudentRow {
  return { key: newKey('s'), name: '', nickname: null, level: null, age: null, guardianName: null, guardianEmail: null, classNames: [] }
}
export function blankWeek(rows: readonly WeekRow[]): WeekRow {
  const week = Math.min(52, rows.reduce((m, r) => Math.max(m, r.week), 0) + 1)
  return { key: newKey('w'), week, weekStart: null, theme: '', itemsDue: [] }
}

/** Renaming a class keeps student assignments pointing at it. */
export function renameClass(d: Draft, key: string, name: string): Draft {
  const old = d.classes.find(c => c.key === key)
  if (!old) return d
  const k = nameKey(old.name)
  return {
    ...d,
    classes: updateRow(d.classes, key, { name }),
    students: d.students.map(s => ({ ...s, classNames: s.classNames.map(n => (nameKey(n) === k ? name : n)) })),
  }
}

export function removeClass(d: Draft, key: string): Draft {
  const old = d.classes.find(c => c.key === key)
  if (!old) return d
  const k = nameKey(old.name)
  return { ...d, classes: removeRow(d.classes, key), students: d.students.map(s => ({ ...s, classNames: s.classNames.filter(n => nameKey(n) !== k) })) }
}

// ---- class assignment ----

export const inClass = (s: StudentDraft, className: string): boolean => s.classNames.some(n => nameKey(n) === nameKey(className))

export function toggleEnrollment(rows: readonly StudentRow[], studentKey: string, className: string): StudentRow[] {
  return rows.map(s => {
    if (s.key !== studentKey) return s
    return { ...s, classNames: inClass(s, className) ? s.classNames.filter(n => nameKey(n) !== nameKey(className)) : [...s.classNames, className] }
  })
}

export function setAllInClass(rows: readonly StudentRow[], className: string, on: boolean): StudentRow[] {
  return rows.map(s => {
    if (on === inClass(s, className)) return s
    return { ...s, classNames: on ? [...s.classNames, className] : s.classNames.filter(n => nameKey(n) !== nameKey(className)) }
  })
}

/** Drops references to classes that no longer exist; with exactly one class, unassigned students join it. */
export function autoAssign(d: Draft): Draft {
  const known = d.classes.map(c => c.name)
  const only = known.length === 1 ? known[0]! : null
  return {
    ...d,
    students: d.students.map(s => {
      const kept = s.classNames.flatMap(n => { const m = known.find(k => nameKey(k) === nameKey(n)); return m ? [m] : [] })
      const classNames = kept.length || !only ? kept : [only]
      return classNames.length === s.classNames.length && classNames.every((n, i) => n === s.classNames[i]) ? s : { ...s, classNames }
    }),
  }
}

export const unassignedCount = (d: Draft): number => d.students.filter(s => !d.classes.some(c => inClass(s, c.name))).length

// ---- summaries ----

/** "AI found 14 students — check them" style headline for a step's proposal. */
export function foundHeadline(step: UploadStep, count: number, mode: ModeId): string {
  const m = MODES[mode]
  const noun = step === 'classes' ? (count === 1 ? 'class' : 'classes') : step === 'roster' ? (count === 1 ? m.person : m.people) : count === 1 ? 'week' : 'weeks'
  if (!count) return `AI didn’t find any ${step === 'roster' ? m.people : noun} — try a clearer photo or paste the text`
  return `AI found ${count} ${noun} — check ${count === 1 ? 'it' : 'them'}`
}

/** "12 with parent emails · 2 missing" */
export function emailSummary(rows: readonly StudentDraft[], mode: ModeId): string {
  const withEmail = rows.filter(s => s.guardianEmail).length
  return `${withEmail} with ${MODES[mode].recipient} email${withEmail === 1 ? '' : 's'} · ${rows.length - withEmail} missing`
}

// ---- dates ----

const toUtc = (date: string) => new Date(`${date}T12:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export function addDays(date: string, n: number): string { const d = toUtc(date); d.setUTCDate(d.getUTCDate() + n); return fmt(d) }
export function mondayOf(date: string): string { const dow = toUtc(date).getUTCDay(); return addDays(date, dow === 0 ? -6 : 1 - dow) }
/** Week 1 = the week containing `today`. An explicit weekStart wins. */
export const weekStartFor = (w: CurriculumWeekDraft, today: string): string => (w.weekStart ? mondayOf(w.weekStart) : addDays(mondayOf(today), 7 * (w.week - 1)))

export function localToday(now: Date, timeZone: string): string {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) } catch { return fmt(now) }
}

// ---- validation + commit ----

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export type CellIssue = 'name' | 'time' | 'email' | 'theme' | 'age'

export function studentIssues(s: StudentDraft): CellIssue[] {
  const out: CellIssue[] = []
  if (!s.name.trim()) out.push('name')
  if (s.guardianEmail && !EMAIL.test(s.guardianEmail)) out.push('email')
  if (s.age !== null && (!Number.isInteger(s.age) || s.age < 2 || s.age > 99)) out.push('age')
  return out
}
export function classIssues(c: ClassDraft): CellIssue[] {
  const out: CellIssue[] = []
  if (!c.name.trim()) out.push('name')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.startTime)) out.push('time')
  return out
}
export const weekIssues = (w: CurriculumWeekDraft): CellIssue[] => (w.theme.trim() ? [] : ['theme'])

const blankToNull = (s: string | null): string | null => (s && s.trim() ? s.trim() : null)

export type CommitBuild = { ok: true; commit: OnboardingCommit } | { ok: false; errors: string[] }

/** Validates the whole draft and shapes the commit body; errors are coach-readable. */
export function buildCommit(d: Draft, today: string): CommitBuild {
  const errors: string[] = []
  if (!d.mode) errors.push('Pick what you teach (step 1).')
  if (!d.basics.schoolName.trim()) errors.push('Add your school or business name.')
  if (!d.basics.coachName.trim()) errors.push('Add your name.')
  if (!d.classes.length) errors.push('Add at least one class.')
  const badClasses = d.classes.filter(c => classIssues(c).length).length
  if (badClasses) errors.push(`${badClasses} class${badClasses === 1 ? ' needs' : 'es need'} a name and start time.`)
  const dupes = d.classes.length - new Set(d.classes.map(c => nameKey(c.name))).size
  if (dupes) errors.push('Two classes share a name — rename one.')
  const students = d.students.filter(s => s.name.trim() || s.guardianEmail || s.level)
  const bad = students.filter(s => studentIssues(s).length).length
  if (bad) errors.push(`${bad} roster row${bad === 1 ? ' has' : 's have'} a missing name, bad email or age.`)
  const weeks = d.weeks.filter(w => w.theme.trim() || w.itemsDue.length)
  const badWeeks = weeks.filter(w => weekIssues(w).length).length
  if (badWeeks) errors.push(`${badWeeks} curriculum week${badWeeks === 1 ? ' needs' : 's need'} a theme.`)
  if (errors.length) return { ok: false, errors }

  const known = d.classes.map(c => c.name.trim())
  const byWeek = new Map<string, { weekStart: string; theme: string; itemsDue: string[] }>()
  for (const w of weeks) { const ws = weekStartFor(w, today); byWeek.set(ws, { weekStart: ws, theme: w.theme.trim(), itemsDue: w.itemsDue.map(i => i.trim()).filter(Boolean) }) }
  const body = {
    mode: d.mode!,
    basics: { schoolName: d.basics.schoolName.trim(), coachName: d.basics.coachName.trim(), timeZone: d.basics.timeZone },
    classes: d.classes.map(({ key: _k, ...c }) => ({ ...c, name: c.name.trim() })),
    students: students.map(({ key: _k, ...s }) => ({
      ...s,
      name: s.name.trim(),
      nickname: blankToNull(s.nickname),
      level: blankToNull(s.level),
      guardianName: blankToNull(s.guardianName),
      guardianEmail: blankToNull(s.guardianEmail)?.toLowerCase() ?? null,
      classNames: s.classNames.flatMap(n => { const m = known.find(k => nameKey(k) === nameKey(n)); return m ? [m] : [] }),
    })),
    curriculum: [...byWeek.values()],
  }
  const parsed = OnboardingCommit.safeParse(body)
  if (!parsed.success) return { ok: false, errors: ['Some values are too long or invalid. Check the highlighted cells.'] }
  return { ok: true, commit: parsed.data }
}

export function canLeaveStep(step: StepId, d: Draft): boolean {
  if (step === 'mode') return d.mode !== null
  if (step === 'basics') return Boolean(d.basics.schoolName.trim() && d.basics.coachName.trim())
  return true
}

/** Coach-readable text for a failed extract or commit. */
export function onboardingErrorText(e: unknown, action: 'read' | 'save'): string {
  if (e instanceof ApiError) {
    if (e.status === 413) return 'That photo is too large. Try a closer crop.'
    if (e.status === 429 && e.message === 'ai_budget_reached') return 'Today’s AI limit is reached. You can still add rows by hand.'
    if (e.status === 429) return 'Too many tries in a row. Wait a moment, then try again.'
    if (e.status === 401) return 'This phone isn’t paired anymore. Re-pair, then try again.'
    if (e.status === 400) return action === 'save' ? `Couldn’t save: ${e.message}.` : 'Add some text or a photo first.'
    if (e.status === 502 && action === 'read') return 'Couldn’t read that. Try a clearer photo, or paste the text.'
  }
  if (e instanceof NetworkError) return 'Can’t reach CoachLens. Check your connection.'
  return action === 'read' ? 'Couldn’t read that. Try again.' : 'Couldn’t save. Nothing was lost, so try again.'
}

/** Longest edge ≤ max, keeping aspect ratio (for client-side downscaling before upload). */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  if (w <= max && h <= max) return { w, h }
  const s = max / Math.max(w, h)
  return { w: Math.round(w * s), h: Math.round(h * s) }
}

/** Saved drafts from older builds or corrupted storage fall back to a fresh draft. */
export function restoreDraft(raw: string | null, timeZone?: string): Draft {
  const fresh = initialDraft(timeZone)
  if (!raw) return fresh
  try {
    const v = JSON.parse(raw) as Partial<Draft>
    if (!v || typeof v !== 'object' || !Array.isArray(v.classes) || !Array.isArray(v.students) || !Array.isArray(v.weeks) || !v.basics) return fresh
    return { ...fresh, ...v, basics: { ...fresh.basics, ...v.basics }, notes: v.notes ?? {} } as Draft
  } catch { return fresh }
}
