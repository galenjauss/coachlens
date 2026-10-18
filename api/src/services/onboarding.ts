import { and, eq, sql } from 'drizzle-orm'
import type { OnboardingCommit, OnboardingCommitResponse, OnboardingStatus } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, curriculum, enrollments, guardians, instructors, students } from '../db/schema'
import { draftDeck } from '../agents/planner'
import { localDate, upcomingClassDate } from '../logic/dates'
import { nameKey } from '../logic/onboarding'

/** At most this many first plans are drafted right after onboarding (each is one AI call). */
export const MAX_FIRST_PLANS = 10
const DEFAULT_LEVEL = 'new'

export class OnboardingError extends Error {}

export async function onboardingStatus(deps: Deps, instructorId: string): Promise<OnboardingStatus> {
  const { db } = deps
  const [cls] = await db.select({ n: sql<number>`count(*)::int` }).from(classes)
  const [st] = await db.select({ n: sql<number>`count(*)::int` }).from(students)
  const [ins] = await db.select().from(instructors).where(eq(instructors.id, instructorId))
  const classCount = Number(cls?.n ?? 0)
  return {
    needsOnboarding: classCount === 0,
    classCount,
    studentCount: Number(st?.n ?? 0),
    coachName: ins?.name ?? null,
    schoolName: ins?.schoolName ?? null,
    timeZone: ins?.timeZone ?? null,
  }
}

/**
 * Saves the confirmed quiz in one go. Idempotent by name: classes and students are matched
 * case-insensitively and updated, guardians by (student, email), enrollments and weeks upserted.
 * Neon HTTP has no interactive transactions, so a retry after a partial failure is safe instead.
 */
export async function commitOnboarding(deps: Deps, instructorId: string, p: OnboardingCommit): Promise<OnboardingCommitResponse> {
  const { db } = deps
  const year = Number(localDate(deps.now(), p.basics.timeZone).slice(0, 4))

  // Every student class reference must resolve before anything is written.
  const existingClasses = await db.select().from(classes)
  const byClassKey = new Map(existingClasses.map(c => [nameKey(c.name), c]))
  const commitKeys = new Set(p.classes.map(c => nameKey(c.name)))
  const unknown = [...new Set(p.students.flatMap(s => s.classNames).filter(n => !commitKeys.has(nameKey(n)) && !byClassKey.has(nameKey(n))))]
  if (unknown.length) throw new OnboardingError(`unknown classes: ${unknown.slice(0, 5).join(', ')}`)

  await db.update(instructors).set({ name: p.basics.coachName, schoolName: p.basics.schoolName, timeZone: p.basics.timeZone }).where(eq(instructors.id, instructorId))

  let createdClasses = 0
  const committedClasses: (typeof classes.$inferSelect)[] = []
  for (const c of p.classes) {
    const found = byClassKey.get(nameKey(c.name))
    const fields = { name: c.name, weekday: c.weekday, startTime: c.startTime, mode: c.mode }
    const [row] = found
      ? await db.update(classes).set(fields).where(eq(classes.id, found.id)).returning()
      : await db.insert(classes).values({ ...fields, instructorId }).returning()
    if (!found) createdClasses++
    byClassKey.set(nameKey(c.name), row!)
    committedClasses.push(row!)
  }

  const existingStudents = await db.select().from(students)
  const byStudentKey = new Map(existingStudents.map(s => [nameKey(s.name), s]))
  let createdStudents = 0
  let createdGuardians = 0
  for (const s of p.students) {
    const found = byStudentKey.get(nameKey(s.name))
    let studentId: string
    if (found) {
      await db.update(students).set({
        name: s.name,
        ...(s.nickname ? { nickname: s.nickname } : {}),
        ...(s.level ? { belt: s.level } : {}),
        ...(s.age ? { birthYear: year - s.age } : {}),
      }).where(eq(students.id, found.id))
      studentId = found.id
    } else {
      // birthYear is required; unknown age stores the current year until the coach fills it in.
      const [row] = await db.insert(students).values({ name: s.name, nickname: s.nickname, belt: s.level ?? DEFAULT_LEVEL, birthYear: year - (s.age ?? 0) }).returning()
      studentId = row!.id
      byStudentKey.set(nameKey(s.name), row!)
      createdStudents++
    }
    if (s.guardianEmail) {
      const email = s.guardianEmail.toLowerCase()
      const [g] = await db.select().from(guardians).where(and(eq(guardians.studentId, studentId), sql`lower(${guardians.email}) = ${email}`))
      const gName = s.guardianName ?? `${s.name.split(' ').slice(-1)[0]} family`
      if (g) { if (s.guardianName) await db.update(guardians).set({ name: s.guardianName }).where(eq(guardians.id, g.id)) } else {
        await db.insert(guardians).values({ studentId, name: gName, email })
        createdGuardians++
      }
    }
    const classIds = [...new Set(s.classNames.map(n => byClassKey.get(nameKey(n))!.id))]
    if (classIds.length) await db.insert(enrollments).values(classIds.map(classId => ({ classId, studentId }))).onConflictDoNothing()
  }

  for (const w of p.curriculum) {
    await db.insert(curriculum).values({ weekStart: w.weekStart, mode: p.mode, theme: w.theme, formsDue: w.itemsDue })
      .onConflictDoUpdate({ target: [curriculum.weekStart, curriculum.mode], set: { theme: w.theme, formsDue: w.itemsDue } })
  }

  // First plans run after the response: one draft per class for its upcoming date (draftDeck skips existing decks).
  const toPlan = committedClasses.slice(0, MAX_FIRST_PLANS)
  deps.defer((async () => {
    for (const c of toPlan) {
      await draftDeck(deps, c.id, upcomingClassDate(deps.now(), deps.env.timeZone, c.weekday)).catch(e => console.error('[onboarding:plan]', c.id, e))
    }
  })())

  return {
    classIds: committedClasses.map(c => c.id),
    studentCount: p.students.length,
    created: { classes: createdClasses, students: createdStudents, guardians: createdGuardians },
    weeks: p.curriculum.length,
    plansQueued: toPlan.length,
  }
}
