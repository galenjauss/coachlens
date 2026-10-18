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

  describe('PAIRING_CODE sync (fix round 2)', () => {
    async function demoDb(code: string | null, pepper?: string) {
      const db = await makeTestDb()
      const [demo] = await db.insert(instructors).values({ name: 'Demo', email: DEMO_INSTRUCTOR_EMAIL }).returning()
      await db.insert(instructors).values({ name: 'Other', email: 'other@example.test' })
      if (code) await setPairingCode(db, demo!.id, code, pepper)
      const deps = makeDeps(db)
      const boot = (env: Partial<typeof deps.env>) => createApp({ ...deps, env: { ...deps.env, ...env } })
      return { db, boot }
    }

    it('first boot: a demo instructor with no code gets the env code', async () => {
      const { boot } = await demoDb(null)
      expect((await pair(boot({ pairingCode: 'env-code-1' }), 'env-code-1')).status).toBe(200)
    })

    it('an existing code is kept on the first run; a later change of the env value moves it', async () => {
      const { boot } = await demoDb('seeded-code-1')
      const app1 = boot({ pairingCode: 'env-code-1' })
      expect((await pair(app1, 'seeded-code-1')).status).toBe(200)
      expect((await pair(app1, 'env-code-1')).status).toBe(401)
      const app2 = boot({ pairingCode: 'env-code-2' }) // a redeploy with a new PAIRING_CODE
      expect((await pair(app2, 'env-code-2')).status).toBe(200)
      expect((await pair(app2, 'seeded-code-1')).status).toBe(401)
    })

    it('a code rotated in the app always wins over later env changes', async () => {
      const { boot } = await demoDb('seeded-code-1')
      const app1 = boot({ pairingCode: 'seeded-code-1' })
      const { h } = await pairWith(app1, 'seeded-code-1')
      const { code } = await (await app1.request('/v1/pairing/rotate', { method: 'POST', headers: h })).json() as { code: string }
      const app2 = boot({ pairingCode: 'env-code-2' })
      expect((await pair(app2, code)).status).toBe(200)
      expect((await pair(app2, 'env-code-2')).status).toBe(401)
    })

    it('a pepper change alone never resets a code; PAIRING_PEPPER_PREVIOUS matches once and upgrades', async () => {
      const { db, boot } = await demoDb('seeded-code-1', 'old-pepper')
      const app1 = boot({ pairingCode: 'seeded-code-1', pairingPepper: 'old-pepper' })
      expect((await pair(app1, 'seeded-code-1')).status).toBe(200)
      const app2 = boot({ pairingCode: 'seeded-code-1', pairingPepper: 'new-pepper', pairingPepperPrevious: 'old-pepper' })
      expect((await pair(app2, 'seeded-code-1')).status).toBe(200)
      const [demo] = await db.select().from(instructors).where(eq(instructors.email, DEMO_INSTRUCTOR_EMAIL))
      expect(demo!.pairingCodeHash).toBe(await hashPairingCode('seeded-code-1', 'new-pepper'))
      const app3 = boot({ pairingCode: 'seeded-code-1', pairingPepper: 'new-pepper' })
      expect((await pair(app3, 'seeded-code-1')).status).toBe(200)
    })
  })

  it('without a trusted IP header nobody shares a lockout bucket; the prefix bucket never refuses a matching code', async () => {
    const db = await makeTestDb()
    const A = await makeTenant(db, 'Alpha')
    const app = createApp(makeDeps(db))
    for (let i = 0; i < 20; i++) expect((await pair(app, `zz-wrong-${i}`)).status).toBe(401)
    expect((await pair(app, A.code)).status).toBe(200)
    // Same-prefix guesses: refused after 30 failures, while the real code (another prefix or not) still pairs.
    for (let i = 0; i < 11; i++) await pair(app, `zz-more-${i}`)
    expect((await pair(app, 'zz-again')).status).toBe(429)
    await setPairingCode(db, A.instructorId, 'zz-real-code')
    expect((await pair(app, 'zz-real-code')).status).toBe(200)
  })

  it('pair_attempts is pruned by the daily cron and opportunistically', async () => {
    const { pairAttempts } = await import('./db/schema')
    const { bump } = await import('./services/pairLimits')
    const db = await makeTestDb()
    await db.insert(pairAttempts).values([{ bucket: 'ip:old', count: 3, windowStart: new Date('2026-10-01T00:00:00Z') }, { bucket: 'ip:older', count: 1, windowStart: new Date('2026-09-01T00:00:00Z') }])
    const app = createApp(makeDeps(db))
    expect((await app.request('/jobs/plan', { headers: { Authorization: 'Bearer cron' } })).status).toBe(200)
    expect(await db.select().from(pairAttempts)).toEqual([])
    await db.insert(pairAttempts).values({ bucket: 'ip:stale', count: 3, windowStart: new Date('2026-10-01T00:00:00Z') })
    await bump(db, 'ip:new', new Date('2026-10-20T00:00:00Z'), true)
    expect((await db.select().from(pairAttempts)).map(r => r.bucket)).toEqual(['ip:new'])
  })
})
