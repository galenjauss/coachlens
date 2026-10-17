import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from './utterance'
import { classes, students, guardians, enrollments, curriculum, decks, drills, sessions, notes, issues, billingFlags, attendance, outbox } from '../db/schema'

const intent = (o: Partial<Record<string, unknown>>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, ...o })

async function classWorld() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const names = ['Priya Rao', 'Leo Diaz', 'Jake Ross', 'Mia Lopez', 'Maya Chen']
  const ss = await db.insert(students).values(names.map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: `${s.name} parent`, email: `${s.id}@example.com` })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const priya = ss[0]!
  await db.insert(notes).values([{ studentId: priya.id, text: 'guard low', tags: ['guard'], createdAt: new Date('2026-10-10T00:00:00Z') }, { studentId: priya.id, text: 'guard drops', tags: ['guard'], createdAt: new Date('2026-10-14T00:00:00Z') }])
  return { db, classId: c!.id, sessionId: se!.id, drillId: dr!.id, ss }
}

describe('handleUtterance', () => {
  it('attendance by exception marks present/absent without the LLM', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db)
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Everyone except Jake and Mia' })
    expect(r.cardLines).toEqual(['3 present', 'absent: Jake, Mia'])
    expect(r.coverage).toEqual({ covered: 0, present: 3 })
    const rows = await w.db.select().from(attendance).where(eq(attendance.sessionId, w.sessionId))
    expect(rows.filter(x => x.status === 'absent')).toHaveLength(2)
  })

  it('3rd guard note opens a recurring issue, defers email + next-deck adjust', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, {
      llm: fakeLlm(({ name }) => {
        if (name === 'router') return { intents: [intent({ studentNames: ['Priya'], content: 'guard drops on the jab again', skillTags: ['guard'] })] }
        if (name === 'parent_email') return { subject: "Priya's guard", body: 'Hi! Priya brought great energy today and we are working on her guard.' }
        if (name === 'planner.draft') return { drills: Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' })) }
        return { added: [{ name: 'Hands-up freeze', minutes: 5, kind: 'game', cues: [], focusStudentIds: [], rationale: 'guard', afterPosition: 1, reason: 'guard' }], changed: [], removed: [], rememberSuggestion: null }
      }),
    })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya, guard drops on the jab again' })
    expect(r.cardLines).toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ parent note drafting', '→ added to next deck'])
    expect(r.coverage.covered).toBe(1)
    expect(await w.db.select().from(issues)).toHaveLength(1)
    await deps.flush()
    expect(await w.db.select().from(outbox)).toHaveLength(1)
  })

  it('billing + ambiguous name in one utterance', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, {
      llm: fakeLlm(() => ({ intents: [
        intent({ type: 'billing', studentNames: ['Leo'], content: 'owes for sparring gear', urgency: 'high' }),
        intent({ studentNames: ['Mya'], content: 'kicks higher', skillTags: ['kicks'] }),
      ] })),
    })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo owes for gear urgent, Mya kicks higher' })
    expect(r.cardLines[0]).toBe('✓ Billing flag · Leo · HIGH')
    expect(r.disambiguation?.options.map(o => o.name).sort()).toEqual(['Maya Chen', 'Mia Lopez'])
    expect(await w.db.select().from(billingFlags)).toHaveLength(1)
  })

  it('router failure saves an unassigned note', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => { throw new Error('gateway down') }) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'something' })
    expect(r.cardLines).toEqual(['● Saved · sorting failed, see Review'])
    const [n] = await w.db.select().from(notes).where(eq(notes.text, 'something'))
    expect(n!.studentId).toBeNull()
  })

  it('feedback before roll call keeps the whole roster present', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ intents: [intent({ studentNames: ['Leo'], content: 'good focus', skillTags: ['focus'] })] })) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo good focus' })
    expect(r.coverage).toEqual({ covered: 1, present: 5 })
  })

  it('roll call with an unresolved name writes no attendance', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db)
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Everyone except Mya' })
    expect(r.cardLines[0]).toBe("Didn't catch: Mya")
    expect(await w.db.select().from(attendance).where(eq(attendance.sessionId, w.sessionId))).toHaveLength(0)
  })

  it('second ambiguous name in one intent becomes an unassigned line', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ intents: [intent({ studentNames: ['Mya', 'Mya'], content: 'nice', skillTags: [] })] })) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Mya Mya nice' })
    expect(r.disambiguation).not.toBeNull()
    expect(r.cardLines).toEqual(['● Saved · pick student in Review'])
  })
})
