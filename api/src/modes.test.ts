import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { seed } from './db/seed'
import { guardians, issues, outbox } from './db/schema'

const intent = (o: Record<string, unknown>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, ...o })
const ex = (name: string) => ({ name, minutes: 6, kind: 'drill', cues: ['chest up'], focusStudentIds: [], rationale: 'program block' })

type Call = { name: string; prompt: string; instructions: string }

async function seededApp() {
  const db = await makeTestDb()
  const w = await seed(db, { today: '2026-10-17', guardianEmail: i => `inbox${i}@example.com` })
  const calls: Call[] = []
  const deps = makeDeps(db, {
    llm: fakeLlm(a => {
      calls.push(a)
      if (a.name === 'router') return { intents: [intent({ studentNames: ['Maria'], content: 'squat depth great, knees caving on the last set', skillTags: ['depth'] })] }
      if (a.name === 'parent_email') return { subject: 'Your squat depth', body: 'Hi Maria, you hit great depth today. We will keep working on keeping your knees out on the last set.' }
      if (a.name === 'planner.draft') return { drills: ['Bike', 'Back squat 5×5', 'RDL', 'Split squat', 'Plank', 'Sled push', 'Stretch'].map(ex) }
      if (a.name === 'planner.diff') return { added: [{ ...ex('Box squat to depth'), afterPosition: 2, reason: 'depth' }], changed: [], removed: [], rememberSuggestion: null }
      throw new Error(`unexpected ${a.name}`)
    }),
  })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return { app, h, db, w, deps, calls }
}

describe('teaching modes over HTTP', () => {
  beforeEach(() => resetRateLimits())

  // The brief says "3 classes", but it also keeps the martial-arts world (Kids · Tue + Kids · Thu) as-is,
  // so the seed has 4 classes covering the 3 modes.
  it('/v1/classes lists every seeded class (3 modes) with its mode label', async () => {
    const { app, h, w } = await seededApp()
    const r = await app.request('/v1/classes', { headers: h })
    expect(r.status).toBe(200)
    const list = (await r.json()) as { id: string; name: string; mode: string; modeLabel: string }[]
    expect(list).toHaveLength(4)
    expect(new Set(list.map(c => c.mode))).toEqual(new Set(['martial_arts', 'personal_training', 'tutoring']))
    expect(list.find(c => c.id === w.classIds.pt)).toEqual({ id: w.classIds.pt, name: 'PT · Mon 6:00', mode: 'personal_training', modeLabel: 'Personal training' })
    expect(list.find(c => c.id === w.classIds.algebra)).toMatchObject({ name: 'Algebra · Wed 4:00', mode: 'tutoring', modeLabel: 'Tutoring' })
    expect(list.find(c => c.id === w.classIds.tue)).toMatchObject({ name: 'Kids · Tue', mode: 'martial_arts', modeLabel: 'Martial arts' })
    expect((await app.request('/v1/classes')).status).toBe(401)
  })

  it('/v1/today?classId=<pt> returns personal-training mode and the seeded session plan', async () => {
    const { app, h, w, calls } = await seededApp()
    const r = await app.request(`/v1/today?classId=${w.classIds.pt}`, { headers: h })
    expect(r.status).toBe(200)
    const t = (await r.json()) as Record<string, unknown> & { deck: { drills: unknown[] }; focus: { label: string }[]; roster: unknown[] }
    expect(t).toMatchObject({
      classId: w.classIds.pt, className: 'PT · Mon 6:00', mode: 'personal_training', modeLabel: 'Personal training',
      weeklyLabel: 'Program block', itemsDueLabel: 'Goals', planUnit: 'Session plan', people: 'clients',
      theme: 'Lower-body strength', formsDue: ['Squat 5×5', 'Deadlift form check'],
    })
    expect(t.deck.drills).toHaveLength(7)
    expect(t.roster).toHaveLength(5)
    expect(calls).toHaveLength(0) // seeded plan, no LLM call
    expect((await app.request('/v1/today?classId=nope', { headers: h })).status).toBe(404)
    const tut = (await (await app.request(`/v1/today?classId=${w.classIds.algebra}`, { headers: h })).json()) as Record<string, unknown> & { deck: { drills: unknown[] } }
    expect(tut).toMatchObject({ mode: 'tutoring', planUnit: 'Lesson plan', theme: 'Linear equations', formsDue: ['Unit quiz Fri'] })
    // No seeded plan for Monday in the tutoring class, so the planner drafts one with tutoring context.
    expect(tut.deck.drills).toHaveLength(7)
    const draft = calls.find(c => c.name === 'planner.draft')!
    expect(draft.instructions).toMatch(/lesson plan/i)
    expect(draft.instructions).toContain('No grade guarantees')
    expect(draft.prompt).toContain('Unit: Linear equations')
    expect(draft.prompt).toContain('Upcoming: Unit quiz Fri')
  })

  it("PT recurring flow: Maria's 3rd depth note → recurring + email draft addressed to the client", async () => {
    const { app, h, db, w, deps, calls } = await seededApp()
    const start = (await (await app.request('/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ classId: w.classIds.pt }) })).json()) as { sessionId: string }
    const form = new FormData()
    form.set('sessionId', start.sessionId); form.set('mode', 'note'); form.set('text', "Maria's squat depth was great, knees caving on the last set")
    const u = await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })
    expect(u.status).toBe(200)
    expect(((await u.json()) as { cardLines: string[] }).cardLines).toEqual(['✓ Maria · depth (3rd time)', '→ progress logged', '→ parent note drafting', '→ added to next deck'])
    const router = calls.find(c => c.name === 'router')!
    expect(router.instructions).toContain('depth')
    expect(router.instructions).not.toContain('guard')
    expect(await db.select().from(issues).where(eq(issues.studentId, w.mariaId))).toMatchObject([{ tag: 'depth', status: 'open' }])
    await deps.flush()
    const [mail] = await db.select().from(outbox).where(eq(outbox.studentId, w.mariaId))
    const [g] = await db.select().from(guardians).where(eq(guardians.studentId, w.mariaId))
    expect(g!.name).toBe('Maria Gomez')
    expect(mail).toMatchObject({ kind: 'parent_email', status: 'pending_review', toEmail: g!.email })
    const email = calls.find(c => c.name === 'parent_email')!
    expect(email.instructions).toMatch(/second person/i)
    expect(email.instructions).toContain('nutrition')
    expect(email.instructions).not.toMatch(/parent/i)
    expect(email.prompt).toContain('Client: Maria')
    const draft = calls.find(c => c.name === 'planner.draft')!
    expect(draft.instructions).toMatch(/session plan/i)
    expect(draft.instructions).toContain('nutrition')
    expect(draft.prompt).toContain('Plan the class on 2026-10-26') // next Mon, after the seeded block
    expect(draft.prompt).toMatch(/Program block: .*\nGoals: /)
  })
})
