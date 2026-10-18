// PURE: the opportunistic-insight detectors. Deterministic functions over rows the service has already loaded (no
// LLM, no db). Each returns a draft insight or null; the service dedupes on `dedupeKey` (kind:student:ISO week).
import { DEFAULT_RANK_REVIEW, INSIGHT_DETAIL_MAX, INSIGHT_TITLE_MAX, MODES, type InsightAction, type InsightKind, type InsightUrgency, type ModeId, type RankReviewSettings, type Valence } from '@matside/shared'
import { changeFor, comparable, keyLabel, measure, shortDate, signed, timeInRank } from '../logic/metrics'
import { clip } from '../logic/text'
import { effectiveValence, isPositive } from '../logic/valence'

export { DEFAULT_RANK_REVIEW }

export interface AttendanceRec { sessionId: string; forDate: string; status: 'present' | 'absent'; ended: boolean }
/** valence/text/historical are optional for older fixtures: a note without them reads as neutral, current. */
export interface NoteRec { sessionId: string | null; tags: string[]; createdAt: Date; valence?: Valence | null; text?: string; historical?: boolean }
export interface IssueRec { id: string; tag: string; openedAt: Date }
export interface MetricRec { key: string; value: string; num: number | null; unit: string | null; recordedAt: Date }
export interface BillingRec { note: string; createdAt: Date }

/** Everything the detectors know about one student. Lists are oldest first. */
export interface StudentFacts {
  id: string
  name: string
  classId: string | null
  mode: ModeId
  belt: string
  rankSince: string | null
  attendance: AttendanceRec[]
  notes: NoteRec[]
  openIssues: IssueRec[]
  metrics: MetricRec[]
  openBilling: BillingRec[]
}

export interface DetectCtx {
  /** Local date (YYYY-MM-DD) the run is about: today, or the live session's date. */
  today: string
  now: Date
  /** The live session that started this run, if any (returning_student checks it first). */
  sessionId: string | null
  /** The school's rank-review thresholds (Settings); defaults when absent. */
  rankReview?: RankReviewSettings
}

export interface InsightDraft {
  kind: InsightKind
  studentId: string | null
  classId: string | null
  title: string
  detail: string
  urgency: InsightUrgency
  action: InsightAction
  dedupeKey: string
}

export const DECLINE_LAST_N = 3
export const DECLINE_MIN_ABSENT = 2
export const DECLINE_WINDOW_DAYS = 28
export const DECLINE_RATE_RATIO = 0.5
export const RETURNING_MIN_ABSENT = 2
export const NO_FEEDBACK_LAST_N = 3
export const NO_FEEDBACK_LIVE_FRACTION = 0.7
/** Lookback for the positive-observation count shown on a rank review (matches the notes loaded for detectors). */
export const RANK_REVIEW_NOTES_DAYS = 60
export const NEW_PR_DAYS = 7
export const GRADE_DROP_POINTS = 10
export const ISSUE_QUIET_DAYS = 21
export const BILLING_REPEAT_MIN = 2

const DAY = 86_400_000
const first = (name: string) => name.split(' ')[0] ?? name
const dayNumber = (iso: string) => Math.floor(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY)
const daysBetween = (fromIso: string, toIso: string) => dayNumber(toIso) - dayNumber(fromIso)
const UNIT: Record<ModeId, [string, string]> = { martial_arts: ['class', 'classes'], personal_training: ['session', 'sessions'], tutoring: ['lesson', 'lessons'] }
const unit = (mode: ModeId, n = 1) => UNIT[mode][n === 1 ? 0 : 1]

/** ISO-8601 week of a YYYY-MM-DD date: "2026-W43". */
export function isoWeek(iso: string): string {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))))
  const dow = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dow) // the Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / DAY + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export const dedupeKey = (kind: string, studentId: string | null, today: string) => `${kind}:${studentId ?? '-'}:${isoWeek(today)}`

function draft(s: StudentFacts, ctx: DetectCtx, kind: InsightKind, urgency: InsightUrgency, title: string, detail: string, action: InsightAction, keyKind: string = kind): InsightDraft {
  return {
    kind, studentId: s.id, classId: s.classId, urgency, action,
    title: clip(title, INSIGHT_TITLE_MAX), detail: clip(detail, INSIGHT_DETAIL_MAX),
    dedupeKey: dedupeKey(keyKind, s.id, ctx.today),
  }
}
const email = (s: StudentFacts, purpose: string, label: string): InsightAction => ({ type: 'draft_email', studentId: s.id, purpose, label })
const valenceOf = (n: NoteRec) => effectiveValence({ valence: n.valence ?? null, text: n.text ?? '' })
/** Current praise/improvement notes (oldest first). */
const positiveNotes = (s: StudentFacts) => s.notes.filter(n => !n.historical && isPositive(valenceOf(n)))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Absent in ≥2 of the last 3 sessions, or the last-4-weeks rate fell below half the prior 4 weeks'. */
export function attendanceDecline(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  const name = first(s.name)
  const action = email(s, 'check_in', 'Draft check-in email')
  const last = s.attendance.slice(-DECLINE_LAST_N)
  const absent = last.filter(a => a.status === 'absent')
  if (last.length >= DECLINE_MIN_ABSENT && absent.length >= DECLINE_MIN_ABSENT) {
    return draft(s, ctx, 'attendance_decline', 'low', `${name} missed ${absent.length} of last ${last.length} ${unit(s.mode, last.length)}`,
      `Absent ${absent.map(a => shortDate(a.forDate)).join(', ')}. A quick check-in may help.`, action)
  }
  const age = (a: AttendanceRec) => daysBetween(a.forDate, ctx.today)
  const recent = s.attendance.filter(a => age(a) >= 0 && age(a) < DECLINE_WINDOW_DAYS)
  const prior = s.attendance.filter(a => age(a) >= DECLINE_WINDOW_DAYS && age(a) < 2 * DECLINE_WINDOW_DAYS)
  if (!recent.length || !prior.length) return null
  const here = (xs: AttendanceRec[]) => xs.filter(a => a.status === 'present').length
  const rate = (xs: AttendanceRec[]) => here(xs) / xs.length
  if (rate(prior) === 0 || rate(recent) >= DECLINE_RATE_RATIO * rate(prior)) return null
  return draft(s, ctx, 'attendance_decline', 'low', `${name}'s attendance has dropped`,
    `Came to ${here(recent)} of ${recent.length} ${unit(s.mode, recent.length)} in the last 4 weeks vs ${here(prior)} of ${prior.length} the 4 weeks before.`, action)
}

/** Marked present today (or in the live session) right after ≥2 consecutive absences. High: the lens cues a welcome. */
export function returningStudent(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  let i = s.attendance.length - 1
  while (i >= 0 && s.attendance[i]!.sessionId !== ctx.sessionId && s.attendance[i]!.forDate !== ctx.today) i--
  if (i < 0 || s.attendance[i]!.status !== 'present') return null
  let missed = 0
  for (let j = i - 1; j >= 0 && s.attendance[j]!.status === 'absent'; j--) missed++
  if (missed < RETURNING_MIN_ABSENT) return null
  const name = first(s.name)
  return draft(s, ctx, 'returning_student', 'high', `${name}'s back after ${missed} missed`,
    `Missed ${missed} ${unit(s.mode, missed)} in a row before today · welcome ${name} back.`, email(s, 'welcome_back', 'Draft welcome email'))
}

/** Present in each of their last 3 finished sessions with zero notes in any of them. */
export function noFeedback(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  const last = s.attendance.filter(a => a.ended).slice(-NO_FEEDBACK_LAST_N)
  if (last.length < NO_FEEDBACK_LAST_N || last.some(a => a.status !== 'present') || !s.classId) return null
  const ids = new Set(last.map(a => a.sessionId))
  if (s.notes.some(n => n.sessionId && ids.has(n.sessionId))) return null
  const name = first(s.name)
  const m = MODES[s.mode]
  return draft(s, ctx, 'no_feedback', 'low', `No notes on ${name} in ${NO_FEEDBACK_LAST_N} ${unit(s.mode, 3)}`,
    `Present the last ${NO_FEEDBACK_LAST_N} ${unit(s.mode, 3)} with no notes. Make ${name} a focus next ${unit(s.mode)}.`,
    { type: 'plan_focus', classId: s.classId, studentId: s.id, label: 'Put first next time',
      text: `Make ${s.name} [${s.id}] a focus student in the first ${m.planItem} next ${unit(s.mode)}: no coach notes in their last ${NO_FEEDBACK_LAST_N} ${unit(s.mode, 3)}.` })
}

export interface LiveSnapshot {
  sessionId: string
  today: string
  /** Share of the planned class time already elapsed (0..1+). */
  elapsed: number
  present: Pick<StudentFacts, 'id' | 'name' | 'classId' | 'mode'>[]
  notedIds: ReadonlySet<string>
}

/**
 * In class, once 70% of class time has gone by: ONE class-level reminder naming the present students with no
 * observation logged yet (high, so the lens shows it once). A note is a record, not proof feedback was given, so the
 * wording says "observation", and there is no per-student demand.
 */
export function liveNoFeedback(snap: LiveSnapshot): InsightDraft[] {
  if (snap.elapsed < NO_FEEDBACK_LIVE_FRACTION) return []
  const missing = snap.present.filter(p => !snap.notedIds.has(p.id))
  const firstP = missing[0]
  if (!firstP) return []
  const m = MODES[firstP.mode]
  const pct = Math.min(100, Math.round(snap.elapsed * 100))
  return [{
    kind: 'no_feedback', studentId: null, classId: firstP.classId, urgency: 'high', action: { type: 'none', label: null },
    title: clip(`${plural(missing.length, m.person, m.people)} ${missing.length === 1 ? 'has' : 'have'} no observation yet`, INSIGHT_TITLE_MAX),
    detail: clip(`Not noted yet: ${missing.map(p => first(p.name)).join(', ')} · ${unit(firstP.mode)} ${pct}% done.`, INSIGHT_DETAIL_MAX),
    dedupeKey: `no_feedback_live:${snap.sessionId}`,
  }]
}

/**
 * Martial arts: a reminder to review a student for their next rank, with the evidence the app has and what it cannot
 * see. Fires when the school's thresholds are met (defaults: >=90 days at rank, no open focus areas, no attendance
 * minimum). It is not a readiness judgment and drafts nothing.
 */
export function rankReview(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  const cfg = ctx.rankReview ?? DEFAULT_RANK_REVIEW
  if (s.mode !== 'martial_arts' || !s.rankSince) return null
  if (daysBetween(s.rankSince, ctx.today) < cfg.minDaysAtRank) return null
  if (cfg.requireNoOpenIssues && s.openIssues.length) return null
  const inWindow = s.attendance.filter(a => { const age = daysBetween(a.forDate, ctx.today); return age >= 0 && age <= cfg.attendanceWindowDays })
  const came = inWindow.filter(a => a.status === 'present').length
  if (came < cfg.minAttendance) return null
  const since = ctx.now.getTime() - RANK_REVIEW_NOTES_DAYS * DAY
  const positives = positiveNotes(s).filter(n => n.createdAt.getTime() >= since).length
  const weeks = Math.round(cfg.attendanceWindowDays / 7)
  const att = inWindow.length ? `${came}/${inWindow.length} ${unit(s.mode, inWindow.length)} in ${weeks} wk` : 'no attendance recorded'
  return draft(s, ctx, 'rank_review', 'low', `${first(s.name)}: review for next rank`,
    `Have: ${timeInRank(s.rankSince, ctx.today)} at ${s.belt}, ${att}, ${plural(s.openIssues.length, 'open issue')}, ${plural(positives, 'positive note')}. Not tracked: curriculum, your assessment.`,
    { type: 'none', label: null })
}

/** Personal training: a personal best recorded in the last 7 days (the most recent one). */
export function newPr(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  if (s.mode !== 'personal_training') return null
  const since = ctx.now.getTime() - NEW_PR_DAYS * DAY
  for (let i = s.metrics.length - 1; i >= 0; i--) {
    const m = s.metrics[i]!
    if (m.recordedAt.getTime() < since) break
    if (m.key === 'rank' || m.num === null) continue
    const earlier = s.metrics.slice(0, i).filter(e => e.key === m.key)
    const c = changeFor(false, m.num, m.unit, earlier)
    if (c?.kind !== 'pr') continue
    const name = first(s.name)
    const what = `${keyLabel(m.key)} ${measure(m.value, m.num, m.unit)}`
    return draft(s, ctx, 'new_pr', 'low', `${name} hit a PR: ${what}`,
      `New best on ${keyLabel(m.key)}: ${measure(m.value, m.num, m.unit)} (${signed(c.delta)}) on ${shortDate(m.recordedAt.toISOString().slice(0, 10))}. Worth a shout-out.`,
      email(s, 'praise', 'Draft praise email'))
  }
  return null
}

/** Tutoring: the latest test is ≥10 points below the previous one of the same kind and unit. */
export function gradeDrop(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  if (s.mode !== 'tutoring' || !s.classId) return null
  const tests = s.metrics.filter(m => m.key !== 'rank' && m.num !== null)
  const latest = tests[tests.length - 1]
  if (!latest) return null
  const prev = comparable(latest.unit, tests.slice(0, -1).filter(t => t.key === latest.key)).at(-1)
  if (prev === undefined || prev - latest.num! < GRADE_DROP_POINTS) return null
  const drop = Math.round((prev - latest.num!) * 10) / 10
  const name = first(s.name)
  const label = keyLabel(latest.key)
  return draft(s, ctx, 'grade_drop', 'low', `${name}'s ${label} down ${drop} pts`,
    `Latest ${label}: ${measure(latest.value, latest.num, latest.unit)} on ${shortDate(latest.recordedAt.toISOString().slice(0, 10))}, down from ${measure(String(prev), prev, latest.unit)}.`,
    { type: 'plan_focus', classId: s.classId, studentId: s.id, label: 'Plan a review',
      text: `Add a short review ${MODES.tutoring.planItem} on ${label} for ${s.name} [${s.id}] next lesson: their latest test dropped ${drop} points.` })
}

/** Current praise/improvement notes on an open issue's tag since it opened (oldest first). */
const positivesSince = (s: StudentFacts, iss: IssueRec) => positiveNotes(s).filter(n => n.tags.includes(iss.tag) && n.createdAt >= iss.openedAt)
const byOpened = (s: StudentFacts) => [...s.openIssues].sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())

/**
 * An open issue with praise or improvement on its tag since it opened: suggest marking it resolved. The resolve action
 * runs only when the instructor accepts it (never in auto mode) and sends nothing home.
 */
export function issueImproving(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  const iss = byOpened(s).find(i => positivesSince(s, i).length)
  if (!iss) return null
  const pos = positivesSince(s, iss)
  const latest = pos[pos.length - 1]!
  return draft(s, ctx, 'issue_improving', 'low', `${first(s.name)}'s ${iss.tag}: improving`,
    `${plural(pos.length, `positive ${iss.tag} note`)} since it opened ${shortDate(iss.openedAt.toISOString().slice(0, 10))}, latest "${clip(latest.text ?? '', 60)}". Mark resolved if you agree.`,
    { type: 'resolve_issue', issueId: iss.id, studentId: s.id, notify: false, label: 'Mark resolved' })
}

/**
 * An open issue whose tag has had no notes for 21 days and no positive evidence: a prompt to re-check it in class.
 * Silence (a forgotten note, an absence, a skill not practiced) is never treated as improvement.
 */
export function issueReassess(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  const cutoff = ctx.now.getTime() - ISSUE_QUIET_DAYS * DAY
  const quiet = byOpened(s).find(iss => {
    if (positivesSince(s, iss).length) return false
    const lastNote = Math.max(iss.openedAt.getTime(), ...s.notes.filter(n => n.tags.includes(iss.tag)).map(n => n.createdAt.getTime()))
    return lastNote <= cutoff
  })
  if (!quiet) return null
  const name = first(s.name)
  const tagLabel = (MODES[s.mode].tagLabels[quiet.tag] ?? quiet.tag).toLowerCase()
  const action: InsightAction = s.classId
    ? { type: 'plan_focus', classId: s.classId, studentId: s.id, label: 'Check next class',
        text: `Make ${s.name} [${s.id}] a focus student next ${unit(s.mode)} to re-check ${tagLabel}: an open focus area with no notes in ${ISSUE_QUIET_DAYS}+ days.` }
    : { type: 'none', label: null }
  return draft(s, ctx, 'issue_reassess', 'low', `${name}'s ${quiet.tag}: no recent notes`,
    `No ${tagLabel} notes in ${ISSUE_QUIET_DAYS}+ days. No notes is not evidence it improved: check it next ${unit(s.mode)}.`, action)
}

/** ≥2 open billing flags for the same person. Notes only: the action is just to acknowledge. */
export function billingRepeat(s: StudentFacts, ctx: DetectCtx): InsightDraft | null {
  if (s.openBilling.length < BILLING_REPEAT_MIN) return null
  const latest = s.openBilling[s.openBilling.length - 1]!
  return draft(s, ctx, 'billing_repeat', 'low', `${first(s.name)} has ${s.openBilling.length} open billing flags`,
    `${s.openBilling.length} billing notes still open; latest: "${clip(latest.note, 70)}". Notes only, no payment.`, { type: 'none', label: null })
}

export const DETECTORS = {
  attendance_decline: attendanceDecline,
  returning_student: returningStudent,
  no_feedback: noFeedback,
  rank_review: rankReview,
  new_pr: newPr,
  grade_drop: gradeDrop,
  issue_improving: issueImproving,
  issue_reassess: issueReassess,
  billing_repeat: billingRepeat,
} satisfies Record<InsightKind, (s: StudentFacts, ctx: DetectCtx) => InsightDraft | null>

/** Runs the chosen detectors (all by default) over every student; at most one draft per kind per student. */
export function detectAll(students: readonly StudentFacts[], ctx: DetectCtx, only?: readonly InsightKind[]): InsightDraft[] {
  const kinds = only ?? (Object.keys(DETECTORS) as InsightKind[])
  return students.flatMap(s => kinds.flatMap(k => DETECTORS[k](s, ctx) ?? []))
}

const KIND_SHORT: Record<InsightKind, string> = {
  attendance_decline: 'attendance', returning_student: 'is back', no_feedback: 'no observations', rank_review: 'rank review',
  new_pr: 'PR', grade_drop: 'grade drop', issue_improving: 'improving', issue_reassess: 'recheck issue', billing_repeat: 'billing',
}

/** Run summary for the Agents tab: "3 new: Jake attendance, Maria ready to test…". */
export function runSummary(created: readonly { kind: InsightKind; studentName: string | null }[]): string {
  if (!created.length) return 'No new insights'
  const items = created.map(c => `${c.studentName ? `${first(c.studentName)} ` : ''}${KIND_SHORT[c.kind]}`)
  return clip(`${created.length} new: ${items.join(', ')}`, 120)
}
