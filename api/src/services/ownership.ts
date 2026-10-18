import { and, eq, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'

type Col = SQL | AnyColumn
import type { Db } from '../db/client'
import { agentRuns, billingFlags, classes, deckDiffs, decks, drills, enrollments, insights, notes, outbox, sessions, studentMetrics, students, utterances } from '../db/schema'

/**
 * Ownership (C4). Classes carry instructor_id; students carry it too (legacy rows with a null owner are owned
 * through an enrollment in the instructor's class). Everything else is owned through its class or student.
 * Every route checks ownership before acting and answers 404 for another instructor's entity.
 */
export const studentOwnedBy = (instructorId: string): SQL => or(
  eq(students.instructorId, instructorId),
  and(isNull(students.instructorId), sql`exists (select 1 from ${enrollments} e join ${classes} c on c.id = e.class_id where e.student_id = ${students.id} and c.instructor_id = ${instructorId})`),
)!

/** SQL: `col` is a student id owned by the instructor. */
export const studentIdOwnedBy = (col: Col, instructorId: string): SQL =>
  sql`${col} in (select s.id from ${students} s where s.instructor_id = ${instructorId} or (s.instructor_id is null and exists (select 1 from ${enrollments} e join ${classes} c on c.id = e.class_id where e.student_id = s.id and c.instructor_id = ${instructorId})))`

/** SQL: `col` is a session id whose class belongs to the instructor. */
export const sessionIdOwnedBy = (col: Col, instructorId: string): SQL =>
  sql`${col} in (select se.id from ${sessions} se join ${classes} c on c.id = se.class_id where c.instructor_id = ${instructorId})`

/** SQL: `col` is a class id belonging to the instructor. */
export const classIdOwnedBy = (col: Col, instructorId: string): SQL =>
  sql`${col} in (select c.id from ${classes} c where c.instructor_id = ${instructorId})`

/** SQL: `col` is a deck id whose class belongs to the instructor. */
export const deckIdOwnedBy = (col: Col, instructorId: string): SQL =>
  sql`${col} in (select d.id from ${decks} d join ${classes} c on c.id = d.class_id where c.instructor_id = ${instructorId})`

/** Notes: through their student, or (unassigned) through their session. */
export const noteOwnedBy = (instructorId: string): SQL =>
  or(studentIdOwnedBy(notes.studentId, instructorId), and(isNull(notes.studentId), sessionIdOwnedBy(notes.sessionId, instructorId)))!

/** Billing flags: through their student, or (unknown student) through their utterance's session. */
export const billingOwnedBy = (instructorId: string): SQL =>
  or(studentIdOwnedBy(billingFlags.studentId, instructorId), and(isNull(billingFlags.studentId),
    sql`${billingFlags.utteranceId} in (select u.id from ${utterances} u where ${sessionIdOwnedBy(sql`u.session_id`, instructorId)})`))!

/** Insights: through their student, else their class. */
export const insightOwnedBy = (instructorId: string): SQL =>
  or(studentIdOwnedBy(insights.studentId, instructorId), and(isNull(insights.studentId), classIdOwnedBy(insights.classId, instructorId)))!

const exists = async (q: Promise<unknown[]>) => (await q).length > 0

export const ownsClass = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, id), eq(classes.instructorId, ins))))
export const ownsStudent = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: students.id }).from(students).where(and(eq(students.id, id), studentOwnedBy(ins))))
export const ownsSession = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.id, id), classIdOwnedBy(sessions.classId, ins))))
export const ownsDeck = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: decks.id }).from(decks).where(and(eq(decks.id, id), classIdOwnedBy(decks.classId, ins))))
export const ownsDrill = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: drills.id }).from(drills).where(and(eq(drills.id, id), deckIdOwnedBy(drills.deckId, ins))))
export const ownsDiff = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: deckDiffs.id }).from(deckDiffs).where(and(eq(deckDiffs.id, id), deckIdOwnedBy(deckDiffs.deckId, ins))))
export const ownsUtterance = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: utterances.id }).from(utterances).where(and(eq(utterances.id, id), sessionIdOwnedBy(utterances.sessionId, ins))))
export const ownsNote = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: notes.id }).from(notes).where(and(eq(notes.id, id), noteOwnedBy(ins))))
export const ownsBilling = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: billingFlags.id }).from(billingFlags).where(and(eq(billingFlags.id, id), billingOwnedBy(ins))))
export const ownsOutbox = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: outbox.id }).from(outbox).where(and(eq(outbox.id, id), studentIdOwnedBy(outbox.studentId, ins))))
export const ownsMetric = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: studentMetrics.id }).from(studentMetrics).where(and(eq(studentMetrics.id, id), studentIdOwnedBy(studentMetrics.studentId, ins))))
export const ownsInsight = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: insights.id }).from(insights).where(and(eq(insights.id, id), insightOwnedBy(ins))))
export const ownsAgentRun = (db: Db, ins: string, id: string) =>
  exists(db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.id, id), eq(agentRuns.instructorId, ins))))

export async function ownedStudentIds(db: Db, ins: string): Promise<string[]> {
  return (await db.select({ id: students.id }).from(students).where(studentOwnedBy(ins))).map(r => r.id)
}

/** The instructor who owns a class (for cron work, which runs per owner). */
export async function classOwner(db: Db, classId: string): Promise<string | null> {
  const [c] = await db.select({ ins: classes.instructorId }).from(classes).where(eq(classes.id, classId))
  return c?.ins ?? null
}
