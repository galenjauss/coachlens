// F17: an urgent observation gets its own concise, factual note home, marked urgent in Review, and the draft must
// keep the observation's facts (a deterministic guard falls back to a plain template when the model drops them).
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { ReviewItem } from '@matside/shared'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { classes, enrollments, guardians, notes, outbox, students, agentRuns } from '../db/schema'
import { draftParentEmail, keepsFacts, observationKeywords, parentEmailInstructions, urgentEmailInstructions } from './parentEmail'
import { listReview } from '../services/review'
import { MODES } from '@matside/shared'

async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const [dee] = await db.insert(students).values({ name: 'Dee Park', belt: 'orange', birthYear: 2017 }).returning()
  await db.insert(enrollments).values({ classId: c!.id, studentId: dee!.id })
  await db.insert(guardians).values({ studentId: dee!.id, name: 'Sam Park', email: 'park@example.com' })
  // cheerful progress history that must NOT leak into the urgent note
  await db.insert(notes).values({ studentId: dee!.id, text: 'Really clean roundhouse', tags: ['kicks'], valence: 'positive', createdAt: new Date('2026-10-12T01:00:00Z') })
  return { db, dee: dee! }
}

const ANKLE = 'rolled her ankle a little, sat out the last drill'

describe('F17: urgent parent note', () => {
  it('uses its own factual instructions and prompt (no progress notes, no tips) and is marked urgent in Review', async () => {
    const w = await world()
    const seen: { instructions: string; prompt: string }[] = []
    const deps = makeDeps(w.db, {
      llm: fakeLlm(a => {
        seen.push(a)
        return { subject: 'Dee rolled her ankle in class today', body: 'Hi Sam, a quick note from class today: Dee rolled her ankle a little and sat out the last drill. Please reply if you have any questions. Coach Galen' }
      }),
    })
    const id = await draftParentEmail(deps, { studentId: w.dee.id, sessionId: null, trigger: { kind: 'urgent', content: ANKLE } })
    expect(id).toBeTruthy()
    const [{ instructions, prompt }] = seen as [{ instructions: string; prompt: string }]
    expect(instructions).toBe(urgentEmailInstructions(MODES.martial_arts))
    expect(instructions).not.toBe(parentEmailInstructions(MODES.martial_arts))
    expect(instructions).toMatch(/Subject: name the observation/)
    expect(instructions).toMatch(/No diagnosis/)
    expect(instructions).toMatch(/no practice tips/)
    expect(instructions).not.toMatch(/at-home tip|Open with something genuinely positive/)
    expect(prompt).toContain(`Observation (logged today): ${ANKLE}`)
    expect(prompt).not.toContain('roundhouse')
    expect(prompt).not.toContain('Open focus areas')
    const [row] = await w.db.select().from(outbox).where(eq(outbox.id, id!))
    expect(row).toMatchObject({ trigger: 'urgent', subject: 'Dee rolled her ankle in class today' })

    // a routine request draft for comparison: not urgent, generic instructions
    await draftParentEmail(makeDeps(w.db, { llm: fakeLlm(a => { seen.push(a); return { subject: 'Belt test Friday', body: 'Hi Sam, a reminder that the belt test is this Friday at five. Coach Galen' } }) }),
      { studentId: w.dee.id, sessionId: null, trigger: { kind: 'request', content: 'belt test is Friday' } })
    expect(seen[1]!.instructions).toBe(parentEmailInstructions(MODES.martial_arts))

    const items = (await listReview(w.db, null)).map(i => ReviewItem.parse(i))
    const mail = items.filter((i): i is Extract<ReviewItem, { kind: 'parent_email' }> => i.kind === 'parent_email')
    expect(mail.map(m => [m.subject, m.urgent])).toEqual([['Dee rolled her ankle in class today', true], ['Belt test Friday', false]])
    expect(items[0]!.kind === 'parent_email' && items[0]!.urgent).toBe(true) // urgent sorts first
  })

  it('review fix: urgent notes always wait for review, even with parent emails on auto; routine ones still auto-send', async () => {
    const w = await world()
    const { agentSettings } = await import('../db/schema')
    await w.db.insert(agentSettings).values({ task: 'parent_email', autonomy: 'auto' })
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ subject: 'Dee rolled her ankle in class today', body: 'Hi Sam, Dee rolled her ankle a little and sat out the last drill. Please reply with any questions. Coach Galen' })) })
    const id = await draftParentEmail(deps, { studentId: w.dee.id, sessionId: null, trigger: { kind: 'urgent', content: ANKLE } })
    expect((await w.db.select().from(outbox).where(eq(outbox.id, id!)))[0]!.status).toBe('pending_review')
    expect(deps.sent).toEqual([])
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'parent_email'))
    expect(run!.reason).toContain('urgent notes always wait for review')
    const routine = await draftParentEmail(deps, { studentId: w.dee.id, sessionId: null, trigger: { kind: 'request', content: 'belt test is Friday' } })
    expect((await w.db.select().from(outbox).where(eq(outbox.id, routine!)))[0]!.status).toBe('sent')
    expect(deps.sent).toHaveLength(1)
  })

  it('fact guard: a draft that drops the observation is replaced by the plain factual template', async () => {
    const w = await world()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ subject: 'Great roundhouse progress!', body: 'Hi Sam! Dee has been doing amazing work on her roundhouse kicks lately. Try practicing balance at home for five minutes!' })) })
    const id = await draftParentEmail(deps, { studentId: w.dee.id, sessionId: null, trigger: { kind: 'urgent', content: ANKLE } })
    const [row] = await w.db.select().from(outbox).where(eq(outbox.id, id!))
    expect(row!.subject).toBe('Dee: rolled her ankle a little, sat out the last drill')
    expect(row!.body).toContain(`A quick note from class today about Dee: ${ANKLE}.`)
    expect(row!.body).toContain('Coach Galen')
    expect(row!.body).not.toMatch(/roundhouse|practic/i)
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'parent_email'))
    expect(run!.reason).toContain('fact check failed')
  })

  it('keyword check: the observation’s content words, matched by stem', () => {
    expect(observationKeywords(ANKLE, 'Dee')).toEqual(['rolled', 'ankle', 'sat', 'last', 'drill'])
    expect(keepsFacts(ANKLE, 'Dee', 'Dee rolled her ankle', 'She rolled it a little and sat out the last drill.')).toBe(true)
    expect(keepsFacts(ANKLE, 'Dee', 'Update from class', 'Dee had a great day.')).toBe(false)
    expect(keepsFacts('hit his head on the mat', 'Leo', 'Leo bumped his head', 'Leo hit his head on the mat today and rested.')).toBe(true)
  })
})
