import { and, desc, eq } from 'drizzle-orm'
import { BRIEF_LINE_MAX, BRIEF_LINES_MAX, type Brief, type ModeConfig } from '@matside/shared'
import type { Db } from '../db/client'
import { attendance, issues, notes, sessions, students } from '../db/schema'
import { attendanceDots, changeFor, clip, isGradeMetric, metricPhrase, timeInRank } from '../logic/metrics'
import { localDate } from '../logic/dates'
import { listMetrics } from './metrics'

const ATT_LABEL: Record<string, string> = { martial_arts: 'Att', personal_training: 'Sessions', tutoring: 'Lessons' }
const fit = (s: string) => clip(s, BRIEF_LINE_MAX)

/**
 * The deterministic glance card for one student (no LLM): name and rank, attendance dots, latest two notes,
 * open issues, latest reading. At most 5 lines of 38 chars; the second note is the first line dropped.
 */
export async function buildBrief(db: Db, studentId: string, mode: ModeConfig, now: Date = new Date(), tz = 'America/Los_Angeles'): Promise<Brief> {
  const [s] = await db.select().from(students).where(eq(students.id, studentId))
  if (!s) throw new Error('student not found')
  const first = s.name.split(' ')[0] ?? s.name
  const [att, ns, iss, metrics] = await Promise.all([
    db.select({ status: attendance.status }).from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(eq(attendance.studentId, studentId)).orderBy(desc(sessions.startedAt)).limit(6),
    db.select({ at: notes.createdAt, text: notes.text }).from(notes).where(eq(notes.studentId, studentId)).orderBy(desc(notes.createdAt)).limit(2),
    db.select({ tag: issues.tag }).from(issues).where(and(eq(issues.studentId, studentId), eq(issues.status, 'open'))),
    listMetrics(db, studentId),
  ])
  const sessionCount = await db.select({ status: attendance.status }).from(attendance).where(eq(attendance.studentId, studentId)).then(r => r.filter(x => x.status === 'present').length)
  const head = mode.id === 'martial_arts'
    ? [first, s.belt, timeInRank(s.rankSince, localDate(now, tz))].filter(Boolean).join(' · ')
    : `${first} · ${mode.person}${sessionCount ? ` · ${sessionCount} ${mode.id === 'tutoring' ? 'lessons' : 'sessions'}` : ''}`
  const { dots, trend } = attendanceDots(att.map(a => a.status).reverse())
  const attLine = att.length ? `${ATT_LABEL[mode.id] ?? 'Att'} ${dots} ${trend}` : `${ATT_LABEL[mode.id] ?? 'Att'}: none yet`
  const noteLines = ns.map(n => `${n.at.getUTCMonth() + 1}/${n.at.getUTCDate()} ${clip(n.text, BRIEF_LINE_MAX - 6)}`)
  const open = iss.length ? [fit(`Working on: ${[...new Set(iss.map(i => i.tag))].join(', ')}`)] : []

  const latest = metrics.find(m => m.key !== 'rank')
  let metricLine: string[] = []
  if (latest) {
    const earlier = metrics.filter(m => m.key === latest.key && m.recordedAt < latest.recordedAt).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime())
    const grade = isGradeMetric(mode.id, latest.unit)
    const phrase = metricPhrase(latest.key, latest.value, latest.num, latest.unit, changeFor(grade, latest.num, latest.unit, earlier))
    metricLine = [fit(mode.id === 'tutoring' && grade ? `Last ${phrase}` : phrase.charAt(0).toUpperCase() + phrase.slice(1))]
  }

  const lines = [fit(head), fit(attLine), ...noteLines.map(fit), ...open, ...metricLine]
  // Over budget: the second note goes first.
  if (lines.length > BRIEF_LINES_MAX && noteLines.length > 1) lines.splice(2 + 1, 1)
  return { name: s.name, lines: lines.slice(0, BRIEF_LINES_MAX) }
}
