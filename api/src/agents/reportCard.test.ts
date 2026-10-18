import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { draftReportCard } from './reportCard'
import { getStudentDetail, agentFeed } from '../services/students'
import { students, guardians, notes, outbox, reportCards } from '../db/schema'

const content = { strengths: ['Energy'], workingOn: ['Guard'], coachNotes: [{ date: '2026-10-14', drill: 'Jab drill', quote: 'guard drops' }], attendance: '9 of 10 classes', nextGoal: 'Orange stripe test' }

describe('report cards', () => {
  it('drafts once per month, exposes it on student detail, and logs to the feed', async () => {
    const db = await makeTestDb()
    const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
    await db.insert(guardians).values({ studentId: s!.id, name: 'Anita', email: 'anita@example.com' })
    await db.insert(notes).values({ studentId: s!.id, text: 'guard drops', tags: ['guard'] })
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ content, subject: "Priya's October report card", body: 'Hi Anita, Priya had a strong October with great energy. We are working on keeping her guard up. Coach' })) })
    const id1 = await draftReportCard(deps, s!.id, '2026-10')
    const id2 = await draftReportCard(deps, s!.id, '2026-10')
    expect(id1).toBe(id2)
    expect(await db.select().from(reportCards)).toHaveLength(1)
    expect((await db.select().from(outbox))[0]).toMatchObject({ kind: 'report_card', status: 'pending_review' })
    const detail = await getStudentDetail(deps, s!.id)
    expect(detail.reportCard?.content.nextGoal).toBe('Orange stripe test')
    expect(detail.age).toBe(2026 - 2018)
    expect((await agentFeed(db, null))[0]!.agent).toBe('report_card')
  })
})
