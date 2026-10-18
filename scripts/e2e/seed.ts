/**
 * Synthetic seed for the e2e run: two instructors, each with their own classes, students, guardians and notes.
 *
 * Instructor A ("Coach Galen") is the app's own demo seed (api/src/db/seed.ts): Kids · Tue/Thu (14 kids, Priya with
 * two guard concern notes, Gus due a rank review, Priya's quiet "focus" issue), plus the PT and tutoring classes.
 * Instructor B ("Coach Rivera") is added here: one class, three students, one guardian each, two notes.
 *
 * Every email address is @example.invalid (RFC 2606: can never be delivered). No real person's data.
 *
 * Works against `build` (one shared pairing code, no per-instructor scoping) and against batch 2 (C4): when the
 * pairing service exists, each instructor gets their own code and B's students carry B's instructor id.
 */
import * as t from '../../api/src/db/schema'
import { seed } from '../../api/src/db/seed'
import type { Db } from '../../api/src/db/client'

export const CODES = { A: 'E2EA4242', B: 'E2EB4242' } as const
/** A test-only pepper for pairing-code hashes in the isolated API (never a deployment secret). */
export const TEST_PAIRING_PEPPER = 'e2e-local-test-pepper-not-a-secret'

export interface SeedResult {
  instructorA: string
  instructorB: string
  classIds: Record<string, string>
  classB: string
  studentsB: string[]
  perInstructorCodes: boolean
}

const guardianEmail = (i: number) => `guardian-${i}@example.invalid`

/** Column present in this build's schema (C4 adds instructor_id to more tables). */
const has = (table: object, col: string) => col in table

export async function seedE2E(db: Db, today: string): Promise<SeedResult> {
  // Seeding runs outside any request, so instructor scoping (C4) is lifted for the seed only, then restored.
  let restoreScope: (() => void) | null = null
  try {
    const CONTEXT = '../../api/src/http/context'
    const ctx = await import(CONTEXT) as { allowUnscoped?: (on: boolean) => void }
    if (ctx.allowUnscoped) { ctx.allowUnscoped(true); restoreScope = () => ctx.allowUnscoped!(false) }
  } catch { /* build before batch 2: no scoping */ }
  try { return await seedAll(db, today) } finally { restoreScope?.() }
}

async function seedAll(db: Db, today: string): Promise<SeedResult> {
  const a = await seed(db, { today, guardianEmail, pairingCode: CODES.A, pairingPepper: TEST_PAIRING_PEPPER } as Parameters<typeof seed>[1])

  const [insB] = await db.insert(t.instructors).values({ name: 'Coach Rivera', email: 'rivera@example.invalid' }).returning()
  const [classB] = await db.insert(t.classes).values({ instructorId: insB!.id, name: 'Rivera Teens · Sat', weekday: 6, startTime: '10:00' }).returning()
  const studentRows = ['Quinn Ortega', 'Rosa Vance', 'Theo Marsh'].map(name => ({
    name, belt: 'blue', birthYear: 2011,
    ...(has(t.students, 'instructorId') ? { instructorId: insB!.id } : {}),
  }))
  const studentsB = await db.insert(t.students).values(studentRows as typeof t.students.$inferInsert[]).returning()
  await db.insert(t.guardians).values(studentsB.map((s, i) => ({ studentId: s.id, name: `${s.name.split(' ')[1]} family`, email: `rivera-guardian-${i}@example.invalid` })))
  await db.insert(t.enrollments).values(studentsB.map(s => ({ classId: classB!.id, studentId: s.id })))
  await db.insert(t.notes).values([
    { studentId: studentsB[0]!.id, text: 'B-PRIVATE: Quinn sparring footwork sharp', valence: 'positive', tags: ['footwork'] },
    { studentId: studentsB[1]!.id, text: 'B-PRIVATE: Rosa needs to chamber kicks', valence: 'concern', tags: ['kicks'] },
  ])

  // C4 (batch 2): one pairing code per instructor, hashed at rest. Absent on build: there, /pair uses env.pairingCode.
  let perInstructorCodes = false
  try {
    const PAIRING = '../../api/src/services/pairing' // a variable: the module only exists once batch 2 is merged
    const pairing = await import(PAIRING) as { setPairingCode?: (db: Db, id: string, code: string, pepper?: string) => Promise<void> }
    if (typeof pairing.setPairingCode === 'function') {
      await pairing.setPairingCode(db, a.instructorId, CODES.A, TEST_PAIRING_PEPPER)
      await pairing.setPairingCode(db, insB!.id, CODES.B, TEST_PAIRING_PEPPER)
      perInstructorCodes = true
    }
  } catch { /* build: no per-instructor pairing yet */ }

  // Sanity: the seed left exactly these two instructors.
  const all = await db.select({ id: t.instructors.id }).from(t.instructors)
  if (all.length !== 2) throw new Error(`seed: expected 2 instructors, found ${all.length}`)
  return { instructorA: a.instructorId, instructorB: insB!.id, classIds: a.classIds, classB: classB!.id, studentsB: studentsB.map(s => s.id), perInstructorCodes }
}
