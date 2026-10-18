import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { demoWorld, intent } from './test/demo'
import { attendance, billingFlags, deckDiffs, decks, deferredTasks, drills, issues, notes, outbox, sessions, studentMetrics, students, utterances } from './db/schema'

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

const later = (t: string): unknown[] => {
  if (/^add shark/.test(t)) return [intent({ type: 'add_drill', content: 'Shark tag', minutes: 4 })]
  if (/^add bear/.test(t)) return [intent({ type: 'add_drill', content: 'Bear crawl', minutes: 3 })]
  if (/^plan:/.test(t)) return [intent({ type: 'plan_request', content: 'more games next class' })]
  if (/^Priya guard/.test(t)) return [intent({ studentNames: ['Priya'], content: 'Priya dropped her guard again', skillTags: ['guard'], valence: 'concern', observedWhen: 'today' })]
  return router(t)
}

describe('C2 undo: later changes are kept, never overwritten (fix round 1)', () => {
  beforeEach(() => resetRateLimits())

  it('attendance changed after the roll call is kept and reported', async () => {
    const w = await demoWorld(later)
    const sid = await w.start('Kids · Tue')
    const jake = await byFirst(w, 'Jake')
    const { utteranceId } = await (await w.utter(sid, 'everyone is present', { mode: 'attendance' })).json() as { utteranceId: string }
    // The phone later marks Jake absent.
    await w.db.update(attendance).set({ status: 'absent', source: 'phone' }).where(and(eq(attendance.sessionId, sid), eq(attendance.studentId, jake.id)))
    const b = await body(await w.undo(utteranceId))
    const rows = await w.db.select().from(attendance).where(eq(attendance.sessionId, sid))
    expect(rows.map(r => `${r.studentId}:${r.status}:${r.source}`)).toEqual([`${jake.id}:absent:phone`])
    expect(b.notReversible).toEqual(['Kept 1 attendance change made since'])
  })

  it('a drill inserted after the undone one keeps a contiguous, duplicate-free order', async () => {
    const w = await demoWorld(later)
    const sid = await w.start('Kids · Tue')
    const [se] = await w.db.select().from(sessions).where(eq(sessions.id, sid))
    const { utteranceId } = await (await w.utter(sid, 'add shark')).json() as { utteranceId: string }
    await w.utter(sid, 'add bear')
    const b = await body(await w.undo(utteranceId))
    const deck = (await w.db.select().from(drills).where(eq(drills.deckId, se!.deckId))).sort((x, y) => x.position - y.position)
    expect(deck.map(d => d.position)).toEqual(deck.map((_, i) => i + 1))
    expect(deck.map(d => d.name)).toContain('Bear crawl')
    expect(deck.map(d => d.name)).not.toContain('Shark tag')
    expect(b.reversed).toContain('Removed drill: Shark tag')
  })

  it('a rank changed since is kept with its metric row', async () => {
    const w = await demoWorld(later)
    const sid = await w.start('Kids · Tue')
    const maya = await byFirst(w, 'Maya')
    const { utteranceId } = await (await w.utter(sid, 'Maya is a black belt now')).json() as { utteranceId: string }
    await w.app.request(`/v1/students/${maya.id}`, { method: 'PATCH', headers: w.h, body: JSON.stringify({ belt: 'brown' }) })
    const b = await body(await w.undo(utteranceId))
    expect((await byFirst(w, 'Maya')).belt).toBe('brown')
    expect((await w.db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId))).length).toBe(1)
    expect(b.notReversible).toEqual(['Kept Maya rank (changed since)'])
  })
})

describe('C2 undo: planner and issues (fix round 1)', () => {
  beforeEach(() => resetRateLimits())

  /** Next Tuesday's plan exists already, so the plan request edits it (no new draft). */
  async function withNextDeck(w: Awaited<ReturnType<typeof demoWorld>>) {
    const tue = await w.classId('Kids · Tue')
    const [d] = await w.db.insert(decks).values({ classId: tue, forDate: '2026-10-27' }).returning()
    await w.db.insert(drills).values([1, 2].map(i => ({ deckId: d!.id, position: i, name: `Next drill ${i}`, minutes: 5, kind: 'drill' as const })))
    return d!.id
  }
  const deckNames = async (w: Awaited<ReturnType<typeof demoWorld>>, deckId: string) =>
    (await w.db.select().from(drills).where(eq(drills.deckId, deckId))).sort((a, b) => a.position - b.position).map(d => d.name)

  it('a planner diff accepted in Auto mode is reverted by Undo', async () => {
    const w = await demoWorld(later)
    await w.app.request('/v1/settings', { method: 'PATCH', headers: w.h, body: JSON.stringify({ autonomy: { planner: 'auto' } }) })
    const sid = await w.start('Kids · Tue')
    const deckId = await withNextDeck(w)
    const before = await deckNames(w, deckId)
    const { utteranceId } = await (await w.utter(sid, 'plan: more games next class')).json() as { utteranceId: string }
    await w.deps.flush()
    expect(await deckNames(w, deckId)).toContain('Shark tag game')
    const [diff] = await w.db.select().from(deckDiffs).where(eq(deckDiffs.utteranceId, utteranceId))
    expect(diff!.status).toBe('accepted')
    const b = await body(await w.undo(utteranceId))
    expect(await deckNames(w, deckId)).toEqual(before)
    expect((await w.db.select().from(deckDiffs).where(eq(deckDiffs.id, diff!.id)))[0]!.status).toBe('undone')
    expect(b.reversed).toContain('Reverted plan change')
  })

  it('a recurring issue opened by the note is removed, and the plan drafted for it goes too', async () => {
    const w = await demoWorld(later)
    const sid = await w.start('Kids · Tue')
    const priya = await byFirst(w, 'Priya')
    const { utteranceId } = await (await w.utter(sid, 'Priya guard down again')).json() as { utteranceId: string }
    await w.deps.flush()
    const open = await w.db.select().from(issues).where(and(eq(issues.studentId, priya.id), eq(issues.tag, 'guard')))
    expect(open.length).toBe(1)
    const tue = await w.classId('Kids · Tue')
    expect((await w.db.select().from(decks).where(and(eq(decks.classId, tue), eq(decks.forDate, '2026-10-27')))).length).toBe(1)
    const b = await body(await w.undo(utteranceId))
    expect((await w.db.select().from(issues).where(and(eq(issues.studentId, priya.id), eq(issues.tag, 'guard')))).length).toBe(0)
    expect((await w.db.select().from(decks).where(and(eq(decks.classId, tue), eq(decks.forDate, '2026-10-27')))).length).toBe(0)
    expect(b.reversed).toEqual(expect.arrayContaining(['Removed Priya guard issue', 'Removed drafted next-class plan']))
  })

  it('RACE: Undo while auto-adjust is inside its planner call leaves no live diff and a cancelled task', async () => {
    const w = await demoWorld(later)
    await w.app.request('/v1/settings', { method: 'PATCH', headers: w.h, body: JSON.stringify({ autonomy: { planner: 'auto' } }) })
    const sid = await w.start('Kids · Tue')
    const deckId = await withNextDeck(w)
    const before = await deckNames(w, deckId)
    const hold = w.holdEmail('planner.diff')
    const { utteranceId } = await (await w.utter(sid, 'Priya guard down again')).json() as { utteranceId: string }
    await hold.reached
    const b = await body(await w.undo(utteranceId))
    expect(b.cancelled).toContain('Cancelled next-class plan change')
    hold.release()
    await w.deps.flush()
    expect((await w.db.select().from(deckDiffs).where(eq(deckDiffs.utteranceId, utteranceId))).every(d => d.status === 'undone')).toBe(true)
    expect(await deckNames(w, deckId)).toEqual(before)
    expect((await w.db.select().from(deferredTasks).where(eq(deferredTasks.utteranceId, utteranceId))).map(t => t.status)).toEqual(['cancelled'])
  })
})
