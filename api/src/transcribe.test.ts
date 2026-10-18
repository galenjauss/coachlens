import { describe, it, expect, beforeEach } from 'vitest'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps } from './test/helpers'
import { createApp } from './app'
import { instructors, classes, students, enrollments, sessions, decks } from './db/schema'
import { hintsFor } from './services/hints'

async function setup(reply = 'Priya keep your guard up') {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const [other] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Adults Wed', weekday: 3, startTime: '19:00' }).returning()
  const [priya, leo] = await db.insert(students).values([
    { name: 'Priya Rao', belt: 'yellow', birthYear: 2018, aliases: ['Pria'] },
    { name: 'Leo Diaz', belt: 'yellow', birthYear: 2018 },
  ]).returning()
  await db.insert(enrollments).values([{ classId: c!.id, studentId: priya!.id }, { classId: other!.id, studentId: leo!.id }])
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19' }).returning()
  const [s] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:30:00Z') }).returning()
  const calls: { bytes: number; hints: string[] }[] = []
  const deps = makeDeps(db, { stt: { async transcribe(audio: Uint8Array, hints: string[]) { calls.push({ bytes: audio.length, hints }); return reply } } })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  return { app, db, auth: { Authorization: `Bearer ${token}` }, calls, classId: c!.id, otherClassId: other!.id, sessionId: s!.id }
}

const wavForm = (fields: Record<string, string> = {}) => {
  const f = new FormData()
  f.set('audio', new Blob([new Uint8Array(4000)], { type: 'audio/wav' }), 'note.wav')
  for (const [k, v] of Object.entries(fields)) f.set(k, v)
  return f
}

describe('POST /v1/transcribe', () => {
  beforeEach(() => resetRateLimits())

  it('requires a valid token', async () => {
    const { app } = await setup()
    expect((await app.request('/v1/transcribe', { method: 'POST', body: wavForm() })).status).toBe(401)
    expect((await app.request('/v1/transcribe', { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: wavForm() })).status).toBe(401)
  })

  it('returns the transcript and passes the session roster (names + aliases) as hints; nothing is saved', async () => {
    const { app, auth, calls, sessionId } = await setup()
    const r = await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm({ sessionId }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ transcript: 'Priya keep your guard up' })
    expect(calls).toEqual([{ bytes: 4000, hints: ['Priya Rao', 'Pria'] }])
  })

  it('takes roster hints from a classId too, and none without a scope', async () => {
    const { app, auth, calls, otherClassId } = await setup()
    await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm({ classId: otherClassId }) })
    await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm() })
    expect(calls.map(c => c.hints)).toEqual([['Leo Diaz'], []])
  })

  it('an empty transcript is a 422', async () => {
    const { app, auth, sessionId } = await setup('   ')
    const r = await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm({ sessionId }) })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'empty_transcript' })
  })

  it('missing audio is a 400, an unknown session a 404, oversized audio a 413', async () => {
    const { app, auth } = await setup()
    const noAudio = new FormData(); noAudio.set('sessionId', 'x')
    expect((await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: noAudio })).status).toBe(400)
    expect((await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm({ sessionId: 'nope' }) })).status).toBe(404)
    const big = new FormData(); big.set('audio', new Blob([new Uint8Array(2_000_001)]), 'note.wav')
    expect((await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: big })).status).toBe(413)
  })

  it('is rate limited per instructor like /v1/utterance', async () => {
    const { app, auth } = await setup()
    let last = 0
    for (let i = 0; i < 121; i++) last = (await app.request('/v1/transcribe', { method: 'POST', headers: auth, body: wavForm() })).status
    expect(last).toBe(429)
  })

  it('/v1/utterance audio uses the same hints', async () => {
    const { app, auth, calls, sessionId } = await setup('')
    const r = await app.request('/v1/utterance', { method: 'POST', headers: auth, body: wavForm({ sessionId, mode: 'note' }) })
    expect(r.status).toBe(422)
    expect(calls).toEqual([{ bytes: 4000, hints: ['Priya Rao', 'Pria'] }])
  })
})

describe('hintsFor', () => {
  it('session → its class roster; class → roster; neither → none', async () => {
    const { db, sessionId, otherClassId } = await setup()
    expect(await hintsFor(db, { sessionId })).toEqual(['Priya Rao', 'Pria'])
    expect(await hintsFor(db, { classId: otherClassId })).toEqual(['Leo Diaz'])
    expect(await hintsFor(db, {})).toEqual([])
  })
})
