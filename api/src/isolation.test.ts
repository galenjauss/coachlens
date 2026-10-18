import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { makeTenant, pairWith, seedCurriculum } from './test/tenants'
import { createApp } from './app'
import { apiTokens, notes, outbox, students } from './db/schema'

/** C4 isolation: two instructors, separate classes, students and notes. */
async function world() {
  const db = await makeTestDb()
  await seedCurriculum(db)
  const A = await makeTenant(db, 'Alpha', { weekday: 1 })
  const B = await makeTenant(db, 'Bravo', { weekday: 1 })
  const deps = makeDeps(db, { llm: fakeLlm(() => { throw new Error('llm not stubbed') }) })
  const app = createApp(deps)
  const a = await pairWith(app, A.code)
  const b = await pairWith(app, B.code)
  return { db, deps, app, A, B, a, b }
}

type W = Awaited<ReturnType<typeof world>>
const get = async (w: W, path: string, h = w.a.h) => w.app.request(path, { headers: h })
const send = async (w: W, method: string, path: string, body: unknown = {}, h = w.a.h) =>
  w.app.request(path, { method, headers: h, body: JSON.stringify(body) })

describe('C4 pairing and tokens', () => {
  beforeEach(() => resetRateLimits())

  it('pairs each code to its own instructor; the env code never falls back to the first instructor', async () => {
    const w = await world()
    const r = await w.app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
    expect(r.status).toBe(401)
    const mine = await (await get(w, '/v1/classes')).json() as { id: string }[]
    expect(mine.map(c => c.id)).toEqual([w.A.classId])
    const theirs = await (await get(w, '/v1/classes', w.b.h)).json() as { id: string }[]
    expect(theirs.map(c => c.id)).toEqual([w.B.classId])
  })

  it('rotates the code: the new code pairs once returned, the old code stops working, existing tokens stay', async () => {
    const w = await world()
    const rot = await send(w, 'POST', '/v1/pairing/rotate')
    expect(rot.status).toBe(200)
    const { code } = await rot.json() as { code: string }
    expect(code).toMatch(/^[A-Z2-9]{10}$/)
    expect((await w.app.request('/pair', { method: 'POST', body: JSON.stringify({ code: w.A.code }), headers: { 'Content-Type': 'application/json' } })).status).toBe(401)
    const again = await pairWith(w.app, code)
    expect((await (await get(w, '/v1/classes', again.h)).json() as { id: string }[]).map(c => c.id)).toEqual([w.A.classId])
    expect((await get(w, '/v1/classes')).status).toBe(200)
  })

  it('unpair revokes the calling token only', async () => {
    const w = await world()
    const second = await pairWith(w.app, w.A.code)
    expect((await send(w, 'POST', '/v1/unpair')).status).toBe(200)
    expect((await get(w, '/v1/classes')).status).toBe(401)
    expect((await get(w, '/v1/classes', second.h)).status).toBe(200)
  })

  it('tokens expire after 90 days', async () => {
    const w = await world()
    const [row] = await w.db.select().from(apiTokens).where(eq(apiTokens.instructorId, w.A.instructorId)).limit(1)
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBe(90 * 86_400_000)
    await w.db.update(apiTokens).set({ expiresAt: new Date('2026-01-01T00:00:00Z') }).where(eq(apiTokens.instructorId, w.A.instructorId))
    expect((await get(w, '/v1/classes')).status).toBe(401)
    expect((await get(w, '/v1/classes', w.b.h)).status).toBe(200)
  })

  it('stores pairing codes and tokens hashed only', async () => {
    const w = await world()
    const rows = await w.db.select().from(apiTokens)
    expect(rows.every(r => !r.tokenHash.includes(w.a.token) && r.tokenHash.length === 64)).toBe(true)
  })
})

describe('C4 isolation: reads', () => {
  beforeEach(() => resetRateLimits())

  it('every list route returns only the caller data', async () => {
    const w = await world()
    const students_ = await (await get(w, '/v1/students')).json() as { id: string }[]
    expect(students_.map(s => s.id).sort()).toEqual([...w.A.studentIds].sort())
    const review = await (await get(w, '/v1/review')).json() as { id: string }[]
    const ids = review.map(r => r.id)
    expect(ids).toEqual(expect.arrayContaining([w.A.outboxId, w.A.billingId, w.A.looseNoteId, w.A.diffId]))
    expect(ids).not.toEqual(expect.arrayContaining([w.B.outboxId]))
    expect(ids.some(i => [w.B.outboxId, w.B.billingId, w.B.looseNoteId, w.B.diffId].includes(i))).toBe(false)
    const feed = await (await get(w, '/v1/agents/feed')).json() as { id: string }[]
    expect(feed.map(f => f.id)).toContain(w.A.runId)
    expect(feed.map(f => f.id)).not.toContain(w.B.runId)
    const progress = await (await get(w, '/v1/agents/progress')).json() as { id: string }[]
    expect(progress.map(r => r.id)).not.toContain(w.B.runId)
    const summary = JSON.stringify(await (await get(w, '/v1/agents/summary')).json())
    expect(summary).not.toContain('Bravo')
    const ins = await (await get(w, '/v1/insights')).json() as { insights: { id: string }[] }
    expect(ins.insights.map(i => i.id)).toContain(w.A.insightId)
    expect(ins.insights.map(i => i.id)).not.toContain(w.B.insightId)
    const today = await (await get(w, '/v1/today')).json() as { classId: string; roster: { id: string }[] }
    expect(today.classId).toBe(w.A.classId)
    expect(today.roster.map(r => r.id).sort()).toEqual([...w.A.studentIds].sort())
  })

  it('reading another instructor entity is a 404', async () => {
    const w = await world()
    for (const path of [
      `/v1/today?classId=${w.B.classId}`, `/v1/students/${w.B.studentIds[0]}`, `/v1/students/${w.B.studentIds[0]}/brief`,
      `/v1/decks/${w.B.deckId}`, `/v1/agents/runs/${w.B.runId}`, `/v1/utterances/${w.B.utteranceId}/runs`,
      `/v1/notes/${w.B.looseNoteId}/candidates`, `/v1/insights?scope=class&classId=${w.B.classId}`, `/v1/insights?sessionId=${w.B.sessionId}`,
    ]) expect([path, (await get(w, path)).status]).toEqual([path, 404])
  })

  it('settings and vocabulary are per instructor', async () => {
    const w = await world()
    expect((await send(w, 'PATCH', '/v1/settings', { autonomy: { parent_email: 'off' }, vocabulary: ['Mawashi'] })).status).toBe(200)
    const mine = await (await get(w, '/v1/settings')).json() as { autonomy: Record<string, string>; vocabulary: string[] }
    const theirs = await (await get(w, '/v1/settings', w.b.h)).json() as { autonomy: Record<string, string>; vocabulary: string[] }
    expect(mine.autonomy.parent_email).toBe('off')
    expect(mine.vocabulary).toEqual(['Mawashi'])
    expect(theirs.autonomy.parent_email).not.toBe('off')
    expect(theirs.vocabulary).toEqual([])
  })

  it('onboarding status counts only the caller classes and students', async () => {
    const w = await world()
    const st = await (await get(w, '/v1/onboarding/status')).json() as { classCount: number; studentCount: number }
    expect(st).toMatchObject({ classCount: 1, studentCount: 2 })
  })
})

describe('C4 isolation: writes', () => {
  beforeEach(() => resetRateLimits())

  it('every write to another instructor entity is a 404 and changes nothing', async () => {
    const w = await world()
    const B = w.B
    const form = () => { const f = new FormData(); f.set('sessionId', B.sessionId); f.set('mode', 'note'); f.set('text', 'Bravia great stance'); return f }
    const cases: [string, string, unknown][] = [
      ['POST', '/v1/sessions', { classId: B.classId }],
      ['POST', `/v1/sessions/${B.sessionId}/attendance`, { presentIds: [] }],
      ['POST', `/v1/sessions/${B.sessionId}/end`, {}],
      ['POST', `/v1/sessions/${B.sessionId}/remind`, { studentIds: [] }],
      ['POST', `/v1/sessions/${B.sessionId}/drills/${B.drillId}/start`, {}],
      ['POST', `/v1/utterances/${B.utteranceId}/undo`, {}],
      ['POST', `/v1/notes/${B.looseNoteId}/assign`, { studentId: B.studentIds[0] }],
      ['POST', `/v1/notes/${B.looseNoteId}/dismiss`, {}],
      ['POST', `/v1/review/outbox/${B.outboxId}/approve`, {}],
      ['POST', `/v1/review/outbox/${B.outboxId}/skip`, {}],
      ['POST', `/v1/review/outbox/${B.outboxId}/redraft`, { instruction: 'shorter please' }],
      ['POST', `/v1/review/billing/${B.billingId}/handle`, {}],
      ['POST', `/v1/review/billing/${B.billingId}/note`, { note: 'x' }],
      ['PATCH', `/v1/decks/${B.deckId}`, { drills: [] }],
      ['POST', `/v1/decks/${B.deckId}/suggest`, { text: 'more games' }],
      ['POST', `/v1/decks/${B.deckId}/replace`, { source: 'last' }],
      ['POST', `/v1/decks/${w.A.deckId}/replace`, { source: { deckId: B.deckId } }],
      ['POST', `/v1/decks/${w.A.deckId}/replace`, { source: { classId: B.classId } }],
      ['POST', `/v1/diffs/${B.diffId}/accept`, { remember: false }],
      ['POST', `/v1/diffs/${B.diffId}/undo`, {}],
      ['POST', '/v1/plan/voice', { classId: B.classId, transcript: 'add a game at the end' }],
      ['POST', `/v1/drills/${B.drillId}/alternatives`, {}],
      ['PATCH', `/v1/students/${B.studentIds[0]}`, { belt: 'black' }],
      ['POST', `/v1/students/${B.studentIds[0]}/metrics`, { key: 'deadlift', value: '300 lb' }],
      ['DELETE', `/v1/students/${B.studentIds[0]}`, {}],
      ['DELETE', `/v1/metrics/${B.metricId}`, {}],
      ['POST', `/v1/insights/${B.insightId}/accept`, {}],
      ['POST', `/v1/insights/${B.insightId}/dismiss`, {}],
      ['PATCH', `/v1/classes/${B.classId}`, { name: 'Mine now' }],
      ['DELETE', `/v1/classes/${B.classId}`, {}],
    ]
    for (const [method, path, body] of cases) expect([method, path, (await send(w, method, path, body)).status]).toEqual([method, path, 404])
    const u = await w.app.request('/v1/utterance', { method: 'POST', headers: { Authorization: w.a.h.Authorization }, body: form() })
    expect(u.status).toBe(404)
    // Cross-instructor references inside an own write are rejected too.
    expect((await send(w, 'POST', `/v1/notes/${w.A.looseNoteId}/assign`, { studentId: B.studentIds[0] })).status).toBe(400)
    expect((await send(w, 'POST', '/v1/students', { name: 'Sneaky', classIds: [B.classId] })).status).toBe(404)
    expect((await send(w, 'POST', '/v1/report-cards/run', { studentIds: [B.studentIds[0]] })).status).toBe(400)
    expect((await send(w, 'POST', '/v1/review/outbox/approve-all', { ids: [B.outboxId] })).status).toBe(200)
    // Nothing of B changed.
    const [bs] = await w.db.select().from(students).where(eq(students.id, B.studentIds[0]!))
    expect(bs!.belt).toBe('yellow')
    const [bo] = await w.db.select().from(outbox).where(eq(outbox.id, B.outboxId))
    expect(bo!.status).toBe('pending_review')
    expect(w.deps.sent).toHaveLength(0)
    expect((await w.db.select().from(notes).where(eq(notes.id, B.looseNoteId))).length).toBe(1)
  })
})
