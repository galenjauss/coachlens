import { and, asc, eq } from 'drizzle-orm'
import type { Deck } from '@matside/shared'
import type { Db } from '../db/client'
import { decks, drills } from '../db/schema'

export async function findDeck(db: Db, classId: string, forDate: string) {
  const [d] = await db.select({ id: decks.id }).from(decks).where(and(eq(decks.classId, classId), eq(decks.forDate, forDate)))
  return d
}

export async function getDeck(db: Db, deckId: string): Promise<Deck> {
  const [d] = await db.select().from(decks).where(eq(decks.id, deckId))
  if (!d) throw new Error(`deck ${deckId} not found`)
  const rows = await db.select().from(drills).where(eq(drills.deckId, deckId)).orderBy(asc(drills.position))
  return {
    id: d.id, classId: d.classId, forDate: d.forDate, status: d.status,
    drills: rows.map(r => ({
      id: r.id, position: r.position, name: r.name, minutes: r.minutes, kind: r.kind, cues: r.cues,
      focusStudentIds: r.focusStudentIds, rationale: r.rationale,
      startedAt: r.startedAt?.toISOString() ?? null, endedAt: r.endedAt?.toISOString() ?? null,
    })),
  }
}
