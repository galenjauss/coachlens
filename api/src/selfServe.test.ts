import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps } from './test/helpers'
import { makeTenant, pairWith } from './test/tenants'
import { createApp } from './app'
import { instructors, outbox } from './db/schema'
import { BudgetExceededError, dailyMeter } from './agents/budget'
import { runAs } from './http/context'
import { createSelfServeInstructor, cronInstructors, MAX_CLASSES, SELF_SERVE_EMAIL_DOMAIN } from './services/accounts'
import { SIGNUP_IP_LIMIT, signupIpKey } from './services/pairLimits'

const post = (path: string, headers: Record<string, string> = {}) => ({ method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', ...headers } })
const signup = async (app: ReturnType<typeof createApp>, ip = '203.0.113.7') => app.request('/signup', post('/signup', { 'x-vercel-forwarded-for': ip }))

describe('self-serve accounts', () => {
  beforeEach(() => resetRateLimits())

  it('one tap creates a private, empty account and a working token; today asks for setup instead of failing', async () => {
    const db = await makeTestDb()
    const other = await makeTenant(db, 'A')
    const app = createApp(makeDeps(db))
    const r = await signup(app)
    expect(r.status).toBe(200)
    const { token } = await r.json() as { token: string }
    const h = { Authorization: `Bearer ${token}` }
    const today = await app.request('/v1/today', { headers: h })
    expect(today.status).toBe(409)
    expect(await today.json()).toEqual({ error: 'needs_setup' })
    expect(await (await app.request('/v1/classes', { headers: h })).json()).toEqual([])
    // Another coach's data stays invisible to the new account.
    expect((await app.request(`/v1/students/${other.studentIds[0]}`, { headers: h })).status).toBe(404)
    const rows = await db.select().from(instructors)
    expect(rows.filter(i => i.email.endsWith(`@${SELF_SERVE_EMAIL_DOMAIN}`))).toHaveLength(1)
  })

  it('limits sign-ups per client IP and per day overall', async () => {
    const db = await makeTestDb()
    const app = createApp(makeDeps(db, { env: { ...makeDeps(db).env, signupDailyCap: SIGNUP_IP_LIMIT + 1 } }))
    for (let i = 0; i < SIGNUP_IP_LIMIT; i++) expect((await signup(app)).status).toBe(200)
    expect((await signup(app)).status).toBe(429) // same IP
    expect((await signup(app, '198.51.100.2')).status).toBe(200) // another IP: allowed, and the day's last
    const r = await signup(app, '198.51.100.3')
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'signups_paused' })
  })

  it('a self-serve account never has CoachLens send email: approving hands the draft off to the coach', async () => {
    const db = await makeTestDb()
    const t = await makeTenant(db, 'B')
    await db.update(instructors).set({ email: `x@${SELF_SERVE_EMAIL_DOMAIN}` }).where(eq(instructors.id, t.instructorId))
    const deps = makeDeps(db)
    const app = createApp(deps)
    const { h } = await pairWith(app, t.code)
    const r = await app.request(`/v1/review/outbox/${t.outboxId}/approve`, { method: 'POST', headers: h, body: JSON.stringify({ subject: 'Edited' }) })
    expect(await r.json()).toEqual({ ok: true, handedOff: true })
    expect(deps.sent).toHaveLength(0)
    const [row] = await db.select().from(outbox).where(eq(outbox.id, t.outboxId))
    expect(row).toMatchObject({ status: 'handed_off', subject: 'Edited' })
    expect(await (await app.request('/v1/status', { headers: h })).json()).toMatchObject({ mailSends: false })
  })

  it('an operator-created account (or one in MAIL_SENDERS) still sends', async () => {
    const db = await makeTestDb()
    const t = await makeTenant(db, 'C')
    await db.update(instructors).set({ email: `y@${SELF_SERVE_EMAIL_DOMAIN}` }).where(eq(instructors.id, t.instructorId))
    const deps = makeDeps(db, { env: { ...makeDeps(db).env, mailSenders: [`y@${SELF_SERVE_EMAIL_DOMAIN}`] } })
    const app = createApp(deps)
    const { h } = await pairWith(app, t.code)
    expect(await (await app.request(`/v1/review/outbox/${t.outboxId}/approve`, { method: 'POST', headers: h, body: '{}' })).json()).toEqual({ ok: true })
    expect(deps.sent).toHaveLength(1)
  })

  it('daily meters cap each account first, then the whole day; meters do not share counts', async () => {
    const db = await makeTestDb()
    const now = () => new Date('2026-10-20T00:30:00Z')
    const stt = dailyMeter(db, { meter: 'stt', cap: 3, instructorCap: 2, tz: 'America/Los_Angeles', now })
    const ai = dailyMeter(db, { meter: 'ai', cap: 1, tz: 'America/Los_Angeles', now })
    await runAs('coach-1', async () => {
      await stt.take(); await stt.take()
      await expect(stt.take()).rejects.toMatchObject({ meter: 'stt' })
      await ai.take() // the AI meter is separate
    })
    await runAs('coach-2', async () => {
      await stt.take() // the day's third (coach-1's refused call counted toward their own cap only)
      await expect(stt.take()).rejects.toBeInstanceOf(BudgetExceededError)
    })
  })

  it('a used-up speech-to-text allowance is a 429 the phone retries, not a lost note', async () => {
    const db = await makeTestDb()
    const t = await makeTenant(db, 'D')
    const app = createApp(makeDeps(db, { stt: { async transcribe() { throw new BudgetExceededError('stt') } } }))
    const { h } = await pairWith(app, t.code)
    const form = new FormData()
    form.set('audio', new File([new Uint8Array(64)], 'a.wav', { type: 'audio/wav' }))
    const r = await app.request('/v1/transcribe', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })
    expect(r.status).toBe(429)
    expect(await r.json()).toEqual({ error: 'stt_budget_reached' })
  })
})

describe('self-serve abuse bounds (review follow-ups)', () => {
  beforeEach(() => resetRateLimits())

  it('self-serve accounts spend from their own pool: sign-ups cannot use up the operator day', async () => {
    const db = await makeTestDb()
    const now = () => new Date('2026-10-20T00:30:00Z')
    const isPublic = async (id: string) => id.startsWith('pub')
    const ai = dailyMeter(db, { meter: 'ai', cap: 2, tz: 'America/Los_Angeles', now, publicPool: { cap: 2, instructorCap: 1, isPublic } })
    await runAs('pub-1', () => ai.take())
    await runAs('pub-1', () => expect(ai.take()).rejects.toBeInstanceOf(BudgetExceededError)) // own cap
    await runAs('pub-2', () => ai.take())
    await runAs('pub-3', () => expect(ai.take()).rejects.toBeInstanceOf(BudgetExceededError)) // public pool spent
    await runAs('operator', async () => { await ai.take(); await ai.take() }) // operator pool untouched
  })

  it('keys IPv6 sign-ups by /64 and puts unknown clients in one strict bucket', async () => {
    expect(signupIpKey('203.0.113.7')).toBe('203.0.113.7')
    expect(signupIpKey('2001:db8:1:2:aaaa::1')).toBe('2001:db8:1:2::/64')
    expect(signupIpKey('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee')).toBe('2001:db8:1:2::/64')
    expect(signupIpKey('2001:db8::5')).toBe('2001:db8:0:0::/64')
    const db = await makeTestDb()
    const app = createApp(makeDeps(db))
    for (let i = 0; i < SIGNUP_IP_LIMIT; i++) expect((await app.request('/signup', post('/signup'))).status).toBe(200)
    expect((await app.request('/signup', post('/signup'))).status).toBe(429)
  })

  it('nightly jobs skip abandoned sign-ups and do operator accounts first', async () => {
    const db = await makeTestDb()
    const op = await makeTenant(db, 'O') // has a session on 2026-10-20
    const pub = await makeTenant(db, 'P')
    await db.update(instructors).set({ email: `p@${SELF_SERVE_EMAIL_DOMAIN}` }).where(eq(instructors.id, pub.instructorId))
    const idle = await createSelfServeInstructor(db)
    const order = await cronInstructors(db, new Date('2026-10-25T00:00:00Z'))
    expect(order).toEqual([op.instructorId, pub.instructorId])
    expect(order).not.toContain(idle)
    expect(await cronInstructors(db, new Date('2026-12-25T00:00:00Z'))).toEqual([op.instructorId]) // inactive for weeks
  })

  it('refuses classes past the per-account ceiling', async () => {
    const db = await makeTestDb()
    const app = createApp(makeDeps(db))
    const { token } = await (await signup(app)).json() as { token: string }
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const mk = () => app.request('/v1/classes', { method: 'POST', headers: h, body: JSON.stringify({ name: `C${Math.random()}`, weekday: 1, startTime: '17:00', mode: 'martial_arts' }) })
    for (let i = 0; i < MAX_CLASSES; i++) expect((await mk()).status).toBe(201)
    expect((await mk()).status).toBe(409)
  })
})
