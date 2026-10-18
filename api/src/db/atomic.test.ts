import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { PGlite } from '@electric-sql/pglite'
import { makeTestDb } from '../test/helpers'
import { makeTenant } from '../test/tenants'
import { atomically } from './atomic'
import type { Db } from './client'
import { attendance, classes, decks, drills, enrollments, guardians, notes, sessions, students } from './schema'
import { deleteClass, deleteStudent } from '../services/roster'

/**
 * C4 (fix round 1): production runs `atomically` through neon-http's `db.batch`, which PGlite lacks. This stub is
 * batch-capable: it renders every statement to SQL text + params (as the neon driver would send them) and runs
 * them as raw statements inside one PGlite transaction, so the batch path and the SQL it builds are exercised.
 */
function batchingDb(db: Db) {
  const client = (db as unknown as { $client: PGlite }).$client
  const sent: string[] = []
  const stub = Object.assign(Object.create(Object.getPrototypeOf(db)), db, {
    async batch(qs: { toSQL(): { sql: string; params: unknown[] } }[]) {
      const rendered = qs.map(q => q.toSQL())
      sent.push(...rendered.map(r => r.sql))
      await client.transaction(async tx => { for (const r of rendered) await tx.query(r.sql, r.params as never[]) })
    },
  }) as Db
  return { stub, sent }
}

describe('atomically: the neon batch path', () => {
  it('deleteStudent runs as one batch of valid raw SQL (jsonb list scrubs included)', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    const id = A.studentIds[0]!
    await db.update(classes).set({ remindIds: [id, A.studentIds[1]!] }).where(eq(classes.id, A.classId))
    await db.update(drills).set({ focusStudentIds: [id] }).where(eq(drills.id, A.drillId))
    const { stub, sent } = batchingDb(db)
    await deleteStudent(stub, id)
    expect(sent.length).toBeGreaterThan(10)
    expect((await db.select().from(students).where(eq(students.id, id))).length).toBe(0)
    expect((await db.select().from(guardians).where(eq(guardians.studentId, id))).length).toBe(0)
    expect((await db.select().from(notes).where(eq(notes.studentId, id))).length).toBe(0)
    expect((await db.select().from(classes).where(eq(classes.id, A.classId)))[0]!.remindIds).toEqual([A.studentIds[1]])
    expect((await db.select().from(drills).where(eq(drills.id, A.drillId)))[0]!.focusStudentIds).toEqual([])
  })

  it('attendance restore statements (update and delete) are valid in a batch, and a failing statement rolls back all', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    const [s1, s2] = A.studentIds as [string, string]
    await db.insert(attendance).values([{ sessionId: A.sessionId, studentId: s1, status: 'present', source: 'voice' }, { sessionId: A.sessionId, studentId: s2, status: 'present', source: 'voice' }])
    const { stub } = batchingDb(db)
    await atomically(stub, h => [
      h.update(attendance).set({ status: 'absent', source: 'phone' }).where(and(eq(attendance.sessionId, A.sessionId), eq(attendance.studentId, s1))),
      h.delete(attendance).where(and(eq(attendance.sessionId, A.sessionId), eq(attendance.studentId, s2))),
    ])
    expect((await db.select().from(attendance)).map(r => `${r.studentId}:${r.status}:${r.source}`)).toEqual([`${s1}:absent:phone`])
    await expect(atomically(stub, h => [
      h.delete(attendance).where(eq(attendance.sessionId, A.sessionId)),
      h.insert(students).values({ id: s2, name: 'duplicate id', belt: 'x', birthYear: 2000 }), // violates the primary key
    ])).rejects.toThrow()
    expect((await db.select().from(attendance)).length).toBe(1)
  })

  it('deleteClass runs as one batch of valid raw SQL (subqueries and the not-live guard included)', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    await db.update(sessions).set({ endedAt: new Date('2026-10-20T01:00:00Z') }).where(eq(sessions.id, A.sessionId))
    await db.update(students).set({ instructorId: null }).where(eq(students.id, A.studentIds[1]!))
    const { stub, sent } = batchingDb(db)
    await deleteClass(stub, A.classId, '2026-10-19')
    expect(sent.some(q => /not exists \(select 1 from "sessions" s/.test(q))).toBe(true)
    expect((await db.select().from(classes)).length).toBe(0)
    expect((await db.select().from(enrollments)).length).toBe(0)
    expect((await db.select().from(decks)).length).toBe(0)
    expect((await db.select().from(sessions)).length).toBe(0)
    expect((await db.select().from(students).where(eq(students.id, A.studentIds[1]!)))[0]!.instructorId).toBe(A.instructorId)
  })
})
