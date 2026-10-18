// F01 regression for class answers: a question's polarity decides which observations count as evidence.
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from '../services/utterance'
import { agentRuns, classes, curriculum, decks, drills, enrollments, issues, notes, sessions, students } from '../db/schema'
import { fastAnswer, questionPolarity } from './answer'
import { loadClassFacts } from '../services/classDigest'

const base = { studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }
const at = (iso: string) => new Date(`${iso}T01:00:00Z`)

/**
 * Priya: three guard concerns. Leo: one positive guard note. Sam: improving. Mia: one historical concern.
 * Ben: an old resolved guard issue and no guard notes in the window. Ava: concerns, then praise most recently.
 */
async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Sam Lee', 'Mia Lopez', 'Ben Ortiz', 'Ava Kim'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const [priya, leo, sam, mia, ben, ava] = ss
  const n = (studentId: string, text: string, valence: 'concern' | 'positive' | 'improving', day: string, historical = false) => ({ studentId, text, tags: ['guard'], valence, historical, createdAt: at(day) })
  await db.insert(notes).values([
    n(priya!.id, 'guard drops on the jab', 'concern', '2026-10-05'), n(priya!.id, 'hands low in sparring', 'concern', '2026-10-10'), n(priya!.id, 'guard drops again', 'concern', '2026-10-14'),
    n(leo!.id, 'kept his guard up the whole round', 'positive', '2026-10-15'),
    n(sam!.id, 'guard getting better', 'improving', '2026-10-16'),
    n(mia!.id, 'dropped her guard last week', 'concern', '2026-10-16', true),
    n(ava!.id, 'guard low', 'concern', '2026-10-06'), n(ava!.id, 'guard low again', 'concern', '2026-10-09'), n(ava!.id, 'excellent guard today', 'positive', '2026-10-17'),
  ])
  await db.insert(issues).values({ studentId: ben!.id, tag: 'guard', status: 'resolved', openedAt: at('2026-08-01') })
  return { db, sessionId: se!.id, drillId: dr!.id }
}

const facts = (w: Awaited<ReturnType<typeof world>>) => loadClassFacts(w.db, w.sessionId, w.drillId, new Date('2026-10-20T00:30:00Z'), 'America/Los_Angeles')

describe('F01: class answers respect the question polarity', () => {
  it('audit case: "Who has excellent guard technique?" lists positive guard evidence, never concern counts', async () => {
    const w = await world()
    const calls: string[] = []
    const q = 'Who has excellent guard technique?'
    const llm = fakeLlm(({ name }) => {
      calls.push(name)
      if (name === 'router') return { intents: [{ ...base, type: 'question', content: q, question: q }] }
      throw new Error(`unexpected ${name}`)
    })
    const r = await handleUtterance(makeDeps(w.db, { llm }), { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: q })
    expect(r.brief?.lines).toEqual(['Good guard: Ava (1), Leo (1), Sam (1)'])
    expect(r.brief!.lines.join(' ')).not.toMatch(/Priya|Mia|Ben/)
    expect(calls).toEqual(['router'])
    const [run] = await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'answer'))
    expect(run!.reason).toBe('fast path: tag guard (positive)')
    // the supporting notes are exposed in the run output
    const out = run!.output as { support: { name: string; count: number; notes: string[] }[] }
    expect(out.support.find(s => s.name === 'Leo')).toEqual({ name: 'Leo', count: 1, notes: ['kept his guard up the whole round'] })
  })

  it('"Who is forgetting to keep their guard up?" lists concerns only; recent praise is marked improving', async () => {
    const f = await facts(await world())
    const a = fastAnswer(f, 'Who is forgetting to keep their guard up?')!
    expect(a.lines).toEqual(['Guard: Priya (3), Ava (2, improving),', 'Mia (1)'])
    expect(a.lines.join(' ')).not.toMatch(/Leo|Sam|Ben/)
    expect(a.support.find(s => s.name === 'Priya')!.notes).toContain('guard drops again')
  })

  it('a resolved issue with no concerns in the window is not listed; an open issue with none is', async () => {
    const w = await world()
    const f = await facts(w)
    expect(fastAnswer(f, 'who is struggling with their guard?')!.lines.join(' ')).not.toContain('Ben')
    const [ben] = await w.db.select().from(students).where(eq(students.name, 'Ben Ortiz'))
    await w.db.insert(issues).values({ studentId: ben!.id, tag: 'guard', openedAt: at('2026-08-01') })
    expect(fastAnswer(await facts(w), 'who is struggling with their guard?')!.lines.join(' ')).toContain('Ben')
  })

  it('no positive evidence reads as such; a question of unclear polarity goes to the model', async () => {
    const f = await facts(await world())
    expect(fastAnswer(f, 'who has great footwork?')!.lines).toEqual(['No positive footwork notes in 21 days'])
    expect(fastAnswer(f, 'who has guard notes?')).toBeNull()
  })

  it('classifies polarity', () => {
    expect(questionPolarity('Who has excellent guard technique?')).toBe('positive')
    expect(questionPolarity("who's improved their kicks")).toBe('positive')
    expect(questionPolarity('who is forgetting to keep their guard up?')).toBe('concern')
    expect(questionPolarity('who keeps dropping their hands?')).toBe('concern')
    expect(questionPolarity("who isn't doing well on guard")).toBe('concern')
    expect(questionPolarity('who needs work on depth?')).toBe('concern')
    expect(questionPolarity('who has guard notes?')).toBe('unclear')
  })
})
