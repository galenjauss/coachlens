import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { Alias, ClassCreate, ClassUpdate, MAX_ALIASES, StudentCreate, StudentUpdate, isRealDate, modeConfig, type GuardianInput, type NoteCandidates } from '@matside/shared'
import type { Db } from '../db/client'
import {
  agentRuns, attendance, billingFlags, classes, deckDiffs, decks, drills, enrollments, guardians, insights, issues, notes, outbox,
  preferences, reportCards, sessions, studentMetrics, students,
} from '../db/schema'
import { atomically } from '../db/atomic'
import { aliasKey } from '../logic/names'

/** C3 · roster and class maintenance. Every function assumes the route already checked ownership (C4). */

/**
 * Request bodies are the shared client contracts (StudentCreate, StudentUpdate, ClassCreate, ClassUpdate). The
 * server adds the rules the old StudentPatch enforced: aliases must look like names, rankSince must be a real
 * date, and a patch must change something.
 */
export const StudentUpdateBody = StudentUpdate.superRefine((p, ctx) => {
  if (!Object.values(p).some(v => v !== undefined)) ctx.addIssue({ code: 'custom', message: 'nothing to change' })
  if (p.aliases && (p.aliases.length > MAX_ALIASES || p.aliases.some(a => !Alias.safeParse(a).success))) ctx.addIssue({ code: 'custom', message: 'bad alias' })
  if (p.rankSince && !isRealDate(p.rankSince)) ctx.addIssue({ code: 'custom', message: 'not a real date' })
})
export { ClassCreate, ClassUpdate, StudentCreate }

const nick = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null) // '' clears it
const guardianRows = (studentId: string, gs: GuardianInput[]) => gs.map(g => ({ studentId, name: g.name, email: g.email.toLowerCase() }))

export interface StudentView {
  id: string; name: string; nickname: string | null; belt: string; aliases: string[]; rankSince: string | null
  classIds: string[]; guardians: { name: string; email: string }[]
}

export async function studentView(db: Db, id: string): Promise<StudentView | null> {
  const [s] = await db.select().from(students).where(eq(students.id, id))
  if (!s) return null
  const [enr, gs] = await Promise.all([
    db.select({ classId: enrollments.classId }).from(enrollments).where(eq(enrollments.studentId, id)),
    db.select({ name: guardians.name, email: guardians.email }).from(guardians).where(eq(guardians.studentId, id)).orderBy(asc(guardians.email)),
  ])
  return { id: s.id, name: s.name, nickname: s.nickname, belt: s.belt, aliases: s.aliases, rankSince: s.rankSince, classIds: enr.map(e => e.classId), guardians: gs }
}

const uniqueAliases = (aliases: string[]) => aliases.filter((a, i) => aliases.findIndex(b => aliasKey(b) === aliasKey(a)) === i).slice(0, MAX_ALIASES)

export async function createStudent(db: Db, instructorId: string, body: StudentCreate, year: number): Promise<StudentView> {
  const id = crypto.randomUUID()
  const classIds = [...new Set(body.classIds)]
  await atomically(db, h => [
    // Unknown age: birthYear = this year (reported as null), as onboarding does.
    h.insert(students).values({ id, instructorId, name: body.name, nickname: nick(body.nickname) ?? null, belt: body.belt ?? 'new', birthYear: year }),
    ...(classIds.length ? [h.insert(enrollments).values(classIds.map(classId => ({ classId, studentId: id })))] : []),
    ...(body.guardians?.length ? [h.insert(guardians).values(guardianRows(id, body.guardians))] : []),
  ])
  return (await studentView(db, id))!
}

export async function updateStudent(db: Db, id: string, p: StudentUpdate): Promise<void> {
  const set: Partial<typeof students.$inferInsert> = {}
  if (p.aliases) set.aliases = uniqueAliases(p.aliases)
  if (p.belt !== undefined) set.belt = p.belt
  if (p.rankSince !== undefined) set.rankSince = p.rankSince
  if (p.name !== undefined) set.name = p.name
  if (p.nickname !== undefined) set.nickname = nick(p.nickname) ?? null
  const classIds = p.classIds ? [...new Set(p.classIds)] : null
  await atomically(db, h => [
    ...(Object.keys(set).length ? [h.update(students).set(set).where(eq(students.id, id))] : []),
    ...(classIds ? [h.delete(enrollments).where(eq(enrollments.studentId, id))] : []),
    ...(classIds?.length ? [h.insert(enrollments).values(classIds.map(classId => ({ classId, studentId: id })))] : []),
    ...(p.guardians ? [h.delete(guardians).where(eq(guardians.studentId, id))] : []),
    ...(p.guardians?.length ? [h.insert(guardians).values(guardianRows(id, p.guardians))] : []),
  ])
}

/**
 * Deletes the student and their personal data in one transaction: notes, metrics, guardians, enrollments,
 * attendance, issues, billing flags, outbox and report cards, insights, agent runs linked to them, and their id in
 * reminder / focus lists. Free text that names them inside other records (e.g. a transcript) is not rewritten.
 */
export async function deleteStudent(db: Db, id: string): Promise<void> {
  const ref = JSON.stringify([id])
  await atomically(db, h => [
    h.delete(notes).where(eq(notes.studentId, id)),
    h.delete(studentMetrics).where(eq(studentMetrics.studentId, id)),
    h.delete(guardians).where(eq(guardians.studentId, id)),
    h.delete(enrollments).where(eq(enrollments.studentId, id)),
    h.delete(attendance).where(eq(attendance.studentId, id)),
    h.delete(issues).where(eq(issues.studentId, id)),
    h.delete(billingFlags).where(eq(billingFlags.studentId, id)),
    h.delete(reportCards).where(eq(reportCards.studentId, id)),
    h.delete(outbox).where(eq(outbox.studentId, id)),
    h.delete(insights).where(eq(insights.studentId, id)),
    h.delete(agentRuns).where(sql`${agentRuns.links}->>'studentId' = ${id}`),
    h.update(classes).set({ remindIds: sql`${classes.remindIds} - ${id}::text` }).where(sql`${classes.remindIds} @> ${ref}::jsonb`),
    h.update(sessions).set({ remindIds: sql`${sessions.remindIds} - ${id}::text` }).where(sql`${sessions.remindIds} @> ${ref}::jsonb`),
    h.update(drills).set({ focusStudentIds: sql`${drills.focusStudentIds} - ${id}::text` }).where(sql`${drills.focusStudentIds} @> ${ref}::jsonb`),
    h.delete(students).where(eq(students.id, id)),
  ])
}

export interface ClassView { id: string; name: string; mode: string; modeLabel: string; weekday: number; startTime: string }
const classView = (c: typeof classes.$inferSelect): ClassView => {
  const mode = modeConfig(c.mode)
  return { id: c.id, name: c.name, mode: mode.id, modeLabel: mode.label, weekday: c.weekday, startTime: c.startTime }
}

export async function createClass(db: Db, instructorId: string, body: ClassCreate): Promise<ClassView> {
  const [row] = await db.insert(classes).values({ instructorId, ...body }).returning()
  return classView(row!)
}

export async function updateClass(db: Db, id: string, body: ClassUpdate): Promise<ClassView> {
  const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
  const [row] = Object.keys(set).length
    ? await db.update(classes).set(set).where(eq(classes.id, id)).returning()
    : await db.select().from(classes).where(eq(classes.id, id))
  return classView(row!)
}

export class ClassLiveError extends Error {}

/** Removes the class, its enrollments, decks (drills, diffs) and remembered preferences. Past sessions stay as history. */
export async function deleteClass(db: Db, id: string): Promise<void> {
  const [live] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.classId, id), isNull(sessions.endedAt))).limit(1)
  if (live) throw new ClassLiveError('class session is live')
  const deckIds = (await db.select({ id: decks.id }).from(decks).where(eq(decks.classId, id))).map(d => d.id)
  await atomically(db, h => [
    h.delete(enrollments).where(eq(enrollments.classId, id)),
    ...(deckIds.length ? [h.delete(drills).where(inArray(drills.deckId, deckIds)), h.delete(deckDiffs).where(inArray(deckDiffs.deckId, deckIds))] : []),
    h.delete(decks).where(eq(decks.classId, id)),
    h.delete(preferences).where(eq(preferences.classId, id)),
    h.delete(classes).where(eq(classes.id, id)),
  ])
}

/**
 * C3 / F16: who a note can be assigned to: its own class's roster, with the class name and the capture time.
 * A note captured outside a class has no roster to offer: 'no_class' (the route answers 409).
 */
export async function noteCandidates(db: Db, noteId: string): Promise<NoteCandidates | 'no_class' | null> {
  const [n] = await db.select({ sessionId: notes.sessionId, createdAt: notes.createdAt }).from(notes).where(eq(notes.id, noteId))
  if (!n) return null
  if (!n.sessionId) return 'no_class' as const
  const [cls] = await db.select({ id: classes.id, name: classes.name }).from(sessions).innerJoin(classes, eq(classes.id, sessions.classId)).where(eq(sessions.id, n.sessionId))
  if (!cls) return 'no_class' as const
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, aliases: students.aliases })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.classId, cls.id)).orderBy(asc(students.name))
  return { classId: cls.id, className: cls.name, capturedAt: n.createdAt.toISOString(), students: roster }
}
