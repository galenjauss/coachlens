import { eq, isNull } from 'drizzle-orm'
import type { Db } from './client'
import { notes } from './schema'
import { inferValence } from '../logic/valence'

/**
 * Labels notes written before migration 0013 (valence null) with the text heuristic, so reads stop depending on it.
 * Idempotent: only rows still null are touched; a second run changes nothing. Returns per-valence counts.
 */
export async function backfillValence(db: Db): Promise<{ updated: number; byValence: Record<string, number> }> {
  const rows = await db.select({ id: notes.id, text: notes.text }).from(notes).where(isNull(notes.valence))
  const byValence: Record<string, number> = {}
  for (const r of rows) {
    const valence = inferValence(r.text)
    byValence[valence] = (byValence[valence] ?? 0) + 1
    await db.update(notes).set({ valence }).where(eq(notes.id, r.id))
  }
  return { updated: rows.length, byValence }
}
