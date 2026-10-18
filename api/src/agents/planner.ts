import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { Alternatives, DeckDiff, DrillDraft, type Deck, type ModeConfig } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { classes, deckDiffs, decks, drills, enrollments, issues, preferences, students } from '../db/schema'
import { applyDiff, totalMinutes } from '../logic/deckDiff'
import { nextDateForWeekday } from '../logic/dates'
import { findDeck, getDeck } from '../services/decks'
import { curriculumFor, modeForClass } from '../services/context'
import { withRun } from './runs'

const AUDIENCE: Record<ModeConfig['id'], string> = {
  martial_arts: "kids' martial arts classes (ages 6-12)",
  personal_training: 'personal training sessions for adult clients',
  tutoring: 'tutoring lessons',
}

const VARY: Record<ModeConfig['id'], string> = {
  martial_arts: 'Vary format: one game, one partner drill, one solo/line drill.',
  personal_training: 'Vary format: one free-weight, one machine or cable, one bodyweight option.',
  tutoring: 'Vary format: one game, one worked example, one independent practice.',
}

/** Planner system prompt for a mode. The plan is a deck of cards (the mode's planUnit) the coach picks from live. */
export function plannerInstructions(mode: ModeConfig): string {
  return `You plan ${AUDIENCE[mode.id]} as a ${mode.planUnit.toUpperCase()}: a deck of ${mode.planItem} cards the coach picks from live.
- Shape: ${mode.planShape}. Use the ${mode.weeklyLabel.toLowerCase()} and the ${mode.itemsDueLabel.toLowerCase()} given.
- kind: pick the closest of warmup, technique, drill, forms, game, sparring for each ${mode.planItem}.
- Target open issues: include ${mode.planItem}s that fix the most common ones and list those ${mode.people} in focusStudentIds (use the provided ids only).
- cues: at most 2 short coaching cues (≤40 chars) the coach will read on smart glasses, e.g. "${mode.cueExamples}".
- rationale: one short sentence on why this ${mode.planItem} is in the plan.
- Respect the coach's remembered preferences.
- Keep names ≤40 chars. ${mode.guardrails}`
}

const DraftOut = z.object({ drills: z.array(DrillDraft).min(5).max(12) }) // tutoring plans are 5-8 items

async function planningContext(deps: Deps, classId: string, forDate: string) {
  const { db } = deps
  const mode = await modeForClass(db, classId)
  const cur = await curriculumFor(db, mode, forDate)
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
    `Mode: ${mode.label} (${mode.planUnit}; each card is a ${mode.planItem})`,
    `${mode.weeklyLabel}: ${cur?.theme ?? 'General skills'}`,
    `${mode.itemsDueLabel}: ${(cur?.formsDue ?? []).join(', ') || 'none'}`,
    `Roster (id: name, ${mode.id === 'martial_arts' ? 'belt' : 'level'}): ${roster.map(r => `${r.id}: ${r.name}, ${r.belt}`).join('; ')}`,
    `Open issues: ${[...byTag].map(([tag, s]) => `${tag} → ${s.map(id => `${nameOf(id)} [${id}]`).join(', ')}`).join(' | ') || 'none'}`,
    `Last class: ${lastDrills.map(d => `${d.name} (${d.startedAt ? 'ran' : 'skipped'})`).join(', ') || 'none'}`,
    `Remembered preferences: ${prefs.map(p => p.text).join(' | ') || 'none'}`,
  ].join('\n')
  return { text, theme: cur?.theme ?? 'General skills', mode, instructions: plannerInstructions(mode) }
}

export async function draftDeck(deps: Deps, classId: string, forDate: string, utteranceId: string | null = null): Promise<string | null> {
  const existing = await findDeck(deps.db, classId, forDate)
  if (existing) {
    const [has] = await deps.db.select({ id: drills.id }).from(drills).where(eq(drills.deckId, existing.id)).limit(1)
    if (has) return existing.id
    await deps.db.delete(decks).where(eq(decks.id, existing.id)) // empty leftover from a failed draft
  }
  return withRun(deps, { agent: 'planner', trigger: 'draft', sessionId: null, utteranceId }, async () => {
    const ctx = await planningContext(deps, classId, forDate)
    const out = await deps.llm.object({ name: 'planner.draft', instructions: ctx.instructions, prompt: `Plan the class on ${forDate}.\n${ctx.text}`, schema: DraftOut })
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
    return { result: deck.id, summary: `Drafted ${forDate} ${ctx.mode.planUnit.toLowerCase()}: ${out.drills.length} ${ctx.mode.planItem}s, ${totalMinutes(out.drills)} min (${ctx.theme})`, reason: 'theme + forms cycle + open issues', output: out }
  })
}

export async function suggestDiff(deps: Deps, deckId: string, requestText: string, sessionId: string | null = null, utteranceId: string | null = null) {
  return withRun(deps, { agent: 'planner', trigger: 'suggest', sessionId, utteranceId }, async () => {
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
    const diff = await deps.llm.object({ name: 'planner.diff', instructions: ctx.instructions, prompt, schema: DeckDiff })
    const [row] = await deps.db.insert(deckDiffs).values({ deckId, requestText, diff }).returning()
    return {
      result: { diffId: row!.id, diff },
      summary: `Suggested changes for ${deck.forDate}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`,
      reason: `"${requestText.slice(0, 80)}"`,
      output: diff,
      links: { diffId: row!.id },
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

export async function nextDeckFor(deps: Deps, classId: string, afterDate: string, utteranceId: string | null = null): Promise<string | null> {
  const [c] = await deps.db.select().from(classes).where(eq(classes.id, classId))
  if (!c) return null
  return draftDeck(deps, classId, nextDateForWeekday(afterDate, c.weekday), utteranceId)
}

export async function autoAdjustNextDeck(deps: Deps, a: { classId: string; afterDate: string; requestText: string; sessionId: string | null; utteranceId?: string | null }) {
  const deckId = await nextDeckFor(deps, a.classId, a.afterDate, a.utteranceId ?? null)
  if (!deckId) return
  const s = await suggestDiff(deps, deckId, a.requestText, a.sessionId, a.utteranceId ?? null)
  if (s) await acceptDiff(deps, s.diffId, { remember: false })
}

export async function alternativesFor(deps: Deps, drillId: string): Promise<DrillDraft[]> {
  const [d] = await deps.db.select().from(drills).where(eq(drills.id, drillId))
  if (!d) throw new Error('drill not found')
  const deck = await getDeck(deps.db, d.deckId)
  const ctx = await planningContext(deps, deck.classId, deck.forDate)
  const r = await withRun(deps, { agent: 'planner', trigger: 'alternatives', sessionId: null }, async () => {
    const out = await deps.llm.object({
      name: 'planner.alternatives', instructions: ctx.instructions, schema: Alternatives,
      prompt: `Give exactly 3 alternative ${ctx.mode.planItem}s that serve the same purpose as "${d.name}" (${d.minutes}m, ${d.kind}; why: ${d.rationale}). ${VARY[ctx.mode.id]} Keep the same focusStudentIds: ${JSON.stringify(d.focusStudentIds)}.\n${ctx.text}`,
    })
    return { result: out.alternatives, summary: `3 alternatives for "${d.name}"`, reason: 'instructor asked to swap' }
  })
  if (!r) throw new Error('planner unavailable')
  return r
}

export async function undoDiff(db: Db, diffId: string) {
  await db.update(deckDiffs).set({ status: 'undone' }).where(and(eq(deckDiffs.id, diffId), eq(deckDiffs.status, 'pending')))
}
