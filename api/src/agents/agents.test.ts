import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { draftParentEmail } from './parentEmail'
import { draftDeck, suggestDiff, acceptDiff } from './planner'
import { getDeck } from '../services/decks'
import { classes, students, guardians, enrollments, curriculum, notes, outbox, deckDiffs, preferences, decks } from '../db/schema'

const drill = (name: string, minutes = 5) => ({ name, minutes, kind: 'drill', cues: ['knees out'], focusStudentIds: [], rationale: 'theme' })

async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Tue', weekday: 2, startTime: '17:00' }).returning()
  const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
  await db.insert(guardians).values({ studentId: s!.id, name: 'Anita Rao', email: 'anita@example.com' })
  await db.insert(enrollments).values({ classId: c!.id, studentId: s!.id })
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  await db.insert(notes).values({ studentId: s!.id, text: 'guard drops on jab', tags: ['guard'] })
  return { db, classId: c!.id, studentId: s!.id }
}

describe('parent email agent', () => {
  it('drafts a pending_review email to the guardian with notes in the prompt', async () => {
    const { db, studentId } = await world()
    let prompt = ''
    const deps = makeDeps(db, { llm: fakeLlm(a => { prompt = a.prompt; return { subject: "Priya's guard", body: 'Hi Anita, Priya has been working hard on keeping her guard up during jabs. Try a fun mirror game at home!' } }) })
    const id = await draftParentEmail(deps, { studentId, sessionId: null, trigger: { kind: 'recurring', tag: 'guard' } })
    expect(prompt).toContain('guard drops on jab')
    const [row] = await db.select().from(outbox).where(eq(outbox.id, id!))
    expect(row).toMatchObject({ status: 'pending_review', toEmail: 'anita@example.com', kind: 'parent_email' })
  })
})

describe('planner agent', () => {
  it('drafts a deck, suggests a diff, and accepts it with a remembered preference', async () => {
    const { db, classId } = await world()
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name }) => name === 'planner.draft'
        ? { drills: ['Tag', 'Holds', 'Jab', 'Kata 2', 'Sharks', 'Kicks', 'Pads', 'Bow out'].map(n => drill(n)) }
        : { added: [{ ...drill('Sparring', 8), kind: 'sparring', afterPosition: 2, reason: 'green belts' }], changed: [], removed: [], rememberSuggestion: 'Tuesday kids need more structure' }),
    })
    const deckId = await draftDeck(deps, classId, '2026-10-20')
    expect((await getDeck(db, deckId!)).drills).toHaveLength(8)
    expect(await draftDeck(deps, classId, '2026-10-20')).toBe(deckId) // idempotent
    const s = await suggestDiff(deps, deckId!, 'add sparring')
    expect(s?.diff.added).toHaveLength(1)
    const deck = await acceptDiff(deps, s!.diffId, { remember: true })
    expect(deck.drills.map(d => d.name).slice(0, 3)).toEqual(['Tag', 'Holds', 'Sparring'])
    expect(deck.drills.map(d => d.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const [diffRow] = await db.select().from(deckDiffs)
    expect(diffRow!.status).toBe('accepted')
    expect(await db.select().from(preferences)).toHaveLength(1)
  })

  it('rejects a second accept of the same diff without duplicating drills', async () => {
    const { db, classId } = await world()
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name }) => name === 'planner.draft'
        ? { drills: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(n => drill(n)) }
        : { added: [{ ...drill('Sparring', 8), kind: 'sparring', afterPosition: 2, reason: 'x' }], changed: [], removed: [], rememberSuggestion: null }),
    })
    const deckId = await draftDeck(deps, classId, '2026-10-20')
    const s = await suggestDiff(deps, deckId!, 'add sparring')
    await acceptDiff(deps, s!.diffId, { remember: false })
    await expect(acceptDiff(deps, s!.diffId, { remember: false })).rejects.toThrow('not pending')
    const deck = await getDeck(db, deckId!)
    expect(deck.drills.filter(d => d.name === 'Sparring')).toHaveLength(1)
    expect(deck.drills).toHaveLength(9)
  })

  it('re-drafts a pre-existing empty deck', async () => {
    const { db, classId } = await world()
    await db.insert(decks).values({ classId, forDate: '2026-10-20' })
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ drills: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map(n => drill(n)) })) })
    const deckId = await draftDeck(deps, classId, '2026-10-20')
    expect(deckId).toBeTruthy()
    expect((await getDeck(db, deckId!)).drills).toHaveLength(8)
    expect(await db.select().from(decks)).toHaveLength(1)
  })
})
