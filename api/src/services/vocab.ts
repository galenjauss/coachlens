import { asc, eq, inArray } from 'drizzle-orm'
import { MAX_VOCAB, VOCAB_TERM_MAX } from '@matside/shared'
import type { Db } from '../db/client'
import { drills, schoolVocab } from '../db/schema'

/** Total characters of hints handed to the transcriber (its prompt is short; names come first). */
export const MAX_HINT_CHARS = 900

const key = (t: string) => t.trim().toLowerCase()

/** Trim, drop empties and over-long terms, dedupe case-insensitively (first spelling wins), cap the count. */
export function normalizeTerms(terms: readonly string[], max = MAX_VOCAB): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of terms) {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (!t || t.length > VOCAB_TERM_MAX || seen.has(key(t))) continue
    seen.add(key(t))
    out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** The instructor's custom vocabulary, oldest first. */
export async function vocabHints(db: Db): Promise<string[]> {
  const rows = await db.select({ term: schoolVocab.term }).from(schoolVocab).orderBy(asc(schoolVocab.createdAt), asc(schoolVocab.term))
  return rows.map(r => r.term)
}

/** Replaces the vocabulary with the normalized list. */
export async function setVocab(db: Db, terms: readonly string[]): Promise<string[]> {
  const next = normalizeTerms(terms)
  const have = await vocabHints(db)
  const keep = new Set(next.map(key))
  const gone = have.filter(t => !keep.has(key(t)))
  if (gone.length) await db.delete(schoolVocab).where(inArray(schoolVocab.term, gone))
  const haveKeys = new Set(have.map(key))
  const fresh = next.filter(t => !haveKeys.has(key(t)))
  if (fresh.length) await db.insert(schoolVocab).values(fresh.map((term, i) => ({ term, createdAt: new Date(Date.now() + i) }))).onConflictDoNothing()
  return vocabHints(db)
}

/** Best effort: adds new terms (deduped, capped at MAX_VOCAB total). Never throws. Returns how many were added. */
export async function addVocab(db: Db, terms: readonly string[]): Promise<number> {
  try {
    const have = await vocabHints(db)
    const haveKeys = new Set(have.map(key))
    const room = MAX_VOCAB - have.length
    const fresh = normalizeTerms(terms).filter(t => !haveKeys.has(key(t))).slice(0, Math.max(0, room))
    if (fresh.length) await db.insert(schoolVocab).values(fresh.map((term, i) => ({ term, createdAt: new Date(Date.now() + i) }))).onConflictDoNothing()
    return fresh.length
  } catch (e) {
    console.error('[vocab:add]', e instanceof Error ? e.message : e)
    return 0
  }
}

/** Dedupes case-insensitively and stops before the character budget runs out. Order = priority. */
export function capHints(list: readonly string[], maxChars = MAX_HINT_CHARS): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  let used = 0
  for (const h of list) {
    const t = h.trim()
    if (!t || seen.has(key(t))) continue
    if (used + t.length + 2 > maxChars) break
    seen.add(key(t))
    out.push(t)
    used += t.length + 2
  }
  return out
}

/** STT hints: roster names and aliases first, then custom vocabulary, then the current deck's drill names. */
export async function sttHints(db: Db, rosterTerms: readonly string[], deckId: string | null): Promise<string[]> {
  const vocab = await vocabHints(db)
  const deck = deckId ? (await db.select({ name: drills.name }).from(drills).where(eq(drills.deckId, deckId))).map(d => d.name) : []
  return capHints([...rosterTerms, ...vocab, ...deck])
}
