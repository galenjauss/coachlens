import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { Alternatives, DeckDiff, DrillDraft, type Deck } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { classes, curriculum, deckDiffs, decks, drills, enrollments, issues, preferences, students } from '../db/schema'
import { applyDiff, totalMinutes } from '../logic/deckDiff'
import { nextDateForWeekday, weekStart } from '../logic/dates'
import { findDeck, getDeck } from '../services/decks'
import { withRun } from './runs'

export const PLANNER_INSTRUCTIONS = `You plan kids' martial arts classes (ages 6-12) as a DECK of drill cards the instructor picks from live.
- 8-12 drills totalling 40-50 minutes. Start with a warmup, include technique and drills on the weekly theme, the forms due, at least one game, and end calm.
- Target open issues: include drills that fix the most common ones and list those students in focusStudentIds (use the provided ids only).
- cues: at most 2 short coaching cues (≤40 chars) the instructor will read on smart glasses.
- rationale: one short sentence on why this drill is in the deck.
- Respect the instructor's remembered preferences.
- Keep names ≤40 chars. No medical advice.`

const DraftOut = z.object({ drills: z.array(DrillDraft).min(8).max(12) })

async function planningContext(deps: Deps, classId: string, forDate: string) {
  const { db } = deps
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(forDate)))
  const roster = await db.select({ id: students.id, name: students.name, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, classId))
  const ids = roster.map(r => r.id)
  const open = ids.length ? await db.select().from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : []
  const byTag = new Map<string, string[]>()
  for (const i of open) byTag.set(i.tag, [...(byTag.get(i.tag) ?? []), i.studentId])
  const prefs = await db.select().from(preferences).where(eq(preferences.classId, classId))
  const [last] = await db.select().from(decks).where(and(eq(decks.classId, classId), lt(decks.forDate, forDate))).orderBy(desc(decks.forDate)).limit(1)
  const lastDrills = last ? await db.select().from(drills).where(eq(drills.deckId, last.id)).orderBy(asc(drills.position)) : []
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name ?? id
  const text = [
    `Weekly theme: ${cur?.theme ?? 'General skills'}`,
    `Forms due: ${(cur?.formsDue ?? []).join(', ') || 'none'}`,
    `Roster (id: name, belt): ${roster.map(r => `${r.id}: ${r.name}, ${r.belt}`).join('; ')}`,
    `Open issues: ${[...byTag].map(([tag, s]) => `${tag} → ${s.map(id => `${nameOf(id)} [${id}]`).join(', ')}`).join(' | ') || 'none'}`,
    `Last class: ${lastDrills.map(d => `${d.name} (${d.startedAt ? 'ran' : 'skipped'})`).join(', ') || 'none'}`,
    `Remembered preferences: ${prefs.map(p => p.text).join(' | ') || 'none'}`,
  ].join('\n')
  return { text, theme: cur?.theme ?? 'General skills' }
}

export async function draftDeck(deps: Deps, classId: string, forDate: string): Promise<string | null> {
  const existing = await findDeck(deps.db, classId, forDate)
  if (existing) {
    const [has] = await deps.db.select({ id: drills.id }).from(drills).where(eq(drills.deckId, existing.id)).limit(1)
    if (has) return existing.id
    await deps.db.delete(decks).where(eq(decks.id, existing.id)) // empty leftover from a failed draft
  }
  return withRun(deps, { agent: 'planner', trigger: 'draft', sessionId: null }, async () => {
    const ctx = await planningContext(deps, classId, forDate)
    const out = await deps.llm.object({ name: 'planner.draft', instructions: PLANNER_INSTRUCTIONS, prompt: `Plan the class on ${forDate}.\n${ctx.text}`, schema: DraftOut })
    const [deck] = await deps.db.insert(decks).values({ classId, forDate }).onConflictDoNothing().returning()
    if (!deck) {
      const raced = await findDeck(deps.db, classId, forDate)
      if (!raced) throw new Error('deck insert conflict but no deck found')
      return { result: raced.id, summary: `Deck for ${forDate} already drafted`, reason: 'concurrent draft', output: out }
    }
    try {
      await deps.db.insert(drills).values(out.drills.map((d, i) => ({ ...d, deckId: deck.id, position: i + 1 })))
    } catch (e) {
      await deps.db.delete(decks).where(eq(decks.id, deck.id)).catch(() => {})
      throw e
    }
    return { result: deck.id, summary: `Drafted ${forDate} deck: ${out.drills.length} drills, ${totalMinutes(out.drills)} min (${ctx.theme})`, reason: 'theme + forms cycle + open issues', output: out }
  })
}

export async function suggestDiff(deps: Deps, deckId: string, requestText: string, sessionId: string | null = null) {
  return withRun(deps, { agent: 'planner', trigger: 'suggest', sessionId }, async () => {
    const deck = await getDeck(deps.db, deckId)
    const ctx = await planningContext(deps, deck.classId, deck.forDate)
    const prompt = [
      `Instructor request: """${requestText}"""`,
      `Current deck (position. id | name | minutes | kind):`,
      ...deck.drills.map(d => `${d.position}. ${d.id} | ${d.name} | ${d.minutes}m | ${d.kind}`),
      `Return a minimal diff. afterPosition refers to CURRENT positions (0 = before the first). Use existing drill ids for changed/removed.`,
      `If the request states a lasting preference about this class, put a one-sentence version in rememberSuggestion, else null.`,
      ctx.text,
    ].join('\n')
    const diff = await deps.llm.object({ name: 'planner.diff', instructions: PLANNER_INSTRUCTIONS, prompt, schema: DeckDiff })
    const [row] = await deps.db.insert(deckDiffs).values({ deckId, requestText, diff }).returning()
    return {
      result: { diffId: row!.id, diff },
      summary: `Suggested changes for ${deck.forDate}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`,
      reason: `"${requestText.slice(0, 80)}"`,
      output: diff,
    }
  })
}

export async function acceptDiff(deps: Deps, diffId: string, opts: { remember: boolean }): Promise<Deck> {
  const { db } = deps
  const [claimed] = await db.update(deckDiffs).set({ status: 'accepted' })
    .where(and(eq(deckDiffs.id, diffId), eq(deckDiffs.status, 'pending'))).returning()
  if (!claimed) throw new Error(`diff ${diffId} not pending`)
  const row = claimed
  const deck = await getDeck(db, row.deckId)
  try {
    const planned = applyDiff(deck.drills, row.diff)
    const keepIds = new Set(planned.flatMap(p => (p.id ? [p.id] : [])))
    const toDelete = deck.drills.filter(d => !keepIds.has(d.id)).map(d => d.id)
    if (toDelete.length) await db.delete(drills).where(inArray(drills.id, toDelete))
    for (const [i, p] of planned.entries()) {
      const { id, ...fields } = p
      if (id) await db.update(drills).set({ ...fields, position: i + 1 }).where(eq(drills.id, id))
      else await db.insert(drills).values({ ...fields, deckId: deck.id, position: i + 1 })
    }
  } catch (e) {
    await db.update(deckDiffs).set({ status: 'pending' }).where(eq(deckDiffs.id, diffId)).catch(() => {})
    throw e
  }
  if (opts.remember && row.diff.rememberSuggestion) await db.insert(preferences).values({ classId: deck.classId, text: row.diff.rememberSuggestion })
  return getDeck(db, deck.id)
}

export async function nextDeckFor(deps: Deps, classId: string, afterDate: string): Promise<string | null> {
  const [c] = await deps.db.select().from(classes).where(eq(classes.id, classId))
  if (!c) return null
  return draftDeck(deps, classId, nextDateForWeekday(afterDate, c.weekday))
}

export async function autoAdjustNextDeck(deps: Deps, a: { classId: string; afterDate: string; requestText: string; sessionId: string | null }) {
  const deckId = await nextDeckFor(deps, a.classId, a.afterDate)
  if (!deckId) return
  const s = await suggestDiff(deps, deckId, a.requestText, a.sessionId)
  if (s) await acceptDiff(deps, s.diffId, { remember: false })
}

export async function alternativesFor(deps: Deps, drillId: string): Promise<DrillDraft[]> {
  const [d] = await deps.db.select().from(drills).where(eq(drills.id, drillId))
  if (!d) throw new Error('drill not found')
  const deck = await getDeck(deps.db, d.deckId)
  const ctx = await planningContext(deps, deck.classId, deck.forDate)
  const r = await withRun(deps, { agent: 'planner', trigger: 'alternatives', sessionId: null }, async () => {
    const out = await deps.llm.object({
      name: 'planner.alternatives', instructions: PLANNER_INSTRUCTIONS, schema: Alternatives,
      prompt: `Give exactly 3 alternative drills that serve the same purpose as "${d.name}" (${d.minutes}m, ${d.kind}; why: ${d.rationale}). Vary format: one game, one partner drill, one solo/line drill. Keep the same focusStudentIds: ${JSON.stringify(d.focusStudentIds)}.\n${ctx.text}`,
    })
    return { result: out.alternatives, summary: `3 alternatives for "${d.name}"`, reason: 'instructor asked to swap' }
  })
  if (!r) throw new Error('planner unavailable')
  return r
}

export async function undoDiff(db: Db, diffId: string) {
  await db.update(deckDiffs).set({ status: 'undone' }).where(and(eq(deckDiffs.id, diffId), eq(deckDiffs.status, 'pending')))
}
