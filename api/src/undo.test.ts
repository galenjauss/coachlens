import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { demoWorld, intent } from './test/demo'
import { attendance, billingFlags, drills, notes, outbox, sessions, studentMetrics, students, utterances } from './db/schema'

/** C2 / F02: Undo reverses every action an utterance applied, cancels its pending work, and names what it cannot recall. */
type UndoBody = { ok: true; reversed: string[]; cancelled: string[]; notReversible: string[] }

const router = (t: string): unknown[] => {
  if (/Maya.*black/.test(t)) return [intent({ type: 'metric', studentNames: ['Maya'], content: t, metricKey: 'rank', metricValue: 'black' })]
  if (/Maria.*225/.test(t)) return [intent({ type: 'metric', studentNames: ['Maria'], content: t, metricKey: 'deadlift', metricValue: '225 lb', metricNum: 225, metricUnit: 'lb' })]
  if (/^Tell Dee/.test(t)) return [intent({ type: 'parent_message', studentNames: ['Dee'], content: 'Dee was a great helper today' })]
  if (/Dee/.test(t)) return [intent({ studentNames: ['Dee'], content: 'Dee rolled her ankle, sat out', urgent: true })]
  if (/drill and Leo owes/.test(t)) return [
    intent({ type: 'add_drill', content: 'Shark tag', minutes: 4 }),
    intent({ type: 'billing', studentNames: ['Leo'], content: 'Leo owes for gloves', urgency: 'low', amount: 30 }),
  ]
  return []
}

async function body(r: Response): Promise<UndoBody> {
  expect(r.status).toBe(200)
  const b = await r.json() as UndoBody
  expect(b.ok).toBe(true)
  for (const l of [...b.reversed, ...b.cancelled, ...b.notReversible]) expect(l.length).toBeLessThanOrEqual(38)
  return b
}
const byFirst = async (w: Awaited<ReturnType<typeof demoWorld>>, first: string) =>
  (await w.db.select().from(students)).find(s => s.name.startsWith(`${first} `))!

describe('C2 undo: audit reproductions', () => {
  beforeEach(() => resetRateLimits())

  it('Maya rank change then Undo restores the belt and rank_since and deletes the metric', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const before = await byFirst(w, 'Maya')
    const r = await w.utter(sid, 'Maya is a black belt now')
    const { utteranceId } = await r.json() as { utteranceId: string }
    const changed = await byFirst(w, 'Maya')
    expect(changed.belt).toBe('black')
    expect(changed.rankSince).not.toBe(before.rankSince)
    expect((await w.db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId))).length).toBe(1)
    const b = await body(await w.undo(utteranceId))
    const after = await byFirst(w, 'Maya')
    expect(after.belt).toBe(before.belt)
    expect(after.rankSince).toBe(before.rankSince)
    expect((await w.db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId))).length).toBe(0)
    expect(b.reversed).toEqual(expect.arrayContaining([`Restored Maya rank: ${before.belt}`]))
    expect(b.notReversible).toEqual([])
  })

  it('Maria deadlift PR then Undo deletes the metric', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('PT · Mon 6:00')
    const r = await w.utter(sid, 'Maria hit 225 on deadlift')
    const { utteranceId } = await r.json() as { utteranceId: string }
    expect((await w.db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId))).length).toBe(1)
    const b = await body(await w.undo(utteranceId))
    expect((await w.db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId))).length).toBe(0)
    expect(b.reversed).toEqual(expect.arrayContaining(['Removed Maria deadlift 225 lb']))
  })

  it('roll call 13 → 14 present, then Undo returns to 13 with per-student statuses restored', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const jake = await byFirst(w, 'Jake')
    const [se] = await w.db.select().from(sessions).where(eq(sessions.id, sid))
    const kids = ((await (await w.app.request(`/v1/today?classId=${se!.classId}`, { headers: w.h })).json()) as { roster: { id: string }[] }).roster.map(r => r.id)
    expect(kids.length).toBe(14)
    await w.app.request(`/v1/sessions/${sid}/attendance`, { method: 'POST', headers: w.h, body: JSON.stringify({ presentIds: kids.filter(id => id !== jake.id) }) })
    const snapshot = async () => (await w.db.select().from(attendance).where(eq(attendance.sessionId, sid))).map(a => `${a.studentId}:${a.status}:${a.source}`).sort()
    const present = async () => (await w.db.select().from(attendance).where(and(eq(attendance.sessionId, sid), eq(attendance.status, 'present')))).length
    const before = await snapshot()
    expect(await present()).toBe(13)
    const r = await w.utter(sid, 'everyone is present', { mode: 'attendance' })
    const { utteranceId } = await r.json() as { utteranceId: string }
    expect(await present()).toBe(14)
    const b = await body(await w.undo(utteranceId))
    expect(await present()).toBe(13)
    expect(await snapshot()).toEqual(before)
    expect(b.reversed).toEqual(expect.arrayContaining(['Attendance restored (13 present)']))
  })

  it('urgent Dee note then Undo removes the note and cancels the pending email draft', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const r = await w.utter(sid, 'Dee rolled her ankle')
    const { utteranceId } = await r.json() as { utteranceId: string }
    await w.deps.flush()
    const [draft] = await w.db.select().from(outbox).where(eq(outbox.utteranceId, utteranceId))
    expect(draft!.status).toBe('pending_review')
    const b = await body(await w.undo(utteranceId))
    expect((await w.db.select().from(outbox).where(eq(outbox.id, draft!.id)))[0]!.status).toBe('cancelled')
    expect((await w.db.select().from(notes).where(eq(notes.utteranceId, utteranceId))).length).toBe(0)
    expect(b.reversed).toEqual(expect.arrayContaining(['Removed Dee note']))
    expect(b.cancelled).toEqual(['Cancelled email draft for Dee'])
    // A cancelled draft can no longer be approved, and is gone from Review.
    expect((await w.app.request(`/v1/review/outbox/${draft!.id}/approve`, { method: 'POST', headers: w.h, body: '{}' })).status).toBe(409)
    expect(((await (await w.app.request('/v1/review', { headers: w.h })).json()) as { id: string }[]).map(i => i.id)).not.toContain(draft!.id)
    expect(w.deps.sent).toHaveLength(0)
  })

  it('RACE: Undo lands while the deferred draft is mid-flight; no draft survives', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const hold = w.holdEmail()
    const r = await w.utter(sid, 'Dee rolled her ankle')
    const { utteranceId } = await r.json() as { utteranceId: string }
    await hold.reached // the parent-email agent is inside its LLM call
    const b = await body(await w.undo(utteranceId))
    expect(b.cancelled).toEqual(['Cancelled email draft for Dee'])
    hold.release()
    await w.deps.flush()
    const live = (await w.db.select().from(outbox)).filter(o => o.trigger === 'urgent' && o.status !== 'cancelled')
    expect(live).toEqual([])
    expect(w.deps.sent).toHaveLength(0)
  })

  it('RACE in Auto mode: the draft finishing after Undo is never sent', async () => {
    const w = await demoWorld(router)
    await w.app.request('/v1/settings', { method: 'PATCH', headers: w.h, body: JSON.stringify({ autonomy: { parent_email: 'auto' } }) })
    const sid = await w.start('Kids · Tue')
    const hold = w.holdEmail()
    const { utteranceId } = await (await w.utter(sid, "Tell Dee's family she helped today")).json() as { utteranceId: string }
    await hold.reached
    await body(await w.undo(utteranceId))
    hold.release()
    await w.deps.flush()
    expect(w.deps.sent).toHaveLength(0)
    expect((await w.db.select().from(outbox)).filter(o => o.trigger === 'request' && o.status !== 'cancelled')).toEqual([])
  })

  it('an Auto-mode email already sent is reported as not reversible', async () => {
    const w = await demoWorld(router)
    await w.app.request('/v1/settings', { method: 'PATCH', headers: w.h, body: JSON.stringify({ autonomy: { parent_email: 'auto' } }) })
    const sid = await w.start('Kids · Tue')
    // Urgent notes always wait for review, so the auto-sent case is a requested note home.
    const { utteranceId } = await (await w.utter(sid, "Tell Dee's family she helped today")).json() as { utteranceId: string }
    await w.deps.flush()
    expect(w.deps.sent).toHaveLength(1)
    const b = await body(await w.undo(utteranceId))
    expect(b.notReversible).toEqual(["Email already sent to Dee's family"])
    expect(b.cancelled).toEqual([])
    const [sent] = await w.db.select().from(outbox).where(eq(outbox.utteranceId, utteranceId))
    expect(sent!.status).toBe('sent')
  })
})

describe('C2 undo: ledger coverage and contract', () => {
  beforeEach(() => resetRateLimits())

  it('removes an added drill (positions restored) and a billing flag', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const [se] = await w.db.select().from(sessions).where(eq(sessions.id, sid))
    const order = async () => (await w.db.select().from(drills).where(eq(drills.deckId, se!.deckId))).sort((a, b) => a.position - b.position).map(d => `${d.position}:${d.name}`)
    const before = await order()
    const { utteranceId } = await (await w.utter(sid, 'add a drill and Leo owes')).json() as { utteranceId: string }
    expect((await order()).length).toBe(before.length + 1)
    expect((await w.db.select().from(billingFlags).where(eq(billingFlags.utteranceId, utteranceId))).length).toBe(1)
    const b = await body(await w.undo(utteranceId))
    expect(await order()).toEqual(before)
    expect((await w.db.select().from(billingFlags).where(eq(billingFlags.utteranceId, utteranceId))).length).toBe(0)
    expect(b.reversed).toEqual(expect.arrayContaining(['Removed drill: Shark tag', 'Removed billing flag for Leo']))
  })

  it('a second Undo is 409, an unknown id is 404, and the utterance is marked undone', async () => {
    const w = await demoWorld(router)
    const sid = await w.start('Kids · Tue')
    const { utteranceId } = await (await w.utter(sid, 'Maria hit 225 on deadlift')).json() as { utteranceId: string }
    await body(await w.undo(utteranceId))
    const again = await w.undo(utteranceId)
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'already_undone' })
    expect((await w.undo('nope')).status).toBe(404)
    expect((await w.db.select().from(utterances).where(eq(utterances.id, utteranceId)))[0]!.undoneAt).not.toBeNull()
  })
})
