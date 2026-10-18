import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { Alias, ClassCreate, ClassUpdate, MAX_ALIASES, StudentCreate, StudentUpdate, isRealDate, modeConfig, type GuardianInput, type NoteCandidates } from '@matside/shared'
import type { Db } from '../db/client'
import {
  actionLedger, agentRuns, attendance, billingFlags, classes, deckDiffs, decks, deferredTasks, drills, enrollments, guardians, insights, issues, notes, outbox,
  preferences, reportCards, sessions, studentMetrics, students, utterances,
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

export async function updateStudent(db: Db, instructorId: string, id: string, p: StudentUpdate): Promise<void> {
  // The owner is stamped on every edit, so a legacy (owner-less) student moved out of its classes is never orphaned.
  const set: Partial<typeof students.$inferInsert> = { instructorId }
  if (p.aliases) set.aliases = uniqueAliases(p.aliases)
  if (p.belt !== undefined) set.belt = p.belt
  if (p.rankSince !== undefined) set.rankSince = p.rankSince
  if (p.name !== undefined) set.name = p.name
  if (p.nickname !== undefined) set.nickname = nick(p.nickname) ?? null
  const classIds = p.classIds ? [...new Set(p.classIds)] : null
  await atomically(db, h => [
    h.update(students).set(set).where(eq(students.id, id)),
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
  const [st] = await db.select({ name: students.name, owner: students.instructorId }).from(students).where(eq(students.id, id))
  const name = st?.name ?? null
  // Free text that identifies them: the full name (and the [id] tag the planner request uses).
  const scrub = (col: typeof deckDiffs.requestText | typeof agentRuns.summary) =>
    name ? sql`replace(replace(${col}, ${name}, 'a removed student'), ${id}, 'removed')` : sql`replace(${col}, ${id}, 'removed')`
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
    // Plan diffs: the request text and any focus ids inside the diff.
    h.update(deckDiffs).set({ requestText: scrub(deckDiffs.requestText), diff: sql`replace(${deckDiffs.diff}::text, ${id}, '')::jsonb` })
      .where(sql`${deckDiffs.requestText} like ${`%${id}%`} or ${deckDiffs.diff}::text like ${`%${id}%`}${name ? sql` or ${deckDiffs.requestText} like ${`%${name}%`}` : sql``}`),
    // Undo bookkeeping that names them (rank, issue and attendance rows; their deferred tasks).
    h.delete(actionLedger).where(sql`${actionLedger.entityId} = ${id} or ${actionLedger.entityId} like ${`%:${id}`} or ${actionLedger.after}->>'studentId' = ${id}`),
    h.delete(deferredTasks).where(eq(deferredTasks.subject, id)),
    // Agent-run summaries that still name them (runs linked to them were deleted above).
    ...(name ? [h.update(agentRuns).set({ summary: scrub(agentRuns.summary) }).where(sql`${agentRuns.summary} like ${`%${name}%`}`)] : []),
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
/**
 * Removes the class with its enrollments, decks (drills, diffs), preferences and sessions. "Live" means what it
 * means everywhere else: an open session for the class's current date (`today` = upcomingClassDate). An older
 * session left open (abandoned) does not block. Sessions go too, with their attendance, utterances (and undo
 * bookkeeping), unassigned notes and billing flags, and class-level insights; notes assigned to a student stay with
 * the student (session link cleared). Legacy owner-less students of the class get the class owner stamped first.
 * Every statement re-checks "not live" inside the one batch, so a class started meanwhile is left untouched (409).
 */
export async function deleteClass(db: Db, id: string, today: string): Promise<void> {
  const liveSql = sql`exists (select 1 from ${sessions} s where s.class_id = ${id} and s.ended_at is null and s.for_date = ${today})`
  const [live] = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.classId, id), isNull(sessions.endedAt), eq(sessions.forDate, today))).limit(1)
  if (live) throw new ClassLiveError('class session is live')
  const notLive = sql`not ${liveSql}`
  const ofClass = <T extends PgColumn>(col: T, sub: SQL) => and(sql`${col} in (${sub})`, notLive)
  const sessionIds = sql`select id from ${sessions} where class_id = ${id}`
  const deckIds = sql`select id from ${decks} where class_id = ${id}`
  const uttIds = sql`select id from ${utterances} where session_id in (${sessionIds})`
  const [owner] = await db.select({ ins: classes.instructorId }).from(classes).where(eq(classes.id, id))
  await atomically(db, h => [
    // Legacy students owned only through this class keep their owner once the enrollment is gone.
    ...(owner ? [h.update(students).set({ instructorId: owner.ins })
      .where(and(isNull(students.instructorId), sql`${students.id} in (select student_id from ${enrollments} where class_id = ${id})`, notLive))] : []),
    // Rows only reachable through this class: unassigned billing flags of its utterances, class-level insights.
    h.delete(billingFlags).where(and(isNull(billingFlags.studentId), ofClass(billingFlags.utteranceId, uttIds))),
    h.delete(insights).where(and(isNull(insights.studentId), eq(insights.classId, id), notLive)),
    h.delete(enrollments).where(and(eq(enrollments.classId, id), notLive)),
    h.delete(drills).where(ofClass(drills.deckId, deckIds)),
    h.delete(deckDiffs).where(ofClass(deckDiffs.deckId, deckIds)),
    h.delete(attendance).where(ofClass(attendance.sessionId, sessionIds)),
    h.delete(actionLedger).where(ofClass(actionLedger.utteranceId, uttIds)),
    h.delete(deferredTasks).where(ofClass(deferredTasks.utteranceId, uttIds)),
    h.delete(notes).where(and(isNull(notes.studentId), ofClass(notes.sessionId, sessionIds))),
    h.update(notes).set({ sessionId: null, drillId: null }).where(ofClass(notes.sessionId, sessionIds)),
    h.delete(utterances).where(ofClass(utterances.sessionId, sessionIds)),
    h.delete(sessions).where(and(eq(sessions.classId, id), notLive)),
    h.delete(decks).where(and(eq(decks.classId, id), notLive)),
    h.delete(preferences).where(and(eq(preferences.classId, id), notLive)),
    h.delete(classes).where(and(eq(classes.id, id), notLive)),
  ])
  const [still] = await db.select({ id: classes.id }).from(classes).where(eq(classes.id, id))
  if (still) throw new ClassLiveError('class session is live')
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
