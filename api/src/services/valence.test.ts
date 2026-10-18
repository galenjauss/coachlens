// F01 regression: praise, improvement and past observations must never count as a new recurring problem.
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from './utterance'
import { agentRuns, classes, curriculum, decks, deckDiffs, drills, enrollments, guardians, issues, notes, sessions, students } from '../db/schema'
import { inferValence, countsAsConcern, effectiveValence } from '../logic/valence'
import { buildCardLines } from '../logic/cardLines'

const intent = (o: Record<string, unknown>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false, ...o })

/** The audit seed shape: Priya has two guard concern notes in the last 30 days. */
async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: 'Pat', email: `${s.id}@example.com` })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const priya = ss[0]!
  await db.insert(notes).values([
    { studentId: priya.id, text: 'Guard drops after the jab', tags: ['guard'], valence: 'concern', createdAt: new Date('2026-10-07T01:00:00Z') },
    { studentId: priya.id, text: 'Hands low when tired in sparring', tags: ['guard'], valence: 'concern', createdAt: new Date('2026-10-14T01:00:00Z') },
  ])
  return { db, sessionId: se!.id, drillId: dr!.id, priya, leo: ss[1]! }
}

/** A router stub; any other model call (planner, email) fails the test. */
const routerSays = (...intents: Record<string, unknown>[]) => {
  const calls: string[] = []
  const llm = fakeLlm(({ name }) => {
    calls.push(name)
    if (name === 'router') return { intents: intents.map(intent) }
    throw new Error(`unexpected model call: ${name}`)
  })
  return { llm, calls }
}

describe('F01: observation valence in issue counting', () => {
  it('audit case: "Priya kept her guard up today" after two guard concerns opens no issue and queues no plan change', async () => {
    const w = await world()
    const { llm, calls } = routerSays({ studentNames: ['Priya'], content: 'kept her guard up today', skillTags: ['guard'], valence: 'positive', observedWhen: 'today' })
    const deps = makeDeps(w.db, { llm })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya kept her guard up today' })
    await deps.flush()
    expect(await w.db.select().from(issues)).toEqual([])
    expect(await w.db.select().from(deckDiffs)).toEqual([])
    expect(calls).toEqual(['router'])
    expect(r.cardLines).toEqual(['√ Priya · praise · guard'])
    expect(r.cardLines.join(' ')).not.toMatch(/time\)|report card|next deck/)
    const [n] = await w.db.select().from(notes).where(eq(notes.utteranceId, r.utteranceId))
    expect(n).toMatchObject({ valence: 'positive', historical: false, studentId: w.priya.id })
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'progress'))
    expect(run!.summary).toMatch(/^Logged praise "kept her guard up today" → Priya/)
    expect(run!.reason).toContain('positive guard observation')
    expect(run!.reason).not.toMatch(/recurring/)
  })

  it('a router reply without valence (older stub) falls back to the text: praise still never counts', async () => {
    const w = await world()
    const { llm } = routerSays({ studentNames: ['Priya'], content: 'kept her guard up the whole round, great job', skillTags: ['guard'] })
    const deps = makeDeps(w.db, { llm })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya kept her guard up the whole round, great job' })
    expect(await w.db.select().from(issues)).toEqual([])
    expect(r.cardLines).toEqual(['√ Priya · praise · guard'])
  })

  it('a third concern still opens the recurring issue (the concern path is unchanged)', async () => {
    const w = await world()
    const llm = fakeLlm(({ name }) => {
      if (name === 'router') return { intents: [intent({ studentNames: ['Priya'], content: 'guard drops on the jab again', skillTags: ['guard'], valence: 'concern', observedWhen: 'today' })] }
      if (name === 'planner.draft') return { drills: Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' })) }
      return { added: [], changed: [], removed: [], rememberSuggestion: null }
    })
    const deps = makeDeps(w.db, { llm })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya guard drops on the jab again' })
    expect(r.cardLines[0]).toBe('√ Priya · guard (3rd time)')
    expect(await w.db.select().from(issues)).toHaveLength(1)
  })

  it('an improving observation on an open issue surfaces "improving", keeps the issue open, and adds nothing', async () => {
    const w = await world()
    await w.db.insert(notes).values({ studentId: w.priya.id, text: 'guard low again', tags: ['guard'], valence: 'concern', createdAt: new Date('2026-10-16T01:00:00Z') })
    const [open] = await w.db.insert(issues).values({ studentId: w.priya.id, tag: 'guard', openedAt: new Date('2026-10-16T01:00:00Z') }).returning()
    const { llm, calls } = routerSays({ studentNames: ['Priya'], content: 'guard is better today', skillTags: ['guard'], valence: 'improving', observedWhen: 'today' })
    const deps = makeDeps(w.db, { llm })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya guard is better today' })
    await deps.flush()
    expect(calls).toEqual(['router'])
    expect(r.cardLines).toEqual(['√ Priya · improving · guard', '→ open guard issue: improving'])
    const all = await w.db.select().from(issues)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: open!.id, status: 'open' })
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'progress'))
    expect(run!.reason).toContain('open guard issue → improving (1 positive since it opened)')
  })

  it('a historical concern ("last week she dropped her guard") is logged but not counted as a new occurrence', async () => {
    const w = await world()
    const { llm, calls } = routerSays({ studentNames: ['Priya'], content: 'last week she dropped her guard in sparring', skillTags: ['guard'], valence: 'concern', observedWhen: 'earlier' })
    const deps = makeDeps(w.db, { llm })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Last week Priya dropped her guard in sparring' })
    await deps.flush()
    expect(calls).toEqual(['router'])
    expect(await w.db.select().from(issues)).toEqual([])
    expect(r.cardLines).toEqual(['√ Priya · guard · earlier, not counted'])
    const [n] = await w.db.select().from(notes).where(eq(notes.utteranceId, r.utteranceId))
    expect(n).toMatchObject({ valence: 'concern', historical: true })
    // and a later concern today is the 3rd *current* concern, not the 4th
    const llm2 = fakeLlm(({ name }) => {
      if (name === 'router') return { intents: [intent({ studentNames: ['Priya'], content: 'guard drops again', skillTags: ['guard'], valence: 'concern', observedWhen: 'today' })] }
      if (name === 'planner.draft') return { drills: Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' })) }
      return { added: [], changed: [], removed: [], rememberSuggestion: null }
    })
    const r2 = await handleUtterance(makeDeps(w.db, { llm: llm2 }), { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya guard drops again' })
    expect(r2.cardLines[0]).toBe('√ Priya · guard (3rd time)')
  })

  it('a resolved issue does not hide new concerns, and praise after resolution opens nothing', async () => {
    const w = await world()
    await w.db.insert(issues).values({ studentId: w.priya.id, tag: 'guard', status: 'resolved', openedAt: new Date('2026-09-01T00:00:00Z') })
    const { llm } = routerSays({ studentNames: ['Priya'], content: 'great guard in pad work', skillTags: ['guard'], valence: 'positive', observedWhen: 'today' })
    await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya great guard in pad work' })
    expect((await w.db.select().from(issues)).map(i => i.status)).toEqual(['resolved'])
  })

  it('a positive note does not count toward a later concern total', async () => {
    const w = await world()
    await w.db.insert(notes).values({ studentId: w.priya.id, text: 'kept her guard up', tags: ['guard'], valence: 'positive', createdAt: new Date('2026-10-15T01:00:00Z') })
    const { llm } = routerSays({ studentNames: ['Leo'], content: 'nice stance', skillTags: ['stance'], valence: 'positive' })
    await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo nice stance' })
    const rows = await w.db.select().from(notes).where(eq(notes.studentId, w.priya.id))
    expect(rows.filter(countsAsConcern)).toHaveLength(2)
  })
})

describe('F01: valence helpers and card lines', () => {
  it('infers valence from legacy text conservatively', () => {
    expect(inferValence('Guard drops after the jab')).toBe('concern')
    expect(inferValence('Hands low when tired in sparring')).toBe('concern')
    expect(inferValence('Talking in line-up')).toBe('concern')
    expect(inferValence('Priya kept her guard up today')).toBe('positive')
    expect(inferValence('Great respect bowing in')).toBe('positive')
    expect(inferValence('Big improvement on her front kick chamber')).toBe('improving')
    expect(inferValence('Kicks getting higher')).toBe('improving')
    expect(inferValence('guard drops on the jab again, great energy though')).toBe('concern')
    expect(inferValence('Worked on kata 2')).toBe('neutral')
  })
  it('stored valence wins over the text; historical rows never count', () => {
    expect(effectiveValence({ valence: 'positive', text: 'guard drops' })).toBe('positive')
    expect(effectiveValence({ valence: null, text: 'guard drops' })).toBe('concern')
    expect(countsAsConcern({ valence: 'concern', text: 'x', historical: true })).toBe(false)
    expect(countsAsConcern({ valence: 'concern', text: 'x', historical: false })).toBe(true)
    expect(countsAsConcern({ valence: 'improving', text: 'x', historical: false })).toBe(false)
  })
  it('card lines read praise as praise and never mention recurrence for it', () => {
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: 'guard', count: 0, recurring: false, valence: 'positive' }])).toEqual(['√ Priya · praise · guard'])
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: null, count: 0, recurring: false, valence: 'positive' }])).toEqual(['√ Priya · praise'])
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: 'guard', count: 2, recurring: false, valence: 'concern' }])).toEqual(['√ Priya · guard (2nd time)'])
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: 'guard', count: 0, recurring: false, valence: 'neutral' }])).toEqual(['√ Priya · guard'])
  })
})
