import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from './utterance'
import { classes, students, guardians, enrollments, curriculum, decks, drills, sessions, notes, issues, billingFlags, attendance, outbox, agentRuns } from '../db/schema'
import { draftParentEmail } from '../agents/parentEmail'
import { Deck } from '@matside/shared'
import { getDeck } from './decks'

const intent = (o: Partial<Record<string, unknown>>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false, ...o })

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

  it('3rd guard note opens a recurring issue and adjusts the next deck, no email', async () => {
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
    expect(r.cardLines).toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ added to report card', '→ added to next deck'])
    expect(r.coverage.covered).toBe(1)
    expect(await w.db.select().from(issues)).toHaveLength(1)
    await deps.flush()
    expect(await w.db.select().from(outbox)).toHaveLength(0)
    // every run, including the deferred planner, is linked to the utterance
    const runs = await w.db.select().from(agentRuns).where(eq(agentRuns.utteranceId, r.utteranceId))
    expect(runs.map(x => x.agent).sort()).toEqual(['planner', 'planner', 'progress', 'router']) // next deck draft + diff
    const progress = runs.find(x => x.agent === 'progress')!
    expect(progress.links).toMatchObject({ studentId: w.ss[0]!.id })
    expect(progress.links?.noteId).toBeTruthy()
    expect(runs.find(x => x.agent === 'planner' && x.trigger === 'suggest')!.links?.diffId).toBeTruthy()
    expect(runs.some(x => x.agent === 'planner' && x.trigger === 'draft')).toBe(true)
  })

  it('an urgent note drafts a parent email right away, bypassing the cooldown', async () => {
    const w = await classWorld()
    const leo = w.ss[1]!
    await w.db.insert(outbox).values({ kind: 'parent_email', studentId: leo.id, toEmail: 'x@example.com', subject: 'Earlier', body: 'b', trigger: 'recurring', createdAt: new Date('2026-10-15T00:00:00Z') })
    const deps = makeDeps(w.db, {
      llm: fakeLlm(({ name, prompt }) => {
        if (name === 'router') return { intents: [intent({ studentNames: ['Leo'], content: 'hit his head on the mat, sat out', skillTags: ['focus'], urgent: true })] }
        expect(prompt).toContain('URGENT')
        return { subject: 'Leo bumped his head', body: 'Hi, a quick note: Leo bumped his head on the mat today and sat out to rest.' }
      }),
    })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo hit his head on the mat' })
    expect(r.cardLines).toEqual(['✓ Leo · focus', '⚠ urgent · parent note drafting'])
    await deps.flush()
    const mail = await w.db.select().from(outbox).where(eq(outbox.trigger, 'urgent'))
    expect(mail).toHaveLength(1)
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'parent_email'))
    expect(run).toMatchObject({ utteranceId: r.utteranceId, trigger: 'urgent', links: { studentId: leo.id, outboxId: mail[0]!.id } })
  })

  it('auto (non-urgent) emails respect a 30-day cooldown; explicit requests do not', async () => {
    const w = await classWorld()
    const priya = w.ss[0]!
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ subject: 'Guard update', body: 'Hi! Priya worked hard today and we are focusing on keeping her guard up.' })) })
    expect(await draftParentEmail(deps, { studentId: priya.id, sessionId: null, trigger: { kind: 'recurring', tag: 'guard' } })).toBeTruthy()
    expect(await draftParentEmail(deps, { studentId: priya.id, sessionId: null, trigger: { kind: 'recurring', tag: 'stance' } })).toBeNull()
    expect(await draftParentEmail(deps, { studentId: priya.id, sessionId: null, trigger: { kind: 'request', content: 'belt test is Friday' } })).toBeTruthy()
    expect(await w.db.select().from(outbox)).toHaveLength(2)
    const skipped = await w.db.select().from(agentRuns).where(eq(agentRuns.reason, 'email cooldown'))
    expect(skipped).toHaveLength(1)
  })

  it('roll call by presence marks everyone else absent', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db)
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Present: Priya, Leo and Maya' })
    expect(r.cardLines).toEqual(['3 present', 'absent: Jake, Mia'])
    const rows = await w.db.select().from(attendance).where(eq(attendance.sessionId, w.sessionId))
    expect(rows.filter(x => x.status === 'present')).toHaveLength(3)
    const unclear = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'only Priya and Zed are here' })
    expect(unclear.cardLines[0]).toBe("Didn't catch: Zed")
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.utteranceId, r.utteranceId))
    expect(run).toMatchObject({ agent: 'attendance', status: 'ok' })
  })

  it('aliases on the roster resolve STT spellings', async () => {
    const w = await classWorld()
    await w.db.update(students).set({ aliases: ['Bree ah'] }).where(eq(students.id, w.ss[0]!.id))
    let routerPrompt = ''
    const deps = makeDeps(w.db, { llm: fakeLlm(({ prompt }) => { routerPrompt = prompt; return { intents: [intent({ studentNames: ['Bree ah'], content: 'sharp kicks', skillTags: ['kicks'] })] } }) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Bree ah sharp kicks' })
    expect(r.cardLines).toEqual(['✓ Priya · kicks'])
    expect(routerPrompt).toContain('Priya Rao ("Bree ah")')
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
    const [flag] = await w.db.select().from(billingFlags)
    expect(flag).toBeTruthy()
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'billing'))
    expect(run).toMatchObject({ utteranceId: r.utteranceId, links: { billingFlagId: flag!.id, studentId: w.ss[1]!.id } })
  })

  it('spoken add-drill clamps minutes and name so the deck stays schema-valid', async () => {
    const w = await classWorld()
    const long = 'a very long sparring round name that goes well past forty characters'
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ intents: [intent({ type: 'add_drill', content: long, minutes: 45 })] })) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'add a 45-minute sparring round' })
    expect(r.cardLines[0]).toMatch(/^✓ Added:/)
    const [d] = await w.db.select().from(drills).where(eq(drills.rationale, 'added live by instructor'))
    expect(d!.minutes).toBe(30)
    expect(d!.name.length).toBeLessThanOrEqual(80)
    const [dk] = await w.db.select().from(decks)
    expect(Deck.safeParse(await getDeck(w.db, dk!.id)).success).toBe(true)
  })

  it('parent_message with an unresolvable name saves nothing and says so', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => ({ intents: [intent({ type: 'parent_message', studentNames: ['Zed'], content: 'tell parents' })] })) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'tell Zed parents' })
    expect(r.cardLines).toEqual(['? Didn\'t catch "Zed" · say again'])
    expect(await w.db.select().from(notes).where(eq(notes.text, 'tell parents'))).toHaveLength(0)
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
