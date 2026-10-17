import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Deck, DeckPatch } from '@matside/shared'
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

export async function patchDeck(db: Db, deckId: string, patch: DeckPatch): Promise<Deck> {
  const current = await getDeck(db, deckId)
  const ids = patch.drills.flatMap(d => (d.id ? [d.id] : []))
  if (new Set(ids).size !== ids.length) throw new Error('duplicate drill ids')
  const keep = new Set(ids)
  const unknown = [...keep].filter(id => !current.drills.some(d => d.id === id))
  if (unknown.length) throw new Error(`drills not in deck: ${unknown.join(',')}`)
  // Not transactional (neon-http): ids are validated before any write, and a retry after a partial failure is rejected with 400 (ids no longer in the deck), so it can't double-apply.
  const del = current.drills.filter(d => !keep.has(d.id)).map(d => d.id)
  if (del.length) await db.delete(drills).where(inArray(drills.id, del))
  for (const [i, d] of patch.drills.entries()) {
    const { id, ...fields } = d
    if (id) await db.update(drills).set({ ...fields, position: i + 1 }).where(eq(drills.id, id))
    else await db.insert(drills).values({ ...fields, deckId, position: i + 1 })
  }
  return getDeck(db, deckId)
}
