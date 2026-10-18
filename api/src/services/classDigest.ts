// The class digest for live questions ("who keeps dropping their guard?"): deterministic, no LLM.
// loadClassFacts reads the rows once; digestText turns them into the compact prompt for the answer agent.
import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { ModeConfig } from '@matside/shared'
import type { Db } from '../db/client'
import { attendance, drills, insights, issues, notes, sessions, studentMetrics, students } from '../db/schema'
import { changeFor, changeText, isGradeMetric, measure, timeInRank } from '../logic/metrics'
import { clip } from '../logic/text'
import { localDate } from '../logic/dates'
import { loadSessionContext, type SessionContext } from './context'

export const DIGEST_WINDOW_DAYS = 21
export const DIGEST_MAX_CHARS = 2500
const ATT_SESSIONS = 6
const NOTES_PER_STUDENT = 3
const METRICS_PER_STUDENT = 3
const REMAINING_MAX = 6
const INSIGHTS_MAX = 5
const DAY = 86_400_000

export interface StudentFacts {
  id: string
  name: string
  first: string
  belt: string
  rankSince: string | null
  /** Open issue tags with their note count in the window. */
  openIssues: { tag: string; count: number }[]
  /** Notes per tag in the window. */
  tagCounts: Record<string, number>
  /** Newest first, at most NOTES_PER_STUDENT. */
  recentNotes: { tags: string[]; text: string }[]
  /** Oldest first over the class's last sessions, today's last: 'P' present, 'A' absent, '-' not marked. */
  attendance: string
  presentToday: boolean
  notedToday: boolean
  /** Latest reading per key (≤3), e.g. "deadlift 225 lb (PR +10)". */
  metrics: string[]
}

export interface ClassFacts {
  mode: ModeConfig
  today: string
  theme: string
  attendanceTaken: boolean
  students: StudentFacts[]
  drill: string | null
  remaining: string[]
  insights: string[]
}

const first = (name: string) => name.split(' ')[0] ?? name

/** Present today: marked present, or everyone while no roll call has been taken (as coverage counts it). */
export const presentStudents = (f: ClassFacts) => f.students.filter(s => s.presentToday)

export async function loadClassFacts(db: Db, sessionId: string, drillId: string | null, now: Date, tz: string): Promise<ClassFacts> {
  const ctx = await loadSessionContext(db, sessionId, drillId)
  const ids = ctx.roster.map(r => r.id)
  const since = new Date(now.getTime() - DIGEST_WINDOW_DAYS * DAY)
  const none = Promise.resolve([] as never[])
  const [recentSessions, noteRows, issueRows, metricRows, studentRows, deck, insightRows, notedRows] = await Promise.all([
    db.select({ id: sessions.id }).from(sessions).where(eq(sessions.classId, ctx.classId)).orderBy(desc(sessions.startedAt)).limit(ATT_SESSIONS + 1),
    ids.length ? db.select({ studentId: notes.studentId, tags: notes.tags, text: notes.text }).from(notes)
      .where(and(inArray(notes.studentId, ids), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)) : none,
    ids.length ? db.select({ studentId: issues.studentId, tag: issues.tag }).from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : none,
    ids.length ? db.select().from(studentMetrics).where(inArray(studentMetrics.studentId, ids)).orderBy(desc(studentMetrics.recordedAt)) : none,
    ids.length ? db.select({ id: students.id, rankSince: students.rankSince }).from(students).where(inArray(students.id, ids)) : none,
    db.select().from(drills).where(eq(drills.deckId, ctx.deckId)).orderBy(drills.position),
    db.select({ title: insights.title }).from(insights)
      .where(and(eq(insights.status, 'new'), or(eq(insights.classId, ctx.classId), isNull(insights.classId)))).orderBy(desc(insights.createdAt)).limit(INSIGHTS_MAX),
    db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, sessionId)),
  ])
  const sessionIds = recentSessions.map(s => s.id).reverse()
  const attRows = sessionIds.length && ids.length
    ? await db.select().from(attendance).where(and(inArray(attendance.sessionId, sessionIds), inArray(attendance.studentId, ids)))
    : []
  const noted = new Set(notedRows.flatMap(r => (r.id ? [r.id] : [])))
  const rankSince = new Map(studentRows.map(r => [r.id, r.rankSince]))
  const today = localDate(now, tz)
  return {
    mode: ctx.mode, today, theme: ctx.theme, attendanceTaken: ctx.attendanceTaken,
    students: ctx.roster.map(r => {
      const mine = noteRows.filter(n => n.studentId === r.id)
      const tagCounts: Record<string, number> = {}
      for (const n of mine) for (const t of n.tags) tagCounts[t] = (tagCounts[t] ?? 0) + 1
      const status = new Map(attRows.filter(a => a.studentId === r.id).map(a => [a.sessionId, a.status]))
      return {
        id: r.id, name: r.name, first: first(r.name), belt: r.belt, rankSince: rankSince.get(r.id) ?? null,
        openIssues: [...new Set(issueRows.filter(i => i.studentId === r.id).map(i => i.tag))].map(tag => ({ tag, count: tagCounts[tag] ?? 0 })),
        tagCounts,
        recentNotes: mine.slice(0, NOTES_PER_STUDENT).map(n => ({ tags: n.tags, text: n.text })),
        attendance: sessionIds.map(id => (status.get(id) === 'present' ? 'P' : status.get(id) === 'absent' ? 'A' : '-')).join(''),
        presentToday: ctx.attendanceTaken ? ctx.presentIds.has(r.id) : true,
        notedToday: noted.has(r.id),
        metrics: latestMetrics(ctx.mode, metricRows.filter(m => m.studentId === r.id)),
      }
    }),
    ...deckFacts(ctx, deck),
    insights: insightRows.map(i => i.title),
  }
}

type MetricRow = typeof studentMetrics.$inferSelect
type DrillRow = typeof drills.$inferSelect

/** Latest reading per key (rows newest first), with the change vs earlier readings of that key. */
function latestMetrics(mode: ModeConfig, rows: MetricRow[]): string[] {
  const keys = [...new Set(rows.filter(m => m.key !== 'rank').map(m => m.key))].slice(0, METRICS_PER_STUDENT)
  return keys.map(key => {
    const [latest, ...earlier] = rows.filter(m => m.key === key)
    const change = changeText(changeFor(isGradeMetric(mode.id, latest!.unit), latest!.num, latest!.unit, [...earlier].reverse()))
    return `${key} ${measure(latest!.value, latest!.num, latest!.unit)}${change ? ` (${change})` : ''}`
  })
}

/** The current drill (the one passed in, else the running one) and what is still to come. */
function deckFacts(ctx: SessionContext, deck: DrillRow[]): Pick<ClassFacts, 'drill' | 'remaining'> {
  const current = ctx.drill ?? deck.find(d => d.startedAt && !d.endedAt) ?? null
  const after = current ? deck.filter(d => d.position > current.position) : deck.filter(d => !d.endedAt)
  return { drill: current?.name ?? null, remaining: after.slice(0, REMAINING_MAX).map(d => clip(d.name, 30)) }
}

/** True when there is nothing to ground an answer in: no notes, issues or readings, and no attendance history. */
export function isThin(f: ClassFacts): boolean {
  return f.students.every(s => !s.recentNotes.length && !s.openIssues.length && !s.metrics.length && s.attendance.replace(/-/g, '').length <= 1)
}

function studentLine(f: ClassFacts, s: StudentFacts, noteChars: number, notesPer: number): string {
  const rank = f.mode.id === 'martial_arts' ? [s.belt, timeInRank(s.rankSince, f.today)].filter(Boolean).join(' ') : ''
  const parts = [
    s.first,
    rank,
    s.attendance ? `att ${s.attendance}` : '',
    s.presentToday ? 'here' : 'away',
    s.notedToday ? 'fb today' : 'no fb today',
    s.openIssues.length ? `open: ${s.openIssues.map(i => `${i.tag} ${i.count}`).join(', ')}` : '',
    s.recentNotes.length && notesPer ? `notes: ${s.recentNotes.slice(0, notesPer).map(n => `[${n.tags.join('/') || '-'}] ${clip(n.text, noteChars)}`).join('; ')}` : '',
    s.metrics.length ? s.metrics.join(', ') : '',
  ]
  return `- ${parts.filter(Boolean).join(' | ')}`
}

function render(f: ClassFacts, noteChars: number, notesPer: number): string {
  const present = presentStudents(f)
  return [
    `${f.mode.label} · ${f.mode.people} · ${f.today} · ${f.mode.weeklyLabel}: ${f.theme}`,
    `Here: ${present.length}/${f.students.length}${f.attendanceTaken ? '' : ' (no roll call yet)'} · feedback today: ${present.filter(s => s.notedToday).map(s => s.first).join(', ') || 'nobody'}`,
    `${f.mode.planItem}: ${f.drill ?? 'none'} · next: ${f.remaining.join(', ') || 'none'}`,
    `att = last ${ATT_SESSIONS + 1} ${f.mode.planUnit.toLowerCase()} sessions oldest→today (P/A/-); counts = notes in ${DIGEST_WINDOW_DAYS} days`,
    ...f.students.map(s => studentLine(f, s, noteChars, notesPer)),
    ...(f.insights.length ? [`Insights: ${f.insights.join('; ')}`] : []),
  ].join('\n')
}

/** The prompt digest, at most DIGEST_MAX_CHARS: shorter notes first, then whole lines cut from the end. */
export function digestText(f: ClassFacts, max = DIGEST_MAX_CHARS): string {
  for (const [chars, per] of [[40, NOTES_PER_STUDENT], [28, 2], [24, 1], [0, 0]] as const) {
    const t = render(f, chars, per)
    if (t.length <= max) return t
  }
  const t = render(f, 0, 0)
  const cut = t.slice(0, max)
  return cut.slice(0, Math.max(0, cut.lastIndexOf('\n')))
}
