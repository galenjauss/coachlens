import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb } from '../test/helpers'
import { seed } from './seed'
import { students, notes, issues, curriculum, decks, classes, guardians, drills } from './schema'

describe('seed', () => {
  it('creates the demo world and is idempotent', async () => {
    const db = await makeTestDb()
    const opts = { today: '2026-10-17', guardianEmail: (i: number) => `parent${i}@example.com` }
    await seed(db, opts)
    const r = await seed(db, opts)
    // martial-arts world (unchanged)
    const priyaNotes = await db.select().from(notes).where(eq(notes.studentId, r.priyaId))
    expect(priyaNotes.filter(n => n.tags.includes('guard'))).toHaveLength(2)
    expect((await db.select().from(issues)).length).toBe(2)
    // 2 martial-arts classes (Tue, Thu) + PT + Algebra: 3 modes, 4 classes
    const cls = await db.select().from(classes)
    expect(cls.map(c => c.mode).sort()).toEqual(['martial_arts', 'martial_arts', 'personal_training', 'tutoring'])
    expect(await db.select().from(students)).toHaveLength(23)
    expect(await db.select().from(guardians)).toHaveLength(23)
    const cur = await db.select().from(curriculum)
    const perMode = (m: string) => cur.filter(c => c.mode === m).length
    expect([perMode('martial_arts'), perMode('personal_training'), perMode('tutoring')]).toEqual([4, 2, 2])
    const ds = await db.select().from(decks)
    expect(ds).toHaveLength(4)
    expect(new Set(ds.map(d => d.classId))).toEqual(new Set(cls.map(c => c.id)))
    const deckOf = async (classId: string) => db.select().from(drills).where(eq(drills.deckId, ds.find(d => d.classId === classId)!.id))
    expect(await deckOf(r.classIds.pt)).toHaveLength(7)
    expect(await deckOf(r.classIds.algebra)).toHaveLength(6)
    expect(ds.find(d => d.classId === r.classIds.pt)!.forDate).toBe('2026-10-19') // next Mon
    expect(ds.find(d => d.classId === r.classIds.algebra)!.forDate).toBe('2026-10-21') // next Wed
    // PT: Maria has 2 depth notes so her 3rd triggers recurring; clients get their own emails
    const maria = await db.select().from(notes).where(eq(notes.studentId, r.mariaId))
    expect(maria.filter(n => n.tags.includes('depth'))).toHaveLength(2)
    const [mg] = await db.select().from(guardians).where(eq(guardians.studentId, r.mariaId))
    expect(mg!.name).toBe('Maria Gomez')
    const sam = await db.select().from(notes).where(eq(notes.studentId, r.samPatelId))
    expect(sam.filter(n => n.tags.includes('procedure'))).toHaveLength(2)
    // no seeded rationale claims "this week's theme"
    expect((await db.select().from(drills)).filter(d => /this week/i.test(d.rationale))).toHaveLength(0)
  })
})
