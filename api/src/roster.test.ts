import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { makeTenant, pairWith, seedCurriculum } from './test/tenants'
import { createApp } from './app'
import {
  agentRuns, attendance, billingFlags, classes, deckDiffs, decks, drills, enrollments, guardians, insights, issues, notes, outbox, sessions, studentMetrics, students,
} from './db/schema'

/** C3: roster and class maintenance, scoped to the caller (C4). */
async function world() {
  const db = await makeTestDb()
  await seedCurriculum(db)
  const A = await makeTenant(db, 'Alpha', { weekday: 1 })
  const B = await makeTenant(db, 'Bravo', { weekday: 1 })
  // A second class for A, with its own student: the cross-class case.
  const [other] = await db.insert(classes).values({ instructorId: A.instructorId, name: 'Alpha Teens', weekday: 3, startTime: '18:00' }).returning()
  const [teen] = await db.insert(students).values({ name: 'Tess Teen', belt: 'green', birthYear: 2010, instructorId: A.instructorId }).returning()
  await db.insert(enrollments).values({ classId: other!.id, studentId: teen!.id })
  const deps = makeDeps(db, { llm: fakeLlm(() => { throw new Error('llm not stubbed') }) })
  const app = createApp(deps)
  const a = await pairWith(app, A.code)
  const req = (method: string, path: string, body?: unknown) => app.request(path, { method, headers: a.h, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { db, app, A, B, a, req, otherClassId: other!.id, teenId: teen!.id }
}

describe('C3 notes candidates (F16)', () => {
  beforeEach(() => resetRateLimits())

  it('offers the roster of the note class, with the class name and capture time', async () => {
    const w = await world()
    const r = await w.req('GET', `/v1/notes/${w.A.looseNoteId}/candidates`)
    expect(r.status).toBe(200)
    const body = await r.json() as { classId: string; className: string; capturedAt: string; students: { id: string; name: string; nickname: string | null; aliases: string[] }[] }
    expect(body).toMatchObject({ classId: w.A.classId, className: 'Alpha Kids' })
    expect(new Date(body.capturedAt).getTime()).not.toBeNaN()
    expect(body.students.map(s => s.id).sort()).toEqual([...w.A.studentIds].sort())
    expect(body.students.map(s => s.id)).not.toContain(w.teenId)
    expect(body.students[0]).toHaveProperty('aliases')
  })

  it('keeps the membership check: a student of another class is rejected', async () => {
    const w = await world()
    expect((await w.req('POST', `/v1/notes/${w.A.looseNoteId}/assign`, { studentId: w.teenId })).status).toBe(400)
    expect((await w.req('POST', `/v1/notes/${w.A.looseNoteId}/assign`, { studentId: w.A.studentIds[1] })).status).toBe(200)
  })

  it('is a 404 for another instructor note', async () => {
    const w = await world()
    expect((await w.req('GET', `/v1/notes/${w.B.looseNoteId}/candidates`)).status).toBe(404)
    expect((await w.req('GET', '/v1/notes/nope/candidates')).status).toBe(404)
  })
})

describe('C3 students (F23)', () => {
  beforeEach(() => resetRateLimits())

  it('creates a student in own classes with guardians', async () => {
    const w = await world()
    const r = await w.req('POST', '/v1/students', { name: 'Nina New', nickname: 'Nini', belt: 'white', classIds: [w.A.classId, w.otherClassId], guardians: [{ name: 'New family', email: 'new@example.test' }] })
    expect(r.status).toBe(201)
    const s = await r.json() as { id: string; name: string; nickname: string; belt: string; classIds: string[]; guardians: { name: string; email: string }[] }
    expect(s).toMatchObject({ name: 'Nina New', nickname: 'Nini', belt: 'white', guardians: [{ name: 'New family', email: 'new@example.test' }] })
    expect(s.classIds.sort()).toEqual([w.A.classId, w.otherClassId].sort())
    const list = await (await w.req('GET', '/v1/students')).json() as { id: string }[]
    expect(list.map(x => x.id)).toContain(s.id)
    const [row] = await w.db.select().from(students).where(eq(students.id, s.id))
    expect(row!.instructorId).toBe(w.A.instructorId)
    expect((await w.req('GET', '/v1/students', undefined)).status).toBe(200)
  })

  it('validates the body and rejects another instructor class with 404', async () => {
    const w = await world()
    expect((await w.req('POST', '/v1/students', { name: '', classIds: [] })).status).toBe(400)
    expect((await w.req('POST', '/v1/students', { name: 'Ok Name', classIds: [], guardians: [{ name: 'X', email: 'not-an-email' }] })).status).toBe(400)
    expect((await w.req('POST', '/v1/students', { name: 'Sneaky', classIds: [w.B.classId] })).status).toBe(404)
    expect((await w.db.select().from(students).where(eq(students.name, 'Sneaky'))).length).toBe(0)
  })

  it('updates name, nickname, classes and guardians (replace)', async () => {
    const w = await world()
    const id = w.A.studentIds[0]!
    const r = await w.req('PATCH', `/v1/students/${id}`, { name: 'Alphia Renamed', nickname: 'Ally', classIds: [w.otherClassId], guardians: [{ name: 'New G', email: 'g2@example.test' }] })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ id, name: 'Alphia Renamed', nickname: 'Ally', classIds: [w.otherClassId], guardians: [{ name: 'New G', email: 'g2@example.test' }] })
    expect((await w.db.select().from(enrollments).where(eq(enrollments.studentId, id))).map(e => e.classId)).toEqual([w.otherClassId])
    expect((await w.db.select().from(guardians).where(eq(guardians.studentId, id))).map(g => g.email)).toEqual(['g2@example.test'])
    // The existing alias-only reply shape is unchanged.
    expect(await (await w.req('PATCH', `/v1/students/${id}`, { aliases: ['Ally Al'] })).json()).toEqual({ id, aliases: ['Ally Al'] })
    // Moving into another instructor class is refused, nothing changes.
    expect((await w.req('PATCH', `/v1/students/${id}`, { classIds: [w.B.classId] })).status).toBe(404)
    expect((await w.db.select().from(enrollments).where(eq(enrollments.studentId, id))).map(e => e.classId)).toEqual([w.otherClassId])
  })

  it('deletes a student and all their personal data', async () => {
    const w = await world()
    const id = w.A.studentIds[0]!
    await w.db.insert(attendance).values({ sessionId: w.A.sessionId, studentId: id, status: 'present', source: 'phone' })
    await w.db.insert(issues).values({ studentId: id, tag: 'guard' })
    await w.db.update(classes).set({ remindIds: [id] }).where(eq(classes.id, w.A.classId))
    const r = await w.req('DELETE', `/v1/students/${id}`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    for (const [table, col] of [[students, students.id], [notes, notes.studentId], [studentMetrics, studentMetrics.studentId], [guardians, guardians.studentId],
      [enrollments, enrollments.studentId], [attendance, attendance.studentId], [issues, issues.studentId], [billingFlags, billingFlags.studentId],
      [outbox, outbox.studentId], [insights, insights.studentId]] as const) {
      expect((await w.db.select().from(table as typeof notes).where(eq(col as typeof notes.studentId, id))).length).toBe(0)
    }
    expect((await w.db.select().from(agentRuns)).some(r2 => r2.links?.studentId === id)).toBe(false)
    expect((await w.db.select().from(classes).where(eq(classes.id, w.A.classId)))[0]!.remindIds).toEqual([])
    expect((await w.req('GET', `/v1/students/${id}`)).status).toBe(404)
    // The other student is untouched.
    expect((await w.db.select().from(students).where(eq(students.id, w.A.studentIds[1]!))).length).toBe(1)
  })

  it('cross-instructor student writes are 404', async () => {
    const w = await world()
    expect((await w.req('PATCH', `/v1/students/${w.B.studentIds[0]}`, { name: 'Mine' })).status).toBe(404)
    expect((await w.req('DELETE', `/v1/students/${w.B.studentIds[0]}`)).status).toBe(404)
    expect((await w.db.select().from(students).where(eq(students.id, w.B.studentIds[0]!))).length).toBe(1)
  })
})

describe('C3 classes (F23)', () => {
  beforeEach(() => resetRateLimits())

  it('creates, lists and updates a class', async () => {
    const w = await world()
    const r = await w.req('POST', '/v1/classes', { name: 'Alpha Adults', mode: 'personal_training', startTime: '07:30', weekday: 6 })
    expect(r.status).toBe(201)
    const c = await r.json() as { id: string }
    expect(c).toMatchObject({ name: 'Alpha Adults', mode: 'personal_training', startTime: '07:30', weekday: 6 })
    expect((await (await w.req('GET', '/v1/classes')).json() as { id: string }[]).map(x => x.id)).toContain(c.id)
    const p = await w.req('PATCH', `/v1/classes/${c.id}`, { name: 'Alpha Early Adults', startTime: '06:45' })
    expect(await p.json()).toMatchObject({ id: c.id, name: 'Alpha Early Adults', startTime: '06:45', weekday: 6, mode: 'personal_training' })
    expect((await w.req('POST', '/v1/classes', { name: 'Bad', mode: 'knitting', startTime: '07:30', weekday: 1 })).status).toBe(400)
    expect((await w.req('POST', '/v1/classes', { name: 'Bad', mode: 'tutoring', startTime: '25:30', weekday: 1 })).status).toBe(400)
    expect((await w.req('PATCH', `/v1/classes/${c.id}`, { weekday: 9 })).status).toBe(400)
  })

  it('deletes a class with its enrollments and decks; refuses while a session is live', async () => {
    const w = await world()
    expect((await w.req('DELETE', `/v1/classes/${w.A.classId}`)).status).toBe(409) // the tenant has a live session
    await w.db.update(sessions).set({ endedAt: new Date('2026-10-20T01:00:00Z') }).where(eq(sessions.id, w.A.sessionId))
    const r = await w.req('DELETE', `/v1/classes/${w.A.classId}`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect((await w.db.select().from(classes).where(eq(classes.id, w.A.classId))).length).toBe(0)
    expect((await w.db.select().from(enrollments).where(eq(enrollments.classId, w.A.classId))).length).toBe(0)
    expect((await w.db.select().from(decks).where(eq(decks.classId, w.A.classId))).length).toBe(0)
    expect((await w.db.select().from(drills).where(eq(drills.deckId, w.A.deckId))).length).toBe(0)
    expect((await w.db.select().from(deckDiffs).where(eq(deckDiffs.deckId, w.A.deckId))).length).toBe(0)
    // Students stay (they may be in other classes); B's class is untouched.
    expect((await w.db.select().from(students).where(eq(students.id, w.A.studentIds[0]!))).length).toBe(1)
    expect((await w.db.select().from(classes).where(eq(classes.id, w.B.classId))).length).toBe(1)
  })

  it('cross-instructor class writes are 404', async () => {
    const w = await world()
    expect((await w.req('PATCH', `/v1/classes/${w.B.classId}`, { name: 'Mine' })).status).toBe(404)
    expect((await w.req('DELETE', `/v1/classes/${w.B.classId}`)).status).toBe(404)
    expect((await w.db.select().from(classes).where(eq(classes.id, w.B.classId)))[0]!.name).toBe('Bravo Kids')
  })
})
