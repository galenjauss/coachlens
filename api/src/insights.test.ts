import { describe, it, expect, beforeEach } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { AgentsSummary, InsightAcceptResponse, InsightsResponse } from '@matside/shared'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import {
  agentRuns, attendance, billingFlags, classes, curriculum, deckDiffs, decks, drills, enrollments, guardians, insights, instructors, issues,
  notes, outbox, sessions, students,
} from './db/schema'
import { runInsights } from './services/insights'
import { inEmailCooldown } from './agents/parentEmail'

const T0 = new Date('2026-10-20T00:30:00Z') // Mon 2026-10-19 5:30 PM PT
const DAY = 86_400_000
const ex = (name: string) => ({ name, minutes: 6, kind: 'drill', cues: ['knees out'], focusStudentIds: [], rationale: 'theme' })

async function setup() {
  const db = await makeTestDb()
  const clock = { now: T0 }
  const deps = makeDeps(db, {
    now: () => clock.now,
    llm: fakeLlm(({ name }) => {
      if (name === 'parent_email') return { subject: 'A quick note', body: 'Hi! Just a quick, friendly note from class today about how things are going.' }
      if (name === 'planner.draft') return { drills: ['Warm-up', 'Stances', 'Kicks', 'Forms', 'Game', 'Stretch', 'Pads', 'Bow out'].map(ex) }
      if (name === 'planner.diff') return { added: [{ ...ex('Partner focus drill'), afterPosition: 1, reason: 'focus' }], changed: [], removed: [], rememberSuggestion: null }
      throw new Error(`unexpected ${name}`)
    }),
  })
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [kids] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const [teens] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Teens Wed', weekday: 3, startTime: '18:00' }).returning()
  const [jake, maria, leo, zoe] = await db.insert(students).values([
    { name: 'Jake Ross', belt: 'yellow', birthYear: 2017 },
    { name: 'Maria Lopez', belt: 'orange', birthYear: 2016, rankSince: '2026-06-01' },
    { name: 'Leo Diaz', belt: 'yellow', birthYear: 2017 },
    { name: 'Zoe Park', belt: 'white', birthYear: 2012 },
  ]).returning()
  await db.insert(enrollments).values([jake, maria, leo].map(s => ({ classId: kids!.id, studentId: s!.id })))
  await db.insert(enrollments).values({ classId: teens!.id, studentId: zoe!.id })
  await db.insert(guardians).values([jake, maria, leo, zoe].map(s => ({ studentId: s!.id, name: 'Pat', email: 'p@example.com' })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  // Three finished Monday classes: Jake P A A, Maria and Leo present every time (Leo got notes, Maria none).
  const past = ['2026-09-28', '2026-10-05', '2026-10-12']
  const jakeStatus = ['present', 'absent', 'absent'] as const
  for (const [i, forDate] of past.entries()) {
    const [d] = await db.insert(decks).values({ classId: kids!.id, forDate, status: 'done' }).returning()
    const started = new Date(`${forDate}T00:00:00Z`)
    const [s] = await db.insert(sessions).values({ classId: kids!.id, deckId: d!.id, forDate, startedAt: started, endedAt: new Date(started.getTime() + 3_600_000) }).returning()
    await db.insert(attendance).values([
      { sessionId: s!.id, studentId: jake!.id, status: jakeStatus[i]!, source: 'phone' },
      { sessionId: s!.id, studentId: maria!.id, status: 'present', source: 'phone' },
      { sessionId: s!.id, studentId: leo!.id, status: 'present', source: 'phone' },
    ])
    await db.insert(notes).values({ sessionId: s!.id, studentId: leo!.id, text: 'nice kicks', tags: ['kicks'], createdAt: started })
  }
  const [issue] = await db.insert(issues).values({ studentId: leo!.id, tag: 'guard', openedAt: new Date(T0.getTime() - 40 * DAY) }).returning()
  await db.insert(billingFlags).values([{ studentId: zoe!.id, urgency: 'low', note: 'owes October' }, { studentId: zoe!.id, urgency: 'low', note: 'needs gloves' }])
  // Today's deck (one 4-minute drill) so starting a session needs no planner call.
  const [today] = await db.insert(decks).values({ classId: kids!.id, forDate: '2026-10-19' }).returning()
  await db.insert(drills).values({ deckId: today!.id, position: 1, name: 'Horse stance holds', minutes: 4, kind: 'drill' })
  const app = createApp(deps)
  const { token } = (await (await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })).json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const get = async (qs = '') => {
    const r = await app.request(`/v1/insights${qs}`, { headers: h })
    return { status: r.status, body: r.status === 200 ? InsightsResponse.parse(await r.json()).insights : null }
  }
  const post = (path: string, body: unknown = {}) => app.request(path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  const setAutonomy = (autonomy: Record<string, string>) => app.request('/v1/settings', { method: 'PATCH', headers: h, body: JSON.stringify({ autonomy }) })
  const byKind = async (kind: string) => (await db.select().from(insights).where(eq(insights.kind, kind as 'new_pr')))
  const insightRuns = async (trigger?: string) => (await db.select().from(agentRuns).where(eq(agentRuns.agent, 'insights'))).filter(r => !trigger || r.trigger === trigger)
  return { db, deps, app, h, clock, kids: kids!, teens: teens!, jake: jake!, maria: maria!, leo: leo!, zoe: zoe!, issue: issue!, get, post, setAutonomy, byKind, insightRuns }
}

describe('insights agent', () => {
  beforeEach(() => resetRateLimits())

  it('off: detectors do not run (no rows, no run logged)', async () => {
    const t = await setup()
    await t.setAutonomy({ insights: 'off' })
    expect(await runInsights(t.deps, { trigger: 'cron' })).toEqual([])
    expect((await t.get()).body).toEqual([])
    expect(await t.db.select().from(insights)).toEqual([])
    expect(await t.insightRuns()).toEqual([])
  })

  it('review: the daily cron creates new rows once per week and logs a run summary', async () => {
    const t = await setup()
    const r = await t.app.request('/jobs/plan', { headers: { Authorization: 'Bearer cron' } })
    expect(r.status).toBe(200)
    const body = await r.json() as { insights: number }
    const rows = await t.db.select().from(insights)
    expect(body.insights).toBe(rows.length)
    expect(rows.map(x => x.kind).sort()).toEqual(['attendance_decline', 'billing_repeat', 'issue_resolved', 'no_feedback', 'ready_to_test'])
    expect(rows.every(x => x.status === 'new')).toBe(true)
    const [run] = await t.insightRuns('cron')
    expect(run!.summary).toMatch(/^5 new: /)
    expect(run!.summary).toContain('Jake attendance')
    expect(run!.summary).toContain('Maria ready to test')
    expect(await runInsights(t.deps, { trigger: 'cron' })).toEqual([]) // same week: deduped
    expect((await t.insightRuns('cron')).map(x => x.summary)).toContain('No new insights')
  })

  it('GET filters by scope; class scope needs a known class', async () => {
    const t = await setup()
    const all = (await t.get()).body!
    expect([...new Set(all.map(i => i.studentName))].sort()).toEqual(['Jake Ross', 'Leo Diaz', 'Maria Lopez', 'Zoe Park'])
    const jake = all.find(i => i.kind === 'attendance_decline')!
    expect(jake).toMatchObject({ title: 'Jake missed 2 of last 3 classes', urgency: 'low', status: 'new', actionLabel: 'Draft check-in email', classId: t.kids.id, studentId: t.jake.id })
    expect(all.find(i => i.kind === 'billing_repeat')!.actionLabel).toBeNull()
    const cls = (await t.get(`?scope=class&classId=${t.kids.id}`)).body!
    expect(cls.map(i => i.studentName)).not.toContain('Zoe Park')
    expect(cls).toHaveLength(all.length - 1)
    expect((await t.get(`?scope=class&classId=${t.teens.id}`)).body!.map(i => i.kind)).toEqual(['billing_repeat'])
    expect((await t.get('?scope=class')).status).toBe(400)
    expect((await t.get('?scope=class&classId=nope')).status).toBe(404)
    expect((await t.get('?scope=bogus')).status).toBe(400)
    expect((await t.get('?sessionId=nope')).status).toBe(404)
  })

  it('accept draft_email drafts through parentEmail (trigger insight); a second accept is a 409', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [row] = await t.byKind('attendance_decline')
    const r = await t.post(`/v1/insights/${row!.id}/accept`)
    expect(r.status).toBe(200)
    expect(InsightAcceptResponse.parse(await r.json())).toEqual({ ok: true, outcome: 'Email drafted for review' })
    const [mail] = await t.db.select().from(outbox).where(eq(outbox.studentId, t.jake.id))
    expect(mail).toMatchObject({ trigger: 'insight', status: 'pending_review' })
    expect((await t.byKind('attendance_decline'))[0]).toMatchObject({ status: 'accepted', outcome: 'Email drafted for review' })
    expect((await t.post(`/v1/insights/${row!.id}/accept`)).status).toBe(409)
    expect((await t.post('/v1/insights/nope/accept')).status).toBe(404)
    expect((await t.insightRuns('accept'))[0]!.summary).toContain('Email drafted for review')
  })

  it('accept draft_email respects parent_email autonomy: off drafts nothing, auto sends', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [decline] = await t.byKind('attendance_decline')
    const [ready] = await t.byKind('ready_to_test')
    await t.setAutonomy({ parent_email: 'off' })
    expect(await (await t.post(`/v1/insights/${decline!.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Parent emails are off in Settings' })
    expect(await t.db.select().from(outbox)).toEqual([])
    await t.setAutonomy({ parent_email: 'auto' })
    expect(await (await t.post(`/v1/insights/${ready!.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Email sent' })
    expect(t.deps.sent).toHaveLength(1)
  })

  it('accept plan_focus suggests a change to next class (planner review), applies it on planner auto', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [focus] = await t.byKind('no_feedback')
    expect(focus!.studentId).toBe(t.maria.id)
    expect(await (await t.post(`/v1/insights/${focus!.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Plan change ready for review' })
    const [diff] = await t.db.select().from(deckDiffs)
    expect(diff!.status).toBe('pending')
    expect(diff!.requestText).toContain(`Maria Lopez [${t.maria.id}]`)
    const [deck] = await t.db.select().from(decks).where(eq(decks.id, diff!.deckId))
    expect(deck!.forDate).toBe('2026-10-19') // today's class has not met yet
    // planner auto: a fresh insight next week is applied straight away
    await t.setAutonomy({ planner: 'auto' })
    t.clock.now = new Date(T0.getTime() + 7 * DAY)
    await runInsights(t.deps, { trigger: 'cron' })
    const next = (await t.byKind('no_feedback')).find(x => x.status === 'new')!
    expect(await (await t.post(`/v1/insights/${next.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Added to next plan' })
  })

  it('accept resolve_issue closes the issue and drafts a positive note; accept none just records it', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [quiet] = await t.byKind('issue_resolved')
    expect(await (await t.post(`/v1/insights/${quiet!.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Resolved · email drafted for review' })
    expect((await t.db.select().from(issues).where(eq(issues.id, t.issue.id)))[0]!.status).toBe('resolved')
    expect(await t.db.select().from(outbox).where(eq(outbox.studentId, t.leo.id))).toHaveLength(1)
    const [bill] = await t.byKind('billing_repeat')
    expect(await (await t.post(`/v1/insights/${bill!.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Noted' })
  })

  it('a failed action leaves the insight new so it can be retried', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [decline] = await t.byKind('attendance_decline')
    t.deps.llm = fakeLlm(() => { throw new Error('model down') })
    expect((await t.post(`/v1/insights/${decline!.id}/accept`)).status).toBe(502)
    expect((await t.byKind('attendance_decline'))[0]!.status).toBe('new')
  })

  it('dismiss hides it; dismissing twice is fine; unknown is 404; accepted is 409', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' })
    const [bill] = await t.byKind('billing_repeat')
    const r = await t.post(`/v1/insights/${bill!.id}/dismiss`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
    expect((await t.byKind('billing_repeat'))[0]!.status).toBe('dismissed')
    expect((await t.get()).body!.map(i => i.kind)).not.toContain('billing_repeat')
    expect((await t.post(`/v1/insights/${bill!.id}/dismiss`)).status).toBe(200)
    expect((await t.post('/v1/insights/nope/dismiss')).status).toBe(404)
    const [quiet] = await t.byKind('issue_resolved')
    await t.post(`/v1/insights/${quiet!.id}/accept`)
    expect((await t.post(`/v1/insights/${quiet!.id}/dismiss`)).status).toBe(409)
  })

  it('auto: actions run at once (subject to their own autonomy) and rows become auto_done', async () => {
    const t = await setup()
    await t.setAutonomy({ insights: 'auto', parent_email: 'off' })
    await runInsights(t.deps, { trigger: 'cron' })
    const rows = await t.db.select().from(insights)
    expect(rows.find(r => r.kind === 'attendance_decline')).toMatchObject({ status: 'auto_done', outcome: 'Parent emails are off in Settings' })
    expect(rows.find(r => r.kind === 'no_feedback')).toMatchObject({ status: 'auto_done', outcome: 'Plan change ready for review' })
    expect(rows.find(r => r.kind === 'issue_resolved')).toMatchObject({ status: 'auto_done', outcome: 'Resolved · emails are off' })
    expect(rows.find(r => r.kind === 'billing_repeat')!.status).toBe('new') // nothing to do: stays a suggestion
    expect(await t.db.select().from(outbox)).toEqual([])
    expect((await t.get()).body!.map(i => i.kind)).toEqual(['billing_repeat'])
    // with parent emails on review, auto drafts for review
    t.clock.now = new Date(T0.getTime() + 7 * DAY)
    await t.setAutonomy({ parent_email: 'review' })
    await runInsights(t.deps, { trigger: 'cron' })
    const ready = (await t.byKind('ready_to_test')).find(r => r.createdAt.getTime() === t.clock.now.getTime())!
    expect(ready).toMatchObject({ status: 'auto_done', outcome: 'Email drafted for review' })
    expect((await t.db.select().from(outbox).where(eq(outbox.studentId, t.maria.id)))[0]!.trigger).toBe('insight_auto')
    expect(await inEmailCooldown(t.deps, t.maria.id)).toBe(true) // auto insight emails count toward the cooldown
  })

  it('auto: an automatic insight email obeys the 30-day cooldown; a manual accept is exempt', async () => {
    const t = await setup()
    const recent = new Date(T0.getTime() - 5 * DAY)
    await t.db.insert(outbox).values([t.jake, t.maria].map(s => ({ kind: 'parent_email' as const, studentId: s.id, toEmail: 'p@example.com', subject: 's', body: 'b', status: 'sent' as const, trigger: 'insight_auto', createdAt: recent })))
    await t.setAutonomy({ insights: 'auto' })
    await runInsights(t.deps, { trigger: 'cron' })
    expect((await t.byKind('attendance_decline'))[0]).toMatchObject({ status: 'auto_done', outcome: 'Skipped: emailed in last 30 days' })
    expect((await t.byKind('ready_to_test'))[0]!.outcome).toBe('Skipped: emailed in last 30 days')
    expect(await t.db.select().from(outbox).where(eq(outbox.status, 'pending_review'))).toHaveLength(1) // only Leo's positive note
    // manual accept of a review-mode insight still drafts despite the recent email
    await t.setAutonomy({ insights: 'review' })
    t.clock.now = new Date(T0.getTime() + 7 * DAY)
    await runInsights(t.deps, { trigger: 'cron' })
    const decline = (await t.byKind('attendance_decline')).find(r => r.status === 'new')!
    expect(await (await t.post(`/v1/insights/${decline.id}/accept`)).json()).toEqual({ ok: true, outcome: 'Email drafted for review' })
  })

  it('auto: in class, an auto-handled "Jake\'s back" still shows as one high row with no button', async () => {
    const t = await setup()
    await t.setAutonomy({ insights: 'auto' })
    const { sessionId } = await (await t.post('/v1/sessions', { classId: t.kids.id })).json() as { sessionId: string }
    await t.post(`/v1/sessions/${sessionId}/attendance`, { presentIds: [t.jake.id, t.maria.id, t.leo.id] })
    await t.deps.flush()
    const live = (await t.get(`?sessionId=${sessionId}`)).body!
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ kind: 'returning_student', urgency: 'high', status: 'auto_done', actionLabel: null, studentName: 'Jake Ross' })
    expect((await t.get()).body!.map(i => i.kind)).not.toContain('returning_student') // outside class: new rows only
  })

  it('the 70% check is not used up while attendance has not been taken', async () => {
    const t = await setup()
    const { sessionId } = await (await t.post('/v1/sessions', { classId: t.kids.id })).json() as { sessionId: string }
    t.clock.now = new Date(T0.getTime() + 3 * 60_000)
    await t.get(`?sessionId=${sessionId}`)
    expect(await t.insightRuns('live')).toHaveLength(0)
    await t.post(`/v1/sessions/${sessionId}/attendance`, { presentIds: [t.maria.id] })
    expect((await t.get(`?sessionId=${sessionId}`)).body!.map(i => i.title)).toContain('Maria: no note yet today')
    expect(await t.insightRuns('live')).toHaveLength(1)
  })

  it('GET runs the detectors lazily at most every 10 minutes', async () => {
    const t = await setup()
    await t.get()
    await t.get()
    expect(await t.insightRuns('lazy')).toHaveLength(1)
    t.clock.now = new Date(T0.getTime() + 9 * 60_000)
    await t.get()
    expect(await t.insightRuns('lazy')).toHaveLength(1)
    t.clock.now = new Date(T0.getTime() + 11 * 60_000)
    await t.get()
    expect(await t.insightRuns('lazy')).toHaveLength(2)
  })

  it('attendance in a live session runs returning_student; the lens view shows only that session\'s high items', async () => {
    const t = await setup()
    await runInsights(t.deps, { trigger: 'cron' }) // low items already exist
    // a stale high item from before class must not show
    await t.db.insert(insights).values({ kind: 'returning_student', studentId: t.leo.id, classId: t.kids.id, title: 'old', detail: 'old', urgency: 'high', action: { type: 'none', label: null }, dedupeKey: 'old', createdAt: new Date(T0.getTime() - DAY) })
    const { sessionId } = await (await t.post('/v1/sessions', { classId: t.kids.id })).json() as { sessionId: string }
    await t.post(`/v1/sessions/${sessionId}/attendance`, { presentIds: [t.jake.id, t.maria.id, t.leo.id] })
    await t.deps.flush()
    const [back] = await t.byKind('returning_student').then(r => r.filter(x => x.dedupeKey !== 'old'))
    expect(back).toMatchObject({ studentId: t.jake.id, urgency: 'high', sessionId, title: "Jake's back after 2 missed", status: 'new' })
    expect((await t.insightRuns('attendance'))[0]!.summary).toBe('1 new: Jake is back')
    const live = (await t.get(`?sessionId=${sessionId}`)).body!
    expect(live.map(i => [i.kind, i.studentName, i.actionLabel])).toEqual([['returning_student', 'Jake Ross', 'Draft welcome email']])
    // re-taking attendance does not repeat it
    await t.post(`/v1/sessions/${sessionId}/attendance`, { presentIds: [t.jake.id, t.maria.id, t.leo.id] })
    await t.deps.flush()
    expect((await t.byKind('returning_student')).filter(x => x.dedupeKey !== 'old')).toHaveLength(1)
    // once the session ends, the session id is just a class filter
    await t.post(`/v1/sessions/${sessionId}/end`)
    await t.deps.flush()
    expect((await t.get(`?sessionId=${sessionId}`)).body!.length).toBeGreaterThan(1)
    expect(await t.insightRuns('session_end')).toHaveLength(1)
  })

  it('a voice roll call writes the returning_student row before it replies (the lens polls right after)', async () => {
    const t = await setup()
    const { sessionId } = await (await t.post('/v1/sessions', { classId: t.kids.id })).json() as { sessionId: string }
    const form = new FormData()
    form.set('sessionId', sessionId); form.set('mode', 'attendance'); form.set('text', 'everyone is here')
    expect((await t.app.request('/v1/utterance', { method: 'POST', headers: { Authorization: t.h.Authorization }, body: form })).status).toBe(200)
    // No flush: the detector ran inside the request, so the row and the lens view already have it.
    expect((await t.byKind('returning_student')).map(r => r.studentId)).toEqual([t.jake.id])
    expect((await t.get(`?sessionId=${sessionId}`)).body!.map(i => i.kind)).toContain('returning_student')
    await t.deps.flush()
    expect(await t.byKind('returning_student')).toHaveLength(1)
  })

  it('at 70% of class time, present students with no note yet get a high no_feedback item (once)', async () => {
    const t = await setup()
    const { sessionId } = await (await t.post('/v1/sessions', { classId: t.kids.id })).json() as { sessionId: string }
    await t.post(`/v1/sessions/${sessionId}/attendance`, { presentIds: [t.maria.id, t.leo.id] })
    await t.db.insert(notes).values({ sessionId, studentId: t.leo.id, text: 'good stance' })
    t.clock.now = new Date(T0.getTime() + 2 * 60_000) // 50% of the 4-minute plan
    expect((await t.get(`?sessionId=${sessionId}`)).body!.filter(i => i.kind === 'no_feedback')).toEqual([])
    t.clock.now = new Date(T0.getTime() + 3 * 60_000) // 75%
    const live = (await t.get(`?sessionId=${sessionId}`)).body!
    expect(live.map(i => i.title)).toEqual(['Maria: no note yet today'])
    expect(live[0]!.actionLabel).toBeNull()
    await t.get(`?sessionId=${sessionId}`)
    expect(await t.insightRuns('live')).toHaveLength(1)
    const [row] = await t.db.select().from(insights).where(and(eq(insights.kind, 'no_feedback'), eq(insights.urgency, 'high')))
    expect(row!.sessionId).toBe(sessionId)
  })

  it('the Agents summary has an Insights tile, amber while new rows wait', async () => {
    const t = await setup()
    const tile = async () => AgentsSummary.parse(await (await t.app.request('/v1/agents/summary', { headers: t.h })).json()).find(x => x.task === 'insights')!
    expect(await tile()).toMatchObject({ label: 'Insights', color: 'green', counts: { pending: 0 } })
    await runInsights(t.deps, { trigger: 'cron' })
    expect(await tile()).toMatchObject({ color: 'amber', counts: { pending: 5, urgent: 0 } })
    expect((await tile()).latest!.agent).toBe('insights')
  })
})
