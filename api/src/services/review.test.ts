import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps } from '../test/helpers'
import { listReview, approveOutbox, approveAllOutbox, handleBilling, skipOutbox, noteBilling, dismissNote } from './review'
import { students, outbox, billingFlags, notes, agentRuns } from '../db/schema'

async function world() {
  const db = await makeTestDb()
  const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
  const [o1] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s!.id, toEmail: 'anita@example.com', subject: 'Guard', body: 'Hi' }).returning()
  const [o2] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s!.id, toEmail: 'anita@example.com', subject: 'Kata', body: 'Hi' }).returning()
  const [b] = await db.insert(billingFlags).values({ studentId: s!.id, urgency: 'high', note: 'owes for gear' }).returning()
  await db.insert(notes).values({ text: 'unsorted thing', heard: 'Mya' })
  return { db, o1: o1!.id, o2: o2!.id, b: b!.id }
}

describe('review', () => {
  it('lists email, billing and unassigned items', async () => {
    const { db } = await world()
    const items = await listReview(db)
    expect(items.map(i => i.kind).sort()).toEqual(['billing', 'parent_email', 'parent_email', 'unassigned_note'])
  })

  it('approve sends with edits, honoring DEMO_EMAIL_OVERRIDE, and logs a run', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db)
    deps.env.demoEmailOverride = 'me@example.com'
    expect(await approveOutbox(deps, o1, { subject: 'Edited' })).toEqual({ ok: true })
    expect(deps.sent[0]).toMatchObject({ to: 'me@example.com', subject: 'Edited' })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, o1))
    expect(row!.status).toBe('sent')
    expect((await db.select().from(agentRuns))[0]!.agent).toBe('mailer')
  })

  it('send failure keeps item pending with the error', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db, { mail: { async send() { throw new Error('smtp down') } } })
    expect(await approveOutbox(deps, o1)).toEqual({ ok: false, code: 'send_failed', error: 'smtp down' })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, o1))
    expect(row).toMatchObject({ status: 'pending_review', error: 'smtp down' })
  })

  it('approve-all, skip, and handle billing', async () => {
    const { db, o1, o2, b } = await world()
    const deps = makeDeps(db)
    await skipOutbox(db, o2)
    expect(await approveAllOutbox(deps, [o1])).toEqual({ sent: 1, failed: 0 })
    await handleBilling(db, b, 'paid in cash')
    const [bill] = await db.select().from(billingFlags).where(eq(billingFlags.id, b))
    expect(bill).toMatchObject({ status: 'handled' })
    expect(bill!.note).toContain('paid in cash')
    expect((await listReview(db)).map(i => i.kind)).toEqual(['unassigned_note'])
    void o1
  })

  it('concurrent approves send exactly once', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db)
    const [a, b] = await Promise.all([approveOutbox(deps, o1), approveOutbox(deps, o1)])
    expect(deps.sent).toHaveLength(1)
    expect([a.ok, b.ok].sort()).toEqual([false, true])
  })

  it('returns not_found / not_pending codes', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db)
    expect(await approveOutbox(deps, 'nope')).toMatchObject({ ok: false, code: 'not_found' })
    await approveOutbox(deps, o1)
    expect(await approveOutbox(deps, o1)).toMatchObject({ ok: false, code: 'not_pending' })
    expect(await skipOutbox(db, o1)).toMatchObject({ ok: false, code: 'not_pending' })
    expect(await skipOutbox(db, 'nope')).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('send failure is code send_failed and logs an error run', async () => {
    const { db, o1 } = await world()
    const deps = makeDeps(db, { mail: { async send() { throw new Error('smtp down') } } })
    expect(await approveOutbox(deps, o1)).toMatchObject({ ok: false, code: 'send_failed' })
    expect((await db.select().from(agentRuns))[0]).toMatchObject({ agent: 'mailer', status: 'error' })
  })

  it('billing guards and note dismissal', async () => {
    const { db, b } = await world()
    expect(await noteBilling(db, 'nope', 'x')).toMatchObject({ code: 'not_found' })
    expect(await handleBilling(db, 'nope')).toMatchObject({ code: 'not_found' })
    expect(await handleBilling(db, b)).toEqual({ ok: true })
    expect(await handleBilling(db, b)).toMatchObject({ code: 'not_pending' })
    const [assigned] = await db.insert(notes).values({ text: 'x', heard: 'y', studentId: 'someone' }).returning()
    expect(await dismissNote(db, assigned!.id)).toMatchObject({ ok: false, code: 'not_found' })
    const [loose] = await db.select().from(notes).where(eq(notes.text, 'unsorted thing'))
    expect(await dismissNote(db, loose!.id)).toEqual({ ok: true })
  })
})
