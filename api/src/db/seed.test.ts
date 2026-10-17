import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb } from '../test/helpers'
import { seed } from './seed'
import { students, notes, issues, curriculum, decks } from './schema'

describe('seed', () => {
  it('creates the demo world and is idempotent', async () => {
    const db = await makeTestDb()
    const opts = { today: '2026-10-17', guardianEmail: (i: number) => `parent${i}@example.com` }
    await seed(db, opts)
    const r = await seed(db, opts)
    expect(await db.select().from(students)).toHaveLength(14)
    const priyaNotes = await db.select().from(notes).where(eq(notes.studentId, r.priyaId))
    expect(priyaNotes.filter(n => n.tags.includes('guard'))).toHaveLength(2)
    expect((await db.select().from(issues)).length).toBe(2)
    expect((await db.select().from(curriculum)).length).toBe(4)
    expect((await db.select().from(decks)).length).toBe(2)
  })
})
