import { and, eq, inArray, max } from 'drizzle-orm'
import type { Coverage, NextStudent, RosterStudent, SkillTag } from '@matside/shared'
import type { Db } from '../db/client'
import { attendance, curriculum, drills, enrollments, issues, notes, sessions, students } from '../db/schema'
import { weekStart } from '../logic/dates'
import { rankNextStudent } from '../logic/ranking'

export interface SessionContext {
  sessionId: string; classId: string; deckId: string; forDate: string; theme: string
  roster: RosterStudent[]; presentIds: Set<string>; attendanceTaken: boolean; remindIds: Set<string>
  drill: { id: string; name: string; position: number } | null
}

export async function loadSessionContext(db: Db, sessionId: string, drillId: string | null): Promise<SessionContext> {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!s) throw new Error(`session ${sessionId} not found`)
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, s.classId))
  const att = await db.select().from(attendance).where(eq(attendance.sessionId, sessionId))
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(s.forDate)))
  const [d] = drillId ? await db.select().from(drills).where(eq(drills.id, drillId)) : []
  return {
    sessionId, classId: s.classId, deckId: s.deckId, forDate: s.forDate, theme: cur?.theme ?? 'General skills', roster,
    presentIds: new Set(att.filter(a => a.status === 'present').map(a => a.studentId)),
    attendanceTaken: att.length > 0, remindIds: new Set(s.remindIds),
    drill: d ? { id: d.id, name: d.name, position: d.position } : null,
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

export async function computeCoverage(db: Db, ctx: SessionContext): Promise<Coverage> {
  const fresh = await loadSessionContext(db, ctx.sessionId, null)
  const present = presentRoster(fresh)
  const noted = await notedIds(db, ctx.sessionId)
  return { covered: present.filter(p => noted.has(p.id)).length, present: present.length }
}

export async function nextStudentFor(db: Db, ctx: SessionContext, now: Date): Promise<NextStudent | null> {
  const fresh = await loadSessionContext(db, ctx.sessionId, null)
  const present = presentRoster(fresh)
  const ids = present.map(p => p.id)
  if (!ids.length) return null
  const open = await db.select({ studentId: issues.studentId, tag: issues.tag }).from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open')))
  const last = await db.select({ studentId: notes.studentId, at: max(notes.createdAt) }).from(notes).where(inArray(notes.studentId, ids)).groupBy(notes.studentId)
  return rankNextStudent({
    present: present.map(p => ({ id: p.id, name: p.name.split(' ')[0]! })),
    notedIds: await notedIds(db, ctx.sessionId),
    remindIds: fresh.remindIds,
    openIssue: new Map(open.map(o => [o.studentId, o.tag as SkillTag])),
    lastNoteAt: new Map(last.flatMap(l => (l.studentId && l.at ? [[l.studentId, new Date(l.at)] as const] : []))),
    now,
  })
}
