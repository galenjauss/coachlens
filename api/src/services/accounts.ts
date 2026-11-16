import { eq, gte, sql } from 'drizzle-orm'
import type { Deps } from '../deps'
import type { Db } from '../db/client'
import { classes, instructors, sessions, students } from '../db/schema'
import { currentInstructorId } from '../http/context'

/** Self-serve accounts have no email of their own; this reserved domain (RFC 2606) can never receive mail. */
export const SELF_SERVE_EMAIL_DOMAIN = 'users.coachlens.invalid'
/** The name a new account carries until the setup quiz asks for the coach's real one. */
export const DEFAULT_COACH_NAME = 'Coach'

/** True for an account created by one-tap sign-up (spends from the public pool, drafts-only email). */
export async function isSelfServe(db: Db, instructorId: string): Promise<boolean> {
  const row = await instructorRow(db, instructorId)
  return Boolean(row?.email.toLowerCase().endsWith(`@${SELF_SERVE_EMAIL_DOMAIN}`))
}

/** Sessions within this many days make a self-serve account "active" for the nightly jobs. */
export const ACTIVE_DAYS = 14

/**
 * Accounts the nightly jobs work for, in order: operator accounts first, then self-serve accounts that ran a class in
 * the last ACTIVE_DAYS. Abandoned sign-ups cost nothing, and a flood of them can't push real coaches past the time limit.
 */
export async function cronInstructors(db: Db, now: Date): Promise<string[]> {
  const all = await db.select({ id: instructors.id, email: instructors.email }).from(instructors)
  const since = new Date(now.getTime() - ACTIVE_DAYS * 86_400_000)
  const active = new Set((await db.selectDistinct({ id: classes.instructorId }).from(sessions)
    .innerJoin(classes, eq(classes.id, sessions.classId)).where(gte(sessions.startedAt, since))).map(r => r.id))
  const selfServe = (e: string) => e.toLowerCase().endsWith(`@${SELF_SERVE_EMAIL_DOMAIN}`)
  return [...all.filter(i => !selfServe(i.email)), ...all.filter(i => selfServe(i.email) && active.has(i.id))].map(i => i.id)
}

/** Roster ceilings per account: well above a real school, and they bound what the nightly jobs can be asked to do. */
export const MAX_CLASSES = 30
export const MAX_STUDENTS = 300

/** Whether `addClasses` / `addStudents` more would still fit this account's roster ceilings. */
export async function rosterHasRoom(db: Db, instructorId: string, addClasses: number, addStudents: number): Promise<boolean> {
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(classes).where(eq(classes.instructorId, instructorId))
  const [s] = await db.select({ n: sql<number>`count(*)::int` }).from(students).where(eq(students.instructorId, instructorId))
  return Number(c?.n ?? 0) + addClasses <= MAX_CLASSES && Number(s?.n ?? 0) + addStudents <= MAX_STUDENTS
}

/** One-tap sign-up: a new, empty, private account. The caller issues its first token. */
export async function createSelfServeInstructor(db: Db): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(instructors).values({ id, name: DEFAULT_COACH_NAME, email: `${id}@${SELF_SERVE_EMAIL_DOMAIN}` })
  return id
}

async function instructorRow(db: Db, instructorId: string | null) {
  if (!instructorId) return null
  const [row] = await db.select({ name: instructors.name, email: instructors.email }).from(instructors).where(eq(instructors.id, instructorId))
  return row ?? null
}

/** The coach's own name for drafts (set in setup), falling back to INSTRUCTOR_NAME outside a request. */
export async function coachName(deps: Deps, instructorId: string | null = currentInstructorId()): Promise<string> {
  const row = await instructorRow(deps.db, instructorId)
  return row?.name.trim() || deps.env.instructorName
}

/**
 * Whether CoachLens itself may send this account's approved parent emails. A self-serve account (anyone who signed
 * up in the app) gets drafts it sends from its own email app, so nobody can use the service to mail arbitrary
 * addresses; MAIL_SENDERS can allow one by its account email. Accounts created by the operator (the demo coach,
 * seeded schools) send as before.
 */
export async function canSendMail(deps: Deps, instructorId: string | null = currentInstructorId()): Promise<boolean> {
  const row = await instructorRow(deps.db, instructorId)
  if (!row) return !instructorId // no account in scope (legacy unowned rows): operator data, unchanged behaviour
  const email = row.email.toLowerCase()
  return (deps.env.mailSenders ?? []).includes(email) || !email.endsWith(`@${SELF_SERVE_EMAIL_DOMAIN}`)
}

/** The account that owns a student (C4 owner column), else the request's account. */
export async function ownerOfStudent(db: Db, studentId: string): Promise<string | null> {
  const [row] = await db.select({ owner: students.instructorId }).from(students).where(eq(students.id, studentId))
  return row?.owner ?? currentInstructorId()
}
