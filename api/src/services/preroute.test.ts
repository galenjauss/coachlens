// F04 + F20 (routing): obvious commands are recognized before the model, in any capture mode, with zero LLM calls;
// a result that changes nothing says so with a recovery hint instead of an empty card.
import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { StatusResponse } from '@matside/shared'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from './utterance'
import { createApp } from '../app'
import { resetRateLimits } from '../http/rateLimit'
import { agentRuns, agentSettings, attendance, classes, curriculum, decks, drills, enrollments, instructors, llmUsage, notes, sessions, students } from '../db/schema'
import { detectCommand } from '../logic/commands'

const intent = (o: Record<string, unknown>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false, ...o })

async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Jake Ross', 'Mia Lopez', 'Maya Chen'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  return { db, sessionId: se!.id, drillId: dr!.id, ss }
}

/** An LLM that records every call and fails it: the deterministic paths must never reach it. */
const noModel = () => {
  const calls: string[] = []
  return { calls, llm: fakeLlm(({ name }) => { calls.push(name); throw new Error(`model called: ${name}`) }) }
}

describe('F04: roll call is recognized in any capture mode', () => {
  it('ordinary note mode: "everyone except Jake and Mia" applies attendance with zero model calls', async () => {
    const w = await world()
    const { llm, calls } = noModel()
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'everyone except Jake and Mia' })
    expect(r.cardLines).toEqual(['3 present', 'absent: Jake, Mia'])
    expect(r.attendanceChanged).toBe(true)
    expect(calls).toEqual([])
    const rows = await w.db.select().from(attendance).where(eq(attendance.sessionId, w.sessionId))
    expect(rows.filter(a => a.status === 'absent')).toHaveLength(2)
    expect(await w.db.select().from(notes)).toEqual([]) // not misfiled as a note
    const runs = await w.db.select().from(agentRuns).where(eq(agentRuns.utteranceId, r.utteranceId))
    expect(runs.find(x => x.agent === 'router')).toMatchObject({ trigger: 'deterministic', status: 'ok' })
    expect(runs.find(x => x.agent === 'router')!.summary).toBe('Recognized roll call (no AI call)') // no transcript text
  })

  it('"present: …" and "all here" also work from note mode', async () => {
    const w = await world()
    const { llm, calls } = noModel()
    const deps = makeDeps(w.db, { llm })
    expect((await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Present: Priya, Leo and Maya' })).cardLines).toEqual(['3 present', 'absent: Jake, Mia'])
    expect((await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'All here.' })).cardLines).toEqual(['5 present'])
    expect(calls).toEqual([])
  })

  it('an ordinary observation in attendance mode still goes to the router', async () => {
    const w = await world()
    const calls: string[] = []
    const llm = fakeLlm(({ name }) => { calls.push(name); return { intents: [intent({ studentNames: ['Leo'], content: 'great focus', skillTags: ['focus'], valence: 'positive' })] } })
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Leo great focus' })
    expect(calls).toEqual(['router'])
    expect(r.cardLines).toEqual(['√ Leo · praise · focus'])
  })
})

describe('F04: nothing changed is said out loud', () => {
  it('empty router intents give an explicit "Nothing changed" line and a recovery hint, never an empty card', async () => {
    const w = await world()
    const llm = fakeLlm(() => ({ intents: [] }))
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'um okay so yeah' })
    expect(r.cardLines).toEqual(['● Nothing changed', 'Try a name + what you saw'])
    const a = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'um okay so yeah' })
    expect(a.cardLines).toEqual(['● Nothing changed', "Try 'everyone except …'"])
  })

  it('an attendance update naming nobody on the roster says it did not catch the name', async () => {
    const w = await world()
    const llm = fakeLlm(() => ({ intents: [intent({ type: 'attendance', studentNames: ['Zed'], content: 'Zed walked in', attendanceStatus: 'present' })] }))
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Zed walked in' })
    expect(r.cardLines).toEqual(['? Didn\'t catch "Zed" · say again'])
  })

  it('review fix: a skipped intent next to a real change gets its own short line, not "Nothing changed"', async () => {
    const w = await world()
    await w.db.insert(agentSettings).values({ task: 'billing', autonomy: 'off' })
    const llm = fakeLlm(() => ({ intents: [intent({ studentNames: ['Leo'], content: 'great focus', skillTags: ['focus'], valence: 'positive' }), intent({ type: 'billing', studentNames: ['Jake'], content: 'owes for gear', urgency: 'low' })] }))
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo great focus, Jake owes for gear' })
    expect(r.cardLines).toEqual(['√ Leo · praise · focus', '● Billing flags off · not saved'])
    const only = await handleUtterance(makeDeps(w.db, { llm: fakeLlm(() => ({ intents: [intent({ type: 'billing', studentNames: ['Jake'], content: 'owes', urgency: 'low' })] })) }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Jake owes' })
    expect(only.cardLines).toEqual(['● Nothing changed', 'Billing flags off'])
  })

  it('voice attendance turned off reads as nothing changed, with the reason', async () => {
    const w = await world()
    const { llm } = noModel()
    const deps = makeDeps(w.db, { llm })
    await w.db.insert(agentSettings).values({ task: 'attendance', autonomy: 'off' })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'everyone except Jake' })
    expect(r.cardLines).toEqual(['● Nothing changed', 'Voice attendance off'])
  })
})

describe('F20: deterministic questions make zero model calls', () => {
  it('"how many are here", coverage and count questions are answered without the router', async () => {
    const w = await world()
    const { llm, calls } = noModel()
    const deps = makeDeps(w.db, { llm })
    const ask = (t: string) => handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: t })
    expect((await ask('How many are here?')).brief?.lines).toEqual(['No roll call yet', '5 on the roster'])
    await w.db.insert(attendance).values(w.ss.map((s, i) => ({ sessionId: w.sessionId, studentId: s.id, status: i < 3 ? 'present' as const : 'absent' as const, source: 'voice' as const })))
    await w.db.insert(notes).values({ sessionId: w.sessionId, studentId: w.ss[0]!.id, text: 'nice stance', valence: 'positive' })
    expect((await ask('how many kids are here today')).brief?.lines).toEqual(['3 here · 2 absent', 'Absent: Mia, Maya'])
    expect((await ask("Who hasn't been noted yet?")).brief?.lines).toEqual(['No observation yet: Leo, Jake'])
    expect((await ask('How many have I noted?')).brief?.lines).toEqual(['1 of 3 noted today', 'No observation yet: Leo, Jake'])
    expect(calls).toEqual([])
    const routerRuns = (await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'router'))).map(r => r.trigger)
    expect(new Set(routerRuns)).toEqual(new Set(['deterministic']))
  })

  it('statements that merely mention notes or counts still go to the router', async () => {
    const w = await world()
    const calls: string[] = []
    const llm = fakeLlm(({ name }) => { calls.push(name); return { intents: [intent({ studentNames: ['Priya'], content: 'needs notes on her guard', skillTags: ['guard'], valence: 'concern' })] } })
    await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Priya needs more notes on her guard' })
    expect(calls).toEqual(['router'])
  })

  it('detectCommand: the recognized shapes', () => {
    expect(detectCommand('everyone except Jake and Mia')).toEqual({ kind: 'rollcall', parsed: { kind: 'except', names: ['Jake', 'Mia'] } })
    expect(detectCommand('How many are here?')).toEqual({ kind: 'question' })
    expect(detectCommand('how many kicks did Leo land today')).toBeNull()
    expect(detectCommand('Priya needs more notes on her guard')).toBeNull()
    expect(detectCommand('who is forgetting their guard?')).toBeNull() // a tag question still goes through the router
  })
})

describe('F20: /v1/status exposes degraded mode honestly', () => {
  beforeEach(() => resetRateLimits())

  it('reports Anthropic calls used/remaining today and whether speech-to-text is configured', async () => {
    const db = await makeTestDb()
    await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' })
    const base = makeDeps(db)
    const deps = makeDeps(db, { env: { ...base.env, aiDailyCap: 10, sttConfigured: false } })
    await db.insert(llmUsage).values({ day: '2026-10-19', calls: 3 })
    const app = createApp(deps)
    const { token } = await (await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })).json() as { token: string }
    expect((await app.request('/v1/status')).status).toBe(401)
    const r = await app.request('/v1/status', { headers: { Authorization: `Bearer ${token}` } })
    expect(r.status).toBe(200)
    const body = StatusResponse.parse(await r.json())
    expect(body).toEqual({
      aiCallsToday: 3, aiDailyCap: 10, sttConfigured: false, mailMode: 'review', degraded: true,
      degradedReasons: ['speech_to_text_unconfigured'], aiCallsRemaining: 7, aiCallsCounted: 'anthropic', day: '2026-10-19',
    })
    await db.update(llmUsage).set({ calls: 12 })
    // The caller's own setting (C4: settings are per instructor).
    await app.request('/v1/settings', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ autonomy: { parent_email: 'auto' } }) })
    const after = StatusResponse.parse(await (await app.request('/v1/status', { headers: { Authorization: `Bearer ${token}` } })).json())
    expect(after).toMatchObject({ aiCallsToday: 12, aiCallsRemaining: 0, mailMode: 'auto', degraded: true, degradedReasons: ['ai_budget_reached', 'speech_to_text_unconfigured'] })
  })

  it('no cap configured reads as uncapped, not as unlimited budget', async () => {
    const db = await makeTestDb()
    await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' })
    const app = createApp(makeDeps(db))
    const { token } = await (await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })).json() as { token: string }
    const body = StatusResponse.parse(await (await app.request('/v1/status', { headers: { Authorization: `Bearer ${token}` } })).json())
    expect(body).toMatchObject({ aiCallsToday: 0, aiDailyCap: null, aiCallsRemaining: null, sttConfigured: true, mailMode: 'review', degraded: false, degradedReasons: [] })
  })
})
