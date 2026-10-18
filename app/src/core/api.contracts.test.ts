import { describe, expect, it } from 'vitest'
import { ApiError, createApi } from './api'

const JSON_HDR = { 'content-type': 'application/json' }
type Seen = { url: string; method: string; headers: Headers; body: BodyInit | null | undefined }

/** A fake fetch: answers each call from `reply` and records what was sent. No real network. */
function fake(reply: (url: string, init: RequestInit) => Response) {
  const seen: Seen[] = []
  const fetchImpl = ((url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers), body: init.body })
    return Promise.resolve(reply(url, init))
  }) as unknown as typeof fetch
  return { api: createApi('http://x', async () => 'tok', fetchImpl), seen }
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { ...JSON_HDR, ...headers } })
const utter = { utteranceId: 'u1', transcript: 'hi', cardLines: ['√ Priya'], coverage: { covered: 1, present: 3 }, nextStudent: null, disambiguation: null }

describe('C1 · idempotent utterance requests (F03)', () => {
  it('sends opId as a form field AND the Idempotency-Key header', async () => {
    const { api, seen } = fake(() => json(utter))
    await api.utterance({ sessionId: 's', drillId: null, mode: 'note', text: 'hi', audio: null }, { opId: 'op-123' })
    expect(seen[0]!.headers.get('Idempotency-Key')).toBe('op-123')
    expect((seen[0]!.body as FormData).get('opId')).toBe('op-123')
  })
  it('a replayed response (Idempotent-Replay: true) parses as an ordinary success', async () => {
    const { api } = fake(() => json(utter, 200, { 'Idempotent-Replay': 'true' }))
    await expect(api.utterance({ sessionId: 's', drillId: null, mode: 'note', text: 'hi', audio: null }, { opId: 'op' })).resolves.toEqual(utter)
  })
  it('409 in_progress is an ApiError the outbox can recognise', async () => {
    const { api } = fake(() => json({ error: 'in_progress' }, 409))
    await expect(api.utterance({ sessionId: 's', drillId: null, mode: 'note', text: 'hi', audio: null }, { opId: 'op' })).rejects.toMatchObject({ status: 409, message: 'in_progress' })
  })
  it('transcribe may carry the key too (optional there)', async () => {
    const { api, seen } = fake(() => json({ transcript: 'ok' }))
    await api.transcribe(new Blob(['x']), { sessionId: 's', opId: 'op-9' })
    expect(seen[0]!.headers.get('Idempotency-Key')).toBe('op-9')
  })
})

describe('Retry-After on errors (F07)', () => {
  it('seconds and HTTP-date forms become retryAfterMs; absent → undefined', async () => {
    const now = Date.now()
    let r = fake(() => json({ error: 'rate_limited' }, 429, { 'Retry-After': '7' }))
    await expect(r.api.today()).rejects.toMatchObject({ status: 429, retryAfterMs: 7000 })
    r = fake(() => json({ error: 'rate_limited' }, 503, { 'Retry-After': new Date(now + 30_000).toUTCString() }))
    const e = (await r.api.today().then(() => null, (x: unknown) => x)) as ApiError
    expect(e.retryAfterMs).toBeGreaterThan(25_000)
    expect(e.retryAfterMs).toBeLessThanOrEqual(31_000)
    r = fake(() => json({ error: 'x' }, 500))
    await expect(r.api.today()).rejects.toMatchObject({ status: 500, retryAfterMs: undefined })
  })
})

describe('C2 · undo (F02)', () => {
  it('parses reversed / cancelled / notReversible', async () => {
    const body = { ok: true, reversed: ['Removed Priya note'], cancelled: ['Cancelled email draft for Dee'], notReversible: [] }
    const { api, seen } = fake(() => json(body))
    await expect(api.undo('u 1')).resolves.toMatchObject(body)
    expect(seen[0]).toMatchObject({ url: 'http://x/v1/utterances/u%201/undo', method: 'POST' })
  })
  it('409 already_undone and 404 surface as ApiError', async () => {
    await expect(fake(() => json({ error: 'already_undone' }, 409)).api.undo('u')).rejects.toMatchObject({ status: 409, message: 'already_undone' })
    await expect(fake(() => json({ error: 'not_found' }, 404)).api.undo('u')).rejects.toMatchObject({ status: 404 })
  })
})

describe('C3 · roster and class maintenance (F16, F23)', () => {
  it('candidates for a note', async () => {
    const body = { classId: 'c1', className: 'Kids · Tue', capturedAt: '2026-10-18T17:05:00Z', students: [{ id: 's1', name: 'Sam Lee', nickname: null, aliases: [] }] }
    const { api, seen } = fake(() => json(body))
    await expect(api.noteCandidates('n/1')).resolves.toEqual(body)
    expect(seen[0]!.url).toBe('http://x/v1/notes/n%2F1/candidates')
  })
  it('create / update / delete a student', async () => {
    const { api, seen } = fake((url, init) => (init.method === 'DELETE' ? json({ ok: true }) : json({ id: 's9', name: 'Ava Cruz', nickname: null, belt: 'white' })))
    await api.createStudent({ name: 'Ava Cruz', classIds: ['c1'], guardians: [{ name: 'Cruz family', email: 'p@example.com' }] })
    await api.updateStudent('s9', { name: 'Ava M. Cruz', guardians: [] })
    await expect(api.deleteStudent('s9')).resolves.toEqual({ ok: true })
    expect(seen.map(s => `${s.method} ${s.url}`)).toEqual(['POST http://x/v1/students', 'PATCH http://x/v1/students/s9', 'DELETE http://x/v1/students/s9'])
    expect(JSON.parse(seen[0]!.body as string)).toEqual({ name: 'Ava Cruz', classIds: ['c1'], guardians: [{ name: 'Cruz family', email: 'p@example.com' }] })
    expect(JSON.parse(seen[1]!.body as string)).toEqual({ name: 'Ava M. Cruz', guardians: [] })
  })
  it('create / update / delete a class; a live class refuses delete with 409', async () => {
    const row = { id: 'c9', name: 'Teens', mode: 'martial_arts', modeLabel: 'Martial arts', startTime: '18:00', weekday: 3 }
    const { api, seen } = fake((url, init) => (init.method === 'DELETE' ? json({ error: 'session_live' }, 409) : json(row)))
    await expect(api.createClass({ name: 'Teens', mode: 'martial_arts', startTime: '18:00', weekday: 3 })).resolves.toMatchObject({ id: 'c9' })
    await api.updateClass('c9', { startTime: '18:30' })
    await expect(api.deleteClass('c9')).rejects.toMatchObject({ status: 409 })
    expect(seen.map(s => `${s.method} ${s.url}`)).toEqual(['POST http://x/v1/classes', 'PATCH http://x/v1/classes/c9', 'DELETE http://x/v1/classes/c9'])
  })
})

describe('C4 · unpair (F18)', () => {
  it('POST /v1/unpair with the current token', async () => {
    const { api, seen } = fake(() => json({ ok: true }))
    await expect(api.unpair()).resolves.toEqual({ ok: true })
    expect(seen[0]).toMatchObject({ url: 'http://x/v1/unpair', method: 'POST' })
    expect(seen[0]!.headers.get('Authorization')).toBe('Bearer tok')
  })
})

describe('review items carry an optional urgent flag (F17)', () => {
  it('keeps urgent when present and parses items without it', async () => {
    const items = [
      { kind: 'parent_email', id: 'o1', studentName: 'Dee', to: 'p@x', subject: 's', body: 'b', createdAt: '2026-10-18T00:00:00Z', urgent: true },
      { kind: 'unassigned_note', id: 'n1', heard: 'Alex', text: 't', createdAt: '2026-10-18T00:00:00Z' },
    ]
    const { api } = fake(() => json(items))
    const got = await api.review()
    expect(got[0]!.urgent).toBe(true)
    expect(got[1]!.urgent).toBeUndefined()
  })
})

describe('batch 2 follow-ups', () => {
  it('POST /v1/tokens/revoke-others returns how many other phones were signed out', async () => {
    const { api, seen } = fake(() => json({ ok: true, revoked: 2 }))
    await expect(api.revokeOtherTokens()).resolves.toEqual({ ok: true, revoked: 2 })
    expect(seen[0]).toMatchObject({ url: 'http://x/v1/tokens/revoke-others', method: 'POST' })
    expect(seen[0]!.headers.get('Authorization')).toBe('Bearer tok')
  })
  it('an Undo reply with the extra coverage field parses (and keeps it)', async () => {
    const body = { ok: true, reversed: ['Removed Priya note'], cancelled: [], notReversible: [], coverage: { covered: 3, present: 12 } }
    await expect(fake(() => json(body)).api.undo('u')).resolves.toEqual(body)
  })
  it('candidates for a note captured outside a class: 409 no_class', async () => {
    await expect(fake(() => json({ error: 'no_class' }, 409)).api.noteCandidates('n')).rejects.toMatchObject({ status: 409, message: 'no_class' })
  })
})
