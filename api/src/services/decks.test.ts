import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { patchDeck, getDeck } from './decks'
import { alternativesFor, undoDiff } from '../agents/planner'
import { classes, decks, drills, deckDiffs } from '../db/schema'
import { eq } from 'drizzle-orm'

const draft = (name: string) => ({ name, minutes: 5, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '' })

describe('decks', () => {
  it('patchDeck reorders, edits, deletes and adds', async () => {
    const db = await makeTestDb()
    const [c] = await db.insert(classes).values({ instructorId: 'i', name: 'K', weekday: 2, startTime: '17:00' }).returning()
    const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-20' }).returning()
    const [a, b, x] = await db.insert(drills).values(['A', 'B', 'X'].map((n, i) => ({ ...draft(n), deckId: d!.id, position: i + 1 }))).returning()
    const deck = await patchDeck(db, d!.id, { drills: [{ ...draft('B2'), id: b!.id }, { ...draft('New'), id: null }, { ...draft('A'), id: a!.id }] })
    expect(deck.drills.map(r => [r.name, r.position])).toEqual([['B2', 1], ['New', 2], ['A', 3]])
    expect((await db.select().from(drills).where(eq(drills.id, x!.id)))).toHaveLength(0)
  })

  it('alternatives come from the planner; undo marks the diff', async () => {
    const db = await makeTestDb()
    const [c] = await db.insert(classes).values({ instructorId: 'i', name: 'K', weekday: 2, startTime: '17:00' }).returning()
    const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-20' }).returning()
    const [a] = await db.insert(drills).values({ ...draft('Jab'), deckId: d!.id, position: 1 }).returning()
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ alternatives: [draft('Freeze'), draft('Pads'), draft('Mirror')] })) })
    expect((await alternativesFor(deps, a!.id)).map(x => x.name)).toEqual(['Freeze', 'Pads', 'Mirror'])
    const [diff] = await db.insert(deckDiffs).values({ deckId: d!.id, requestText: 'x', diff: { added: [], changed: [], removed: [], rememberSuggestion: null } }).returning()
    await undoDiff(db, diff!.id)
    expect((await db.select().from(deckDiffs))[0]!.status).toBe('undone')
    expect((await getDeck(db, d!.id)).drills).toHaveLength(1)
  })
})
