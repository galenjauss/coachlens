import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb } from '../test/helpers'
import { students, notes } from './schema'

describe('schema', () => {
  it('migrates and round-trips rows with jsonb tags', async () => {
    const db = await makeTestDb()
    const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
    await db.insert(notes).values({ studentId: s!.id, text: 'guard drops', tags: ['guard'] })
    const rows = await db.select().from(notes).where(eq(notes.studentId, s!.id))
    expect(rows[0]!.tags).toEqual(['guard'])
  })
})
