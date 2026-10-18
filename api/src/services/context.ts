import { and, asc, eq, inArray, max } from 'drizzle-orm'
import { modeConfig, type Coverage, type ModeConfig, type NextStudent, type RosterStudent } from '@matside/shared'
import type { Db } from '../db/client'
import { attendance, classes, curriculum, drills, enrollments, issues, notes, sessions, students } from '../db/schema'
import { weekStart } from '../logic/dates'
import { rankNextStudent } from '../logic/ranking'

export interface SessionContext {
  sessionId: string; classId: string; deckId: string; forDate: string; theme: string
  roster: RosterStudent[]; presentIds: Set<string>; attendanceTaken: boolean; remindIds: Set<string>
  drill: { id: string; name: string; position: number } | null
  mode: ModeConfig
}

/** The teaching mode of a class (martial arts when the class is unknown). */
export async function modeForClass(db: Db, classId: string): Promise<ModeConfig> {
  const [c] = await db.select({ mode: classes.mode }).from(classes).where(eq(classes.id, classId))
  return modeConfig(c?.mode)
}

/**
 * The mode a student is taught in: the given session's class if any, else their first enrolled class.
 * A person enrolled in classes of different modes gets the session's mode when there is one.
 */
export async function modeForStudent(db: Db, studentId: string, sessionId: string | null = null): Promise<ModeConfig> {
  if (sessionId) {
    const [s] = await db.select({ classId: sessions.classId }).from(sessions).where(eq(sessions.id, sessionId))
    if (s) return modeForClass(db, s.classId)
  }
  const [c] = await db.select({ mode: classes.mode }).from(enrollments).innerJoin(classes, eq(classes.id, enrollments.classId))
    .where(eq(enrollments.studentId, studentId)).orderBy(asc(classes.weekday), asc(classes.id)).limit(1)
  return modeConfig(c?.mode)
}

export async function curriculumFor(db: Db, mode: ModeConfig, forDate: string) {
  const [cur] = await db.select().from(curriculum).where(and(eq(curriculum.weekStart, weekStart(forDate)), eq(curriculum.mode, mode.id)))
  return cur ?? null
}

export async function loadSessionContext(db: Db, sessionId: string, drillId: string | null): Promise<SessionContext> {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!s) throw new Error(`session ${sessionId} not found`)
  const mode = await modeForClass(db, s.classId)
  const [roster, att, cur, [d]] = await Promise.all([
    db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt, aliases: students.aliases })
      .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, s.classId)),
    db.select().from(attendance).where(eq(attendance.sessionId, sessionId)),
    curriculumFor(db, mode, s.forDate),
    drillId ? db.select().from(drills).where(eq(drills.id, drillId)) : Promise.resolve([] as (typeof drills.$inferSelect)[]),
  ])
  return {
    sessionId, classId: s.classId, deckId: s.deckId, forDate: s.forDate, theme: cur?.theme ?? 'General skills', roster,
    presentIds: new Set(att.filter(a => a.status === 'present').map(a => a.studentId)),
    attendanceTaken: att.some(a => a.source !== 'backstop'), remindIds: new Set(s.remindIds),
    drill: d ? { id: d.id, name: d.name, position: d.position } : null,
    mode,
  }
}

const presentRoster = (ctx: SessionContext) => (ctx.attendanceTaken ? ctx.roster.filter(r => ctx.presentIds.has(r.id)) : ctx.roster)

export async function markPresent(db: Db, sessionId: string, studentId: string, source: 'voice' | 'phone' | 'backstop') {
  await db.insert(attendance).values({ sessionId, studentId, status: 'present', source })
    .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status: 'present', source } })
}

async function notedIds(db: Db, sessionId: string): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, sessionId))
  return new Set(rows.flatMap(r => (r.id ? [r.id] : [])))
}

export async function coverageAndNext(db: Db, ctx: SessionContext, now: Date): Promise<{ coverage: Coverage; next: NextStudent | null }> {
  const [fresh, noted] = await Promise.all([loadSessionContext(db, ctx.sessionId, null), notedIds(db, ctx.sessionId)])
  const present = presentRoster(fresh)
  const coverage = { covered: present.filter(p => noted.has(p.id)).length, present: present.length }
  const ids = present.map(p => p.id)
  if (!ids.length) return { coverage, next: null }
  const [open, last] = await Promise.all([
    db.select({ studentId: issues.studentId, tag: issues.tag }).from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))),
    db.select({ studentId: notes.studentId, at: max(notes.createdAt) }).from(notes).where(inArray(notes.studentId, ids)).groupBy(notes.studentId),
  ])
  const next = rankNextStudent({
    present: present.map(p => ({ id: p.id, name: p.name.split(' ')[0]! })),
    notedIds: noted,
    remindIds: fresh.remindIds,
    openIssue: new Map(open.map(o => [o.studentId, o.tag])),
    lastNoteAt: new Map(last.flatMap(l => (l.studentId && l.at ? [[l.studentId, new Date(l.at)] as const] : []))),
    now,
  })
  return { coverage, next }
}

export async function computeCoverage(db: Db, ctx: SessionContext): Promise<Coverage> {
  return (await coverageAndNext(db, ctx, new Date())).coverage
}

export async function nextStudentFor(db: Db, ctx: SessionContext, now: Date): Promise<NextStudent | null> {
  return (await coverageAndNext(db, ctx, now)).next
}
