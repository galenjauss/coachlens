import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import { Alias, MAX_ALIASES, ModeId, isRealDate, modeConfig } from '@matside/shared'
import type { Db } from '../db/client'
import {
  agentRuns, attendance, billingFlags, classes, deckDiffs, decks, drills, enrollments, guardians, insights, issues, notes, outbox,
  preferences, reportCards, sessions, studentMetrics, students,
} from '../db/schema'
import { atomically } from '../db/atomic'
import { aliasKey } from '../logic/names'

/** C3 · roster and class maintenance. Every function assumes the route already checked ownership (C4). */

const Name = z.string().trim().min(1).max(80)
const Nickname = z.string().trim().min(1).max(40).nullable()
const Guardian = z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email().max(200) })
const ClassIds = z.array(z.string().min(1).max(64)).max(20)

export const StudentCreate = z.object({
  name: Name, belt: z.string().trim().min(1).max(40).optional(), nickname: Nickname.optional(),
  classIds: ClassIds, guardians: z.array(Guardian).max(4).optional(),
})
export type StudentCreate = z.infer<typeof StudentCreate>

/** The existing patch (aliases, belt, rankSince) plus name, nickname, classIds and guardians (replace). */
export const StudentUpdate = z.object({
  aliases: z.array(Alias).max(MAX_ALIASES).optional(),
  belt: z.string().trim().min(1).max(40).optional(),
  rankSince: z.string().refine(isRealDate, 'not a real date').nullable().optional(),
  name: Name.optional(), nickname: Nickname.optional(), classIds: ClassIds.optional(), guardians: z.array(Guardian).max(4).optional(),
}).refine(p => Object.values(p).some(v => v !== undefined), 'nothing to change')
export type StudentUpdate = z.infer<typeof StudentUpdate>

const StartTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')
const Weekday = z.number().int().min(0).max(6)
export const ClassCreate = z.object({ name: Name, mode: ModeId, startTime: StartTime, weekday: Weekday })
export const ClassUpdate = ClassCreate.partial().refine(p => Object.values(p).some(v => v !== undefined), 'nothing to change')

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
    h.insert(students).values({ id, instructorId, name: body.name, nickname: body.nickname ?? null, belt: body.belt ?? 'new', birthYear: year }),
    ...(classIds.length ? [h.insert(enrollments).values(classIds.map(classId => ({ classId, studentId: id })))] : []),
    ...(body.guardians?.length ? [h.insert(guardians).values(body.guardians.map(g => ({ studentId: id, ...g })))] : []),
  ])
  return (await studentView(db, id))!
}

export async function updateStudent(db: Db, id: string, p: StudentUpdate): Promise<void> {
  const set: Partial<typeof students.$inferInsert> = {}
  if (p.aliases) set.aliases = uniqueAliases(p.aliases)
  if (p.belt !== undefined) set.belt = p.belt
  if (p.rankSince !== undefined) set.rankSince = p.rankSince
  if (p.name !== undefined) set.name = p.name
  if (p.nickname !== undefined) set.nickname = p.nickname
  const classIds = p.classIds ? [...new Set(p.classIds)] : null
  await atomically(db, h => [
    ...(Object.keys(set).length ? [h.update(students).set(set).where(eq(students.id, id))] : []),
    ...(classIds ? [h.delete(enrollments).where(eq(enrollments.studentId, id))] : []),
    ...(classIds?.length ? [h.insert(enrollments).values(classIds.map(classId => ({ classId, studentId: id })))] : []),
    ...(p.guardians ? [h.delete(guardians).where(eq(guardians.studentId, id))] : []),
    ...(p.guardians?.length ? [h.insert(guardians).values(p.guardians.map(g => ({ studentId: id, ...g })))] : []),
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

export async function createClass(db: Db, instructorId: string, body: z.infer<typeof ClassCreate>): Promise<ClassView> {
  const [row] = await db.insert(classes).values({ instructorId, ...body }).returning()
  return classView(row!)
}

export async function updateClass(db: Db, id: string, body: z.infer<typeof ClassUpdate>): Promise<ClassView> {
  const [row] = await db.update(classes).set(body).where(eq(classes.id, id)).returning()
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

/** C3 / F16: who a note can be assigned to: its own class's roster, with the class name and the capture time. */
export async function noteCandidates(db: Db, noteId: string, ownedStudents: () => Promise<string[]>) {
  const [n] = await db.select({ sessionId: notes.sessionId, createdAt: notes.createdAt }).from(notes).where(eq(notes.id, noteId))
  if (!n) return null
  const pick = { id: students.id, name: students.name, nickname: students.nickname, aliases: students.aliases }
  if (!n.sessionId) {
    // A note captured outside a class: the caller's whole roster (no class to narrow it to).
    const ids = await ownedStudents()
    const all = ids.length ? await db.select(pick).from(students).where(inArray(students.id, ids)).orderBy(asc(students.name)) : []
    return { classId: null, className: null, capturedAt: n.createdAt.toISOString(), students: all }
  }
  const [cls] = await db.select({ id: classes.id, name: classes.name }).from(sessions).innerJoin(classes, eq(classes.id, sessions.classId)).where(eq(sessions.id, n.sessionId))
  if (!cls) return null
  const roster = await db.select(pick).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId))
    .where(eq(enrollments.classId, cls.id)).orderBy(asc(students.name))
  return { classId: cls.id, className: cls.name, capturedAt: n.createdAt.toISOString(), students: roster }
}
