import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { instructors, classes, students, enrollments, guardians, curriculum, decks, drills } from './db/schema'

async function setup() {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Jake Ross'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: 'P', email: 'p@example.com' })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Horse stance holds', minutes: 4, kind: 'drill' }).returning()
  const deps = makeDeps(db, { llm: fakeLlm(() => ({ intents: [{ type: 'feedback', studentNames: ['Priya'], content: 'great stance', skillTags: ['stance'], urgency: null, amount: null, minutes: null, attendanceStatus: null }] })) })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return { app, h, classId: c!.id, drillId: dr!.id }
}

describe('http', () => {
  it('rejects bad pairing codes and unauthenticated calls', async () => {
    const { app } = await setup()
    expect((await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: 'nope' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(401)
    expect((await app.request('/v1/today')).status).toBe(401)
  })

  it('runs a class: today → start → drill → text note → end', async () => {
    const { app, h, classId, drillId } = await setup()
    const today = await (await app.request('/v1/today', { headers: h })).json() as { classId: string; theme: string; deck: { drills: unknown[] } }
    expect(today).toMatchObject({ classId, theme: 'Stances' })
    expect(today.deck.drills).toHaveLength(1)
    const start = await (await app.request('/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ classId }) })).json() as { sessionId: string }
    expect((await app.request(`/v1/sessions/${start.sessionId}/drills/${drillId}/start`, { method: 'POST', headers: h })).status).toBe(200)
    const form = new FormData()
    form.set('sessionId', start.sessionId); form.set('drillId', drillId); form.set('mode', 'note'); form.set('text', 'Priya great stance')
    const u = await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })
    expect(u.status).toBe(200)
    expect(((await u.json()) as { cardLines: string[] }).cardLines[0]).toBe('✓ Priya · stance')
    const wrap = await (await app.request(`/v1/sessions/${start.sessionId}/end`, { method: 'POST', headers: h })).json() as { coverage: { covered: number; present: number }; missed: { name: string }[]; drillsRun: number }
    expect(wrap.coverage).toEqual({ covered: 1, present: 3 })
    expect(wrap.missed.map(m => m.name).sort()).toEqual(['Jake', 'Leo'])
    expect(wrap.drillsRun).toBe(1)
  })

  it('validates utterance input', async () => {
    const { app, h } = await setup()
    const form = new FormData(); form.set('mode', 'note')
    expect((await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })).status).toBe(400)
  })
})
