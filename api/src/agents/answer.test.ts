import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { MODES } from '@matside/shared'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from '../services/utterance'
import { classes, students, enrollments, curriculum, decks, drills, sessions, notes, issues, attendance, agentRuns, studentMetrics } from '../db/schema'
import { BudgetExceededError } from './budget'
import { fastAnswer, matchTag, normalizeAnswer, packList, NOT_ENOUGH } from './answer'
import { digestText, DIGEST_MAX_CHARS, loadClassFacts, type ClassFacts } from '../services/classDigest'

const base = { studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }
const question = (q: string) => ({ ...base, type: 'question', content: q, question: q })
const at = (iso: string) => new Date(`${iso}T00:00:00Z`)

async function world(opts: { notes?: boolean } = {}) {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Sam Lee', 'Mia Lopez'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  await db.insert(drills).values([{ deckId: d!.id, position: 2, name: 'Kick ladder', minutes: 5, kind: 'drill' }, { deckId: d!.id, position: 3, name: 'Freeze tag', minutes: 5, kind: 'game' }])
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const [priya, leo, sam] = ss
  if (opts.notes !== false) {
    const guard = (studentId: string, day: string) => ({ studentId, text: 'guard drops on the jab', tags: ['guard'], createdAt: at(day) })
    await db.insert(notes).values([guard(priya!.id, '2026-10-05'), guard(priya!.id, '2026-10-10'), guard(priya!.id, '2026-10-14'), guard(leo!.id, '2026-10-12'), guard(leo!.id, '2026-10-15'), guard(sam!.id, '2026-10-16'),
      { studentId: sam!.id, text: 'kicks too low', tags: ['kicks'], createdAt: at('2026-10-16') },
      guard(sam!.id, '2026-09-01')]) // outside the 21-day window
  }
  return { db, sessionId: se!.id, drillId: dr!.id, ss }
}

const ask = (deps: ReturnType<typeof makeDeps>, w: Awaited<ReturnType<typeof world>>, q: string) =>
  handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: q })

const routerOnly = (q: string, answer?: (a: { prompt: string; instructions: string }) => unknown) => {
  const calls: string[] = []
  const llm = fakeLlm(a => {
    calls.push(a.name)
    if (a.name === 'router') return { intents: [question(q)] }
    if (answer) return answer(a)
    throw new Error(`unexpected ${a.name}`)
  })
  return { llm, calls }
}

describe('class questions', () => {
  it('a tag question answers from notes without the model: "Guard: Priya (3), Leo (2), Sam (1)"; the run is logged', async () => {
    const w = await world()
    const { llm, calls } = routerOnly('Who is forgetting to keep their guard up?')
    const deps = makeDeps(w.db, { llm })
    const r = await ask(deps, w, 'who is forgetting to keep their guard up?')
    expect(r.brief).toEqual({ name: 'Answer', lines: ['Guard: Priya (3), Leo (2), Sam (1)'] })
    expect(r.cardLines).toEqual(['? Who is forgetting to keep their…'])
    expect(r.cardLines[0]!.length).toBeLessThanOrEqual(38)
    expect(calls).toEqual(['router'])
    expect(r.attendanceChanged).toBeUndefined()
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'answer'))
    expect(run).toMatchObject({ trigger: 'question', status: 'ok', utteranceId: r.utteranceId, sessionId: w.sessionId, summary: 'Who is forgetting to keep their guard up?', reason: 'fast path: tag guard' })
    // no writes: the question leaves no note behind
    expect(await w.db.select().from(notes).where(eq(notes.sessionId, w.sessionId))).toHaveLength(0)
  })

  it('an open issue with no recent notes still lists the student; an unknown tag reads "No … notes"', async () => {
    const w = await world()
    await w.db.insert(issues).values({ studentId: w.ss[3]!.id, tag: 'guard', openedAt: at('2026-08-01') })
    const f = await loadClassFacts(w.db, w.sessionId, w.drillId, new Date('2026-10-20T00:30:00Z'), 'America/Los_Angeles')
    expect(fastAnswer(f, 'who keeps dropping their hands?')?.lines).toEqual(['Guard: Priya (3), Leo (2), Sam (1),', 'Mia'])
    expect(fastAnswer(f, 'anyone sloppy on footwork?')?.lines).toEqual(['No footwork notes in 21 days'])
    expect(matchTag(MODES.martial_arts, 'what should I focus on next drill?')).toBeNull() // no "who": goes to the model
    expect(matchTag(MODES.personal_training, 'who is cutting their depth?')).toBe('depth')
  })

  it("who hasn't gotten feedback comes from today's coverage", async () => {
    const w = await world()
    await w.db.insert(attendance).values(w.ss.map((s, i) => ({ sessionId: w.sessionId, studentId: s.id, status: i === 3 ? 'absent' as const : 'present' as const, source: 'voice' as const })))
    await w.db.insert(notes).values({ sessionId: w.sessionId, studentId: w.ss[0]!.id, text: 'nice stance', tags: ['stance'] })
    const { llm, calls } = routerOnly("Who hasn't gotten feedback today?")
    const r = await ask(makeDeps(w.db, { llm }), w, "who hasn't gotten feedback today")
    expect(r.brief?.lines).toEqual(['No feedback yet: Leo, Sam'])
    expect(calls).toEqual(['router'])
  })

  it('how many are here comes from attendance', async () => {
    const w = await world()
    const { llm } = routerOnly('How many are here?')
    const deps = makeDeps(w.db, { llm })
    expect((await ask(deps, w, 'how many are here')).brief?.lines).toEqual(['No roll call yet', '4 on the roster'])
    await w.db.insert(attendance).values(w.ss.map((s, i) => ({ sessionId: w.sessionId, studentId: s.id, status: i >= 2 ? 'absent' as const : 'present' as const, source: 'voice' as const })))
    expect((await ask(deps, w, 'how many are here')).brief?.lines).toEqual(['2 here · 2 absent', 'Absent: Sam, Mia'])
  })

  it('anything else asks the fast model over the class digest; its lines are normalized to the lens budget', async () => {
    const w = await world()
    await w.db.insert(studentMetrics).values({ studentId: w.ss[0]!.id, key: 'kata', value: '9', num: 9, unit: null, source: 'voice' })
    let seen = { prompt: '', instructions: '' }
    const { llm, calls } = routerOnly('What should I focus on next drill?', a => {
      seen = a
      return { lines: ['- **Guard**: Priya and Leo keep dropping their hands on the jab', 'Kick ladder next', '', 'line four', 'line five'] }
    })
    const r = await ask(makeDeps(w.db, { llm }), w, 'what should I focus on next drill')
    expect(calls).toEqual(['router', 'answer'])
    expect(r.brief?.name).toBe('Answer')
    expect(r.brief?.lines).toEqual(['Guard: Priya and Leo keep dropping…', 'Kick ladder next', 'line four', 'line five'])
    expect(seen.prompt).toContain('Question: """What should I focus on next drill?"""')
    expect(seen.prompt).toContain('Priya | yellow')
    expect(seen.prompt).toContain('[guard] guard drops on the jab')
    expect(seen.prompt).toContain('drill: Guard-up jab · next: Kick ladder, Freeze tag')
    expect(seen.prompt).toContain('kata 9')
    expect(seen.instructions).toContain(NOT_ENOUGH)
    expect(seen.instructions).toMatch(/No medical/)
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'answer'))
    expect(run).toMatchObject({ status: 'ok', reason: 'model answer from the class digest' })
  })

  it('"Not enough notes yet": thin data skips the model; an empty model answer says the same', async () => {
    const thin = await world({ notes: false })
    const a = routerOnly("Who's closest to testing?")
    const r = await ask(makeDeps(thin.db, { llm: a.llm }), thin, "who's closest to testing")
    expect(r.brief?.lines).toEqual([NOT_ENOUGH])
    expect(a.calls).toEqual(['router'])
    expect(normalizeAnswer([])).toEqual([NOT_ENOUGH])
    expect(normalizeAnswer(['  ', '- '])).toEqual([NOT_ENOUGH])
    const w = await world()
    const b = routerOnly("Who's closest to testing?", () => ({ lines: [] }))
    expect((await ask(makeDeps(w.db, { llm: b.llm }), w, "who's closest to testing")).brief?.lines).toEqual([NOT_ENOUGH])
  })

  it("budget reached: a clean card line, no brief, the run logged as an error", async () => {
    const w = await world()
    const { llm } = routerOnly("Who's been missing class?", () => { throw new BudgetExceededError() })
    const r = await ask(makeDeps(w.db, { llm }), w, "who's been missing class")
    expect(r.cardLines).toEqual(["● Couldn't answer · try again"])
    expect(r.brief).toBeUndefined()
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'answer'))
    expect(run).toMatchObject({ status: 'error', trigger: 'question' })
  })

  it('line budget: lists pack into ≤4 lines of ≤38 chars with "+N more"; the digest stays under 2,500 chars', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Student${i} (${30 - i})`)
    const lines = packList('Guard', names)
    expect(lines.length).toBeLessThanOrEqual(4)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(38)
    expect(lines.at(-1)).toMatch(/\+\d+ more$/)
    expect(lines[0]!.startsWith('Guard: Student0 (30),')).toBe(true)
    expect(packList('Guard', ['Priya (3)'])).toEqual(['Guard: Priya (3)'])
    for (const l of normalizeAnswer(['x'.repeat(80), 'a b c '.repeat(20)])) expect(l.length).toBeLessThanOrEqual(38)

    const big: ClassFacts = {
      mode: MODES.martial_arts, today: '2026-10-19', theme: 'Stances', attendanceTaken: true, drill: 'Jab', remaining: ['A', 'B'], insights: ['Jake is back'],
      students: Array.from({ length: 40 }, (_, i) => ({
        id: `s${i}`, name: `Kid${i} Long-Surname`, first: `Kid${i}`, belt: 'yellow', rankSince: '2026-01-01',
        openIssues: [{ tag: 'guard', count: 3 }], tagCounts: { guard: 3 }, attendance: 'PPAPPPP', presentToday: true, notedToday: i % 2 === 0,
        recentNotes: [1, 2, 3].map(n => ({ tags: ['guard'], text: `note ${n} about a long and detailed correction on the jab` })), metrics: ['kata 9'],
      })),
    }
    const t = digestText(big)
    expect(t.length).toBeLessThanOrEqual(DIGEST_MAX_CHARS)
    expect(t.startsWith('Martial arts · students')).toBe(true)
    expect(digestText({ ...big, students: big.students.slice(0, 3) })).toContain('notes: [guard] note 1')
  })

  it('attendanceChanged is set for a roll call and a voice "mark present", and not otherwise', async () => {
    const w = await world()
    const rc = await handleUtterance(makeDeps(w.db), { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Everyone except Mia' })
    expect(rc.attendanceChanged).toBe(true)
    const llm = fakeLlm(() => ({ intents: [{ ...base, type: 'attendance', studentNames: ['Mia'], content: 'Mia walked in', attendanceStatus: 'present' }] }))
    const marked = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Mia just walked in' })
    expect(marked.cardLines).toEqual(['√ Mia marked present'])
    expect(marked.attendanceChanged).toBe(true)
  })
})
