import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { AgentRunDetail, AgentsSummary, AgentTaskRun, RedraftResponse, UtteranceRun } from '@matside/shared'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { agentRuns, billingFlags, classes, curriculum, decks, drills, enrollments, guardians, instructors, notes, outbox, reportCards, students } from './db/schema'

const intent = (o: Record<string, unknown>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false, ...o })
const card = { strengths: ['kicks'], workingOn: ['guard'], coachNotes: [], attendance: '4 classes', nextGoal: 'guard up' }

async function setup(llm: Parameters<typeof fakeLlm>[0]) {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Jake Ross'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: 'P', email: 'p@example.com' })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19' }).returning()
  await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Horse stance holds', minutes: 4, kind: 'drill' })
  const deps = makeDeps(db, { llm: fakeLlm(llm) })
  const app = createApp(deps)
  const { token } = (await (await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })).json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const start = (await (await app.request('/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ classId: c!.id }) })).json()) as { sessionId: string }
  const say = async (text: string) => {
    const form = new FormData()
    form.set('sessionId', start.sessionId); form.set('mode', 'note'); form.set('text', text)
    return (await (await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })).json()) as { utteranceId: string; cardLines: string[] }
  }
  return { db, deps, app, h, ss, say }
}

const email = { subject: 'Leo today', body: 'Hi! Leo bumped his knee in sparring today; he rested and was fine after.' }

describe('agents v2 http', () => {
  beforeEach(() => resetRateLimits())

  it('GET /v1/utterances/:id/runs lists the runs an utterance started, deferred ones included', async () => {
    const { app, h, deps, say } = await setup(({ name }) => (name === 'router' ? { intents: [intent({ studentNames: ['Leo'], content: 'bumped knee in sparring', skillTags: ['sparring'], urgent: true })] } : email))
    const u = await say('Leo bumped his knee in sparring')
    expect(u.cardLines).toEqual(['✓ Leo · sparring', '⚠ urgent · parent note drafting'])
    const before = UtteranceRun.array().parse(await (await app.request(`/v1/utterances/${u.utteranceId}/runs`, { headers: h })).json())
    expect(before.slice(0, 2).map(r => r.agent)).toEqual(['router', 'progress'])
    await deps.flush()
    const after = UtteranceRun.array().parse(await (await app.request(`/v1/utterances/${u.utteranceId}/runs`, { headers: h })).json())
    expect(after.map(r => r.agent)).toEqual(['router', 'progress', 'parent_email'])
  })

  it('assigning an unassigned note learns the heard name as an alias; PATCH replaces aliases', async () => {
    const { app, h, db, ss, say } = await setup(() => ({ intents: [intent({ studentNames: ['Bree ah'], content: 'good kicks', skillTags: ['kicks'] })] }))
    expect((await say('Bree ah good kicks')).cardLines).toEqual(['● Saved · pick student in Review'])
    const [n] = await db.select().from(notes).where(eq(notes.heard, 'Bree ah'))
    expect((await app.request(`/v1/notes/${n!.id}/assign`, { method: 'POST', headers: h, body: JSON.stringify({ studentId: ss[0]!.id }) })).status).toBe(200)
    const [p] = await db.select().from(students).where(eq(students.id, ss[0]!.id))
    expect(p!.aliases).toEqual(['Bree ah'])
    // the next utterance resolves the alias directly
    expect((await say('Bree ah good kicks')).cardLines).toEqual(['✓ Priya · kicks (2nd time)'])
    const patched = await app.request(`/v1/students/${ss[0]!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ aliases: ['Preeya', 'preeya', 'Pree'] }) })
    expect(await patched.json()).toEqual({ id: ss[0]!.id, aliases: ['Preeya', 'Pree'] })
    expect((await app.request('/v1/students/nope', { method: 'PATCH', headers: h, body: JSON.stringify({ aliases: [] }) })).status).toBe(404)
    expect((await app.request(`/v1/students/${ss[0]!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ aliases: [''] }) })).status).toBe(400)
    const list = (await (await app.request('/v1/students', { headers: h })).json()) as { id: string; aliases: string[] }[]
    expect(list.find(s => s.id === ss[0]!.id)!.aliases).toEqual(['Preeya', 'Pree'])
  })

  it('learns no alias from pronouns or descriptors; spelling variants are learned once', async () => {
    const { app, h, db, ss } = await setup(() => ({ intents: [] }))
    const ids = await db.insert(notes).values(['he', 'the new kid', 'Pree-ya', 'Preeya'].map(heard => ({ heard, text: 'good kicks' }))).returning()
    for (const n of ids) expect((await app.request(`/v1/notes/${n.id}/assign`, { method: 'POST', headers: h, body: JSON.stringify({ studentId: ss[0]!.id }) })).status).toBe(200)
    const [p] = await db.select().from(students).where(eq(students.id, ss[0]!.id))
    expect(p!.aliases).toEqual(['Pree-ya'])
    expect((await app.request(`/v1/students/${ss[0]!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ aliases: ['he'] }) })).status).toBe(400)
    expect(await (await app.request(`/v1/students/${ss[0]!.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ aliases: ['Pree-ya', 'Preeya'] }) })).json()).toEqual({ id: ss[0]!.id, aliases: ['Pree-ya'] })
    expect((await app.request('/v1/utterances/nope/runs', { headers: h })).status).toBe(404)
  })

  it('an urgent note with an unresolved name keeps its urgency; assigning it drafts the urgent email', async () => {
    const { app, h, db, deps, ss, say } = await setup(({ name }) => (name === 'router'
      ? { intents: [intent({ type: 'billing', studentNames: ['Jake'], content: 'owes', urgency: 'low' }), intent({ type: 'billing', studentNames: ['Leo'], content: 'owes', urgency: 'low' }), intent({ type: 'billing', studentNames: ['Priya'], content: 'owes', urgency: 'low' }), intent({ studentNames: ['Zed'], content: 'fell and hit his head', skillTags: ['focus'], urgent: true })] }
      : email))
    const u = await say('three billing notes and Zed fell and hit his head')
    expect(u.cardLines[0]).toBe('⚠ urgent · pick student')
    expect(u.cardLines).toHaveLength(4)
    await deps.flush()
    expect(await db.select().from(outbox)).toHaveLength(0)
    const [n] = await db.select().from(notes).where(eq(notes.heard, 'Zed'))
    expect(n!.urgent).toBe(true)
    expect((await app.request(`/v1/notes/${n!.id}/assign`, { method: 'POST', headers: h, body: JSON.stringify({ studentId: ss[1]!.id }) })).status).toBe(200)
    await deps.flush()
    const [mail] = await db.select().from(outbox)
    expect(mail).toMatchObject({ studentId: ss[1]!.id, trigger: 'urgent', status: 'pending_review' })
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.agent, 'parent_email'))
    expect(run).toMatchObject({ utteranceId: u.utteranceId, trigger: 'urgent', links: { outboxId: mail!.id } })
  })

  it('redraft re-runs the email or report-card agent on the same pending row', async () => {
    let fail = false
    const { app, h, db, ss } = await setup(({ name, prompt }) => {
      if (fail) throw new Error('gateway down')
      expect(prompt).toContain('make it shorter')
      expect(prompt).toContain('Recent coach notes')
      if (name === 'parent_email.redraft') return { subject: 'Shorter', body: 'Hi! Short version: Leo rested his knee and was fine after class today.' }
      if (name === 'report_card.redraft') return { content: { ...card, nextGoal: 'kick height' }, subject: 'October card', body: 'x'.repeat(80) }
      throw new Error(`unexpected ${name}`)
    })
    const [o] = await db.insert(outbox).values({ kind: 'parent_email', studentId: ss[1]!.id, toEmail: 'p@example.com', subject: 'Long', body: 'long body', trigger: 'urgent' }).returning()
    const r = await app.request(`/v1/review/outbox/${o!.id}/redraft`, { method: 'POST', headers: h, body: JSON.stringify({ instruction: 'make it shorter' }) })
    expect(r.status).toBe(200)
    expect(RedraftResponse.parse(await r.json())).toMatchObject({ id: o!.id, subject: 'Shorter', status: 'pending_review' })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, o!.id))
    expect(row).toMatchObject({ subject: 'Shorter', status: 'pending_review', trigger: 'urgent' })
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.trigger, 'redraft'))
    expect(run).toMatchObject({ agent: 'parent_email', status: 'ok', links: { outboxId: o!.id } })

    const [rcO] = await db.insert(outbox).values({ kind: 'report_card', studentId: ss[0]!.id, toEmail: 'p@example.com', subject: 'Card', body: 'b', trigger: 'monthly' }).returning()
    await db.insert(reportCards).values({ studentId: ss[0]!.id, month: '2026-10', content: card, outboxId: rcO!.id })
    expect((await app.request(`/v1/review/outbox/${rcO!.id}/redraft`, { method: 'POST', headers: h, body: JSON.stringify({ instruction: 'make it shorter' }) })).status).toBe(200)
    const [rc] = await db.select().from(reportCards).where(eq(reportCards.outboxId, rcO!.id))
    expect(rc!.content.nextGoal).toBe('kick height')

    expect((await app.request('/v1/review/outbox/nope/redraft', { method: 'POST', headers: h, body: JSON.stringify({ instruction: 'make it shorter' }) })).status).toBe(404)
    expect((await app.request(`/v1/review/outbox/${o!.id}/redraft`, { method: 'POST', headers: h, body: JSON.stringify({ instruction: '' }) })).status).toBe(400)
    fail = true
    expect((await app.request(`/v1/review/outbox/${o!.id}/redraft`, { method: 'POST', headers: h, body: JSON.stringify({ instruction: 'make it shorter' }) })).status).toBe(502)
    await db.update(outbox).set({ status: 'sent' }).where(eq(outbox.id, o!.id))
    expect((await app.request(`/v1/review/outbox/${o!.id}/redraft`, { method: 'POST', headers: h, body: JSON.stringify({ instruction: 'make it shorter' }) })).status).toBe(409)
  })

  it('agents summary, topic runs and run detail', async () => {
    const { app, h, db, deps, say, ss } = await setup(({ name }) => {
      if (name === 'router') {
        return { intents: [
          intent({ studentNames: ['Leo'], content: 'bumped knee in sparring', skillTags: ['sparring'], urgent: true }),
          intent({ type: 'billing', studentNames: ['Jake'], content: 'card declined', urgency: 'high' }),
        ] }
      }
      return email
    })
    const u = await say('Leo bumped his knee. Jake card declined, urgent')
    await deps.flush()
    await db.update(agentRuns).set({ createdAt: deps.now() }) // rows are stamped by the db clock; the test clock is fixed

    const summary = AgentsSummary.parse(await (await app.request('/v1/agents/summary', { headers: h })).json())
    expect(summary.map(t => t.task)).toEqual(['progress', 'parent_email', 'report_card', 'billing', 'planner', 'attendance'])
    const tile = (t: string) => summary.find(x => x.task === t)!
    expect(tile('parent_email')).toMatchObject({ label: 'Parent emails', counts: { today: 1, pending: 1, urgent: 1 }, color: 'red' })
    expect(tile('billing')).toMatchObject({ counts: { today: 1, pending: 1, urgent: 1 }, color: 'red' })
    expect(tile('progress')).toMatchObject({ counts: { today: 1, pending: 0, urgent: 0 }, color: 'green' })
    expect(tile('report_card')).toMatchObject({ counts: { today: 0, pending: 0, urgent: 0 }, color: 'green', latest: null })
    expect(tile('progress').latest?.agent).toBe('progress')

    const mails = AgentTaskRun.array().parse(await (await app.request('/v1/agents/parent_email?limit=10', { headers: h })).json())
    expect(mails).toHaveLength(1)
    expect(mails[0]).toMatchObject({ color: 'red', links: { studentId: ss[1]!.id } })
    const [o] = await db.select().from(outbox)
    expect(mails[0]!.links.outboxId).toBe(o!.id)
    // approving the email turns it green and clears the tile's counts
    await db.update(outbox).set({ status: 'sent' }).where(eq(outbox.id, o!.id))
    const again = AgentTaskRun.array().parse(await (await app.request('/v1/agents/parent_email', { headers: h })).json())
    expect(again[0]!.color).toBe('green')
    const bills = AgentTaskRun.array().parse(await (await app.request('/v1/agents/billing', { headers: h })).json())
    const [flag] = await db.select().from(billingFlags)
    expect(bills[0]).toMatchObject({ color: 'red', links: { billingFlagId: flag!.id } })

    const detail = AgentRunDetail.parse(await (await app.request(`/v1/agents/runs/${mails[0]!.id}`, { headers: h })).json())
    expect(detail).toMatchObject({
      task: 'parent_email', trigger: 'urgent', utteranceId: u.utteranceId, transcript: 'Leo bumped his knee. Jake card declined, urgent',
      studentName: 'Leo Diaz', outbox: { id: o!.id, subject: 'Leo today', status: 'sent', urgent: true }, billing: null,
    })
    const billDetail = AgentRunDetail.parse(await (await app.request(`/v1/agents/runs/${bills[0]!.id}`, { headers: h })).json())
    expect(billDetail).toMatchObject({ task: 'billing', billing: { note: 'card declined', urgency: 'high', status: 'open' }, studentName: 'Jake Ross' })

    expect((await app.request('/v1/agents/runs/nope', { headers: h })).status).toBe(404)
    expect((await app.request('/v1/agents/bogus', { headers: h })).status).toBe(404)
    expect((await app.request('/v1/agents/feed', { headers: h })).status).toBe(200)
  })
})
