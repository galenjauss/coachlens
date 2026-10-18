import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from '../http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { createApp } from '../app'
import { agentRuns, agentSettings, classes, deckDiffs, decks, drills, instructors, sessions } from '../db/schema'
import { BudgetExceededError } from './budget'

const draft = (name: string, minutes = 5) => ({ name, minutes, kind: 'drill' as const, cues: ['c'], focusStudentIds: [], rationale: '' })
const raw = (name: string, minutes = 5) => ({ ...draft(name, minutes) })
const noDiff = { added: [], changed: [], removed: [], rememberSuggestion: null }

// "Now" is Mon 2026-10-19 5:30 PM PT; the class meets Mondays, so its upcoming date is 2026-10-19.
async function setup(llm: Parameters<typeof fakeLlm>[0] = () => { throw new Error('llm not stubbed') }) {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const [c2] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Teens Wed', weekday: 3, startTime: '18:00' }).returning()
  const mk = async (classId: string, forDate: string, names: string[]) => {
    const [dk] = await db.insert(decks).values({ classId, forDate }).returning()
    const rows = names.length ? await db.insert(drills).values(names.map((n, i) => ({ ...draft(n, 5 + i), deckId: dk!.id, position: i + 1 }))).returning() : []
    return { id: dk!.id, rows }
  }
  const prev = await mk(c!.id, '2026-10-12', ['Last A', 'Last B'])
  const cur = await mk(c!.id, '2026-10-19', ['Jab', 'Cross', 'Kata 2'])
  const other = await mk(c2!.id, '2026-10-21', ['Teen X', 'Teen Y', 'Teen Z', 'Teen W'])
  const deps = makeDeps(db, { llm: fakeLlm(llm) })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  const names = async (deckId: string) => (await db.select().from(drills).where(eq(drills.deckId, deckId)).orderBy(drills.position)).map(r => r.name)
  return { db, deps, post, names, classId: c!.id, prev, cur, other }
}

describe('POST /v1/decks/:id/replace', () => {
  beforeEach(() => resetRateLimits())

  it('last: copies the most recent previous deck with fresh ids and positions from 1', async () => {
    const t = await setup()
    const r = await t.post(`/v1/decks/${t.cur.id}/replace`, { source: 'last' })
    expect(r.status).toBe(200)
    const deck = await r.json() as { id: string; drills: { id: string; name: string; position: number }[] }
    expect(deck.id).toBe(t.cur.id)
    expect(deck.drills.map(d => [d.name, d.position])).toEqual([['Last A', 1], ['Last B', 2]])
    const prevIds = new Set(t.prev.rows.map(x => x.id))
    expect(deck.drills.every(d => !prevIds.has(d.id))).toBe(true)
    expect(await t.names(t.prev.id)).toEqual(['Last A', 'Last B']) // source untouched
  })

  it('last: 404 when the class has no earlier plan', async () => {
    const t = await setup()
    expect((await t.post(`/v1/decks/${t.prev.id}/replace`, { source: 'last' })).status).toBe(404)
  })

  it('deckId: copies another class’s deck', async () => {
    const t = await setup()
    const r = await t.post(`/v1/decks/${t.cur.id}/replace`, { source: { deckId: t.other.id } })
    expect(r.status).toBe(200)
    expect(await t.names(t.cur.id)).toEqual(['Teen X', 'Teen Y', 'Teen Z', 'Teen W'])
    expect((await t.post(`/v1/decks/${t.cur.id}/replace`, { source: { deckId: 'nope' } })).status).toBe(404)
  })

  it('blank: empties the deck', async () => {
    const t = await setup()
    const r = await t.post(`/v1/decks/${t.cur.id}/replace`, { source: 'blank' })
    expect(r.status).toBe(200)
    expect(((await r.json()) as { drills: unknown[] }).drills).toEqual([])
  })

  it('ai: re-runs the drafter and logs a replace run', async () => {
    const t = await setup(() => ({ drills: ['One', 'Two', 'Three', 'Four', 'Five'].map(n => raw(n)) }))
    const r = await t.post(`/v1/decks/${t.cur.id}/replace`, { source: 'ai' })
    expect(r.status).toBe(200)
    expect(await t.names(t.cur.id)).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
    const runs = await t.db.select().from(agentRuns).where(eq(agentRuns.trigger, 'replace'))
    expect(runs).toHaveLength(1)
    expect(runs[0]!.status).toBe('ok')
  })

  it('ai: LLM failure is a 502 and the plan is kept', async () => {
    const t = await setup(() => { throw new Error('boom') })
    expect((await t.post(`/v1/decks/${t.cur.id}/replace`, { source: 'ai' })).status).toBe(502)
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Kata 2'])
  })

  it('409 when the class session has started, and nothing changes', async () => {
    const t = await setup()
    await t.db.insert(sessions).values({ classId: t.classId, deckId: t.cur.id, forDate: '2026-10-19', startedAt: new Date() })
    for (const source of ['last', 'blank', 'ai', { deckId: t.other.id }]) {
      expect((await t.post(`/v1/decks/${t.cur.id}/replace`, { source })).status).toBe(409)
    }
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Kata 2'])
  })

  it('rejects a bad source and an unknown deck', async () => {
    const t = await setup()
    expect((await t.post(`/v1/decks/${t.cur.id}/replace`, { source: 'nonsense' })).status).toBe(400)
    expect((await t.post(`/v1/decks/nope/replace`, { source: 'blank' })).status).toBe(404)
  })
})

describe('POST /v1/plan/voice', () => {
  beforeEach(() => resetRateLimits())

  const convo = 'Coach: cut Kata 2, it is too long. Assistant: yes, and add partner sparring for six minutes.'

  it('applies the change at once, returns a short summary and logs a voice_plan run', async () => {
    const t = await setup(({ prompt }) => {
      const ids = Object.fromEntries([...prompt.matchAll(/^\d\. (\S+) \| (.+?) \|/gm)].map(m => [m[2], m[1]]))
      return { added: [{ ...raw('Partner sparring', 6), afterPosition: 2, reason: 'asked' }], changed: [], removed: [{ drillId: ids['Kata 2'], reason: 'too long' }], rememberSuggestion: 'ignored' }
    })
    const r = await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })
    expect(r.status).toBe(200)
    const body = await r.json() as { diffId: string; deckId: string; lines: string[] }
    expect(body.deckId).toBe(t.cur.id)
    expect(body.lines).toEqual(['+ Partner sparring 6m', '− Kata 2'])
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Partner sparring'])
    const [row] = await t.db.select().from(deckDiffs).where(eq(deckDiffs.id, body.diffId))
    expect(row!.status).toBe('accepted')
    expect(row!.diff.rememberSuggestion).toBeNull()
    expect((await t.db.select().from(agentRuns).where(eq(agentRuns.trigger, 'voice_plan')))).toHaveLength(1)
  })

  it('applies even when planner autonomy is off', async () => {
    const t = await setup(({ prompt }) => ({ added: [{ ...raw('Games', 4), afterPosition: 0, reason: '' }], changed: [], removed: [], rememberSuggestion: null, prompt }))
    await t.db.insert(agentSettings).values({ task: 'planner', autonomy: 'off' })
    const r = await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })
    expect(((await r.json()) as { lines: string[] }).lines).toEqual(['+ Games 4m'])
    expect((await t.names(t.cur.id))[0]).toBe('Games')
  })

  it('undo restores the earlier plan', async () => {
    const t = await setup(({ prompt }) => {
      const id = /^2\. (\S+) \|/m.exec(prompt)![1]
      return { added: [], changed: [{ drillId: id, after: raw('Cross', 2), reason: '' }], removed: [{ drillId: /^3\. (\S+) \|/m.exec(prompt)![1], reason: '' }], rememberSuggestion: null }
    })
    const body = await (await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })).json() as { diffId: string; lines: string[] }
    expect(body.lines).toEqual(['− Kata 2', '~ Cross 6→2m'])
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross'])
    expect((await t.post(`/v1/diffs/${body.diffId}/undo`, {})).status).toBe(200)
    const restored = await t.db.select().from(drills).where(eq(drills.deckId, t.cur.id)).orderBy(drills.position)
    expect(restored.map(r => [r.name, r.minutes])).toEqual([['Jab', 5], ['Cross', 6], ['Kata 2', 7]])
    const [row] = await t.db.select().from(deckDiffs).where(eq(deckDiffs.id, body.diffId))
    expect(row!.status).toBe('undone')
    expect((await t.post(`/v1/diffs/${body.diffId}/undo`, {})).status).toBe(200) // idempotent
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Kata 2'])
  })

  it('undo is a 409 once the class has started', async () => {
    const t = await setup(({ prompt }) => ({ added: [{ ...raw('Extra'), afterPosition: 0, reason: '' }], changed: [], removed: [], rememberSuggestion: null, prompt }))
    const body = await (await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })).json() as { diffId: string }
    await t.db.insert(sessions).values({ classId: t.classId, deckId: t.cur.id, forDate: '2026-10-19', startedAt: new Date() })
    expect((await t.post(`/v1/diffs/${body.diffId}/undo`, {})).status).toBe(409)
  })

  it('no actionable change: null diff, one line, plan untouched', async () => {
    const t = await setup(() => noDiff)
    const r = await t.post('/v1/plan/voice', { classId: t.classId, transcript: 'Nice weather. See you Monday.' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ diffId: null, deckId: t.cur.id, lines: ['No plan changes heard'] })
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Kata 2'])
    expect(await t.db.select().from(deckDiffs)).toHaveLength(0)
  })

  it('targets the following occurrence when today’s class already started', async () => {
    const t = await setup(() => ({ drills: ['A', 'B', 'C', 'D', 'E'].map(n => raw(n)), added: [{ ...raw('Late add'), afterPosition: 0, reason: '' }], changed: [], removed: [], rememberSuggestion: null }))
    await t.db.insert(sessions).values({ classId: t.classId, deckId: t.cur.id, forDate: '2026-10-19', startedAt: new Date() })
    const body = await (await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })).json() as { deckId: string }
    expect(body.deckId).not.toBe(t.cur.id)
    expect((await t.db.select().from(decks).where(eq(decks.id, body.deckId)))[0]!.forDate).toBe('2026-10-26')
  })

  it('LLM failure is a clean 502 with an error run, plan untouched', async () => {
    const t = await setup(() => { throw new Error('model down') })
    const r = await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })
    expect(r.status).toBe(502)
    expect(await t.names(t.cur.id)).toEqual(['Jab', 'Cross', 'Kata 2'])
    const runs = await t.db.select().from(agentRuns).where(eq(agentRuns.trigger, 'voice_plan'))
    expect(runs.some(x => x.status === 'error')).toBe(true)
  })

  it('budget exhausted is a 429', async () => {
    const t = await setup(() => { throw new BudgetExceededError() })
    expect((await t.post('/v1/plan/voice', { classId: t.classId, transcript: convo })).status).toBe(429)
  })

  it('validates input and the class', async () => {
    const t = await setup(() => noDiff)
    expect((await t.post('/v1/plan/voice', { classId: t.classId, transcript: '' })).status).toBe(400)
    expect((await t.post('/v1/plan/voice', { classId: t.classId, transcript: 'x'.repeat(20001) })).status).toBe(400)
    expect((await t.post('/v1/plan/voice', { classId: 'nope', transcript: 'hi' })).status).toBe(404)
  })
})
