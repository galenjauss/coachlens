import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { allowUnscoped, NoInstructorError, runAs } from './http/context'
import { makeTestDb, makeDeps } from './test/helpers'
import { makeTenant, pairWith } from './test/tenants'
import { createApp } from './app'
import { instructors } from './db/schema'
import { hashToken } from './http/auth'
import { DEMO_INSTRUCTOR_EMAIL, hashPairingCode, setPairingCode } from './services/pairing'
import { getAutonomy, getSettings } from './services/settings'
import { vocabHints } from './services/vocab'
import { loadFacts } from './services/insightFacts'
import { runReportCards } from './agents/reportCard'

const pair = (app: ReturnType<typeof createApp>, code: string) =>
  app.request('/pair', { method: 'POST', body: JSON.stringify({ code }), headers: { 'Content-Type': 'application/json' } })

describe('security fix round 1', () => {
  beforeEach(() => resetRateLimits())
  afterEach(() => allowUnscoped(true))

  it('S3: revoke-others signs out every other phone; rotate can do the same', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    const app = createApp(makeDeps(db))
    const [p1, p2, p3] = [await pairWith(app, A.code), await pairWith(app, A.code), await pairWith(app, A.code)]
    const r = await app.request('/v1/tokens/revoke-others', { method: 'POST', headers: p1.h })
    expect(await r.json()).toEqual({ ok: true, revoked: 2 })
    for (const p of [p2, p3]) expect((await app.request('/v1/classes', { headers: p.h })).status).toBe(401)
    expect((await app.request('/v1/classes', { headers: p1.h })).status).toBe(200)
    const p4 = await pairWith(app, A.code)
    const rot = await (await app.request('/v1/pairing/rotate', { method: 'POST', headers: p1.h, body: JSON.stringify({ revokeOthers: true }) })).json() as { code: string; revoked: number }
    expect(rot.revoked).toBe(1)
    expect((await app.request('/v1/classes', { headers: p4.h })).status).toBe(401)
  })

  it('S4: per-instructor reads fail closed outside a request scope unless explicitly allowed', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    allowUnscoped(false)
    for (const call of [() => getAutonomy(db, 'planner'), () => getSettings(db), () => vocabHints(db),
      () => loadFacts(db, undefined, { today: '2026-10-19', now: new Date() }), () => runReportCards(makeDeps(db))]) {
      await expect(call()).rejects.toBeInstanceOf(NoInstructorError)
    }
    expect(await runAs(A.instructorId, () => getAutonomy(db, 'planner'))).toBe('review')
    expect((await runAs(A.instructorId, () => loadFacts(db, undefined, { today: '2026-10-19', now: new Date() }))).length).toBe(2)
  })

  it('pairing codes are keyed (HMAC with the pepper); a first-version hash is accepted once and upgraded', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    const deps = makeDeps(db)
    const app = createApp({ ...deps, env: { ...deps.env, pairingPepper: 'server-secret' } })
    await db.update(instructors).set({ pairingCodeHash: await hashToken(`pair:${A.code}`) }).where(eq(instructors.id, A.instructorId))
    expect((await pair(app, A.code)).status).toBe(200)
    const [row] = await db.select().from(instructors).where(eq(instructors.id, A.instructorId))
    expect(row!.pairingCodeHash).toBe(await hashPairingCode(A.code, 'server-secret'))
    expect(row!.pairingCodeHash).not.toBe(await hashToken(`pair:${A.code}`))
    expect((await pair(app, A.code)).status).toBe(200)
  })

  it('a changed PAIRING_CODE moves the demo instructor to it at boot; a rotated code survives restarts while the env is unchanged', async () => {
    const db = await makeTestDb()
    const [demo] = await db.insert(instructors).values({ name: 'Demo', email: DEMO_INSTRUCTOR_EMAIL }).returning()
    await db.insert(instructors).values({ name: 'Other', email: 'other@example.test' })
    await setPairingCode(db, demo!.id, 'old-code-1')
    const deps = makeDeps(db)
    const boot = () => createApp({ ...deps, env: { ...deps.env, pairingCode: 'new-code-2' } })
    const app1 = boot()
    expect((await pair(app1, 'new-code-2')).status).toBe(200)
    expect((await pair(app1, 'old-code-1')).status).toBe(401)
    const { h } = await pairWith(app1, 'new-code-2')
    const { code } = await (await app1.request('/v1/pairing/rotate', { method: 'POST', headers: h })).json() as { code: string }
    const app2 = boot() // a restart with the same env keeps the rotated code
    expect((await pair(app2, code)).status).toBe(200)
    expect((await pair(app2, 'new-code-2')).status).toBe(401)
  })
})
