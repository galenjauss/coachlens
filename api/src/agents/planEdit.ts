import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import type { Deck, DrillDraft, ReplaceSource, VoicePlanResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, deckDiffs, decks, drills, sessions } from '../db/schema'
import { addDays, localDate } from '../logic/dates'
import { diffSummary } from '../logic/diffSummary'
import { normalizeDiff, RawDeckDiff } from '../logic/planNormalize'
import { getDeck } from '../services/decks'
import { BudgetExceededError } from './budget'
import { acceptDiff, isStarted, llmDrills, nextDeckFor, planningContext } from './planner'
import { withRun } from './runs'

const draftOf = (d: Deck['drills'][number]): DrillDraft => ({ name: d.name, minutes: d.minutes, kind: d.kind, cues: d.cues, focusStudentIds: d.focusStudentIds, rationale: d.rationale })

/** Drills of another deck, copied as fresh drafts (no ids, no run history). Null when the deck has none. */
async function sourceDrills(deps: Deps, deck: Deck, source: Exclude<ReplaceSource, 'ai'>): Promise<DrillDraft[]> {
  if (source === 'blank') return []
  if (typeof source === 'object') return (await getDeck(deps.db, source.deckId)).drills.map(draftOf)
  const earlier = await deps.db.select({ id: decks.id }).from(decks).where(and(eq(decks.classId, deck.classId), lt(decks.forDate, deck.forDate))).orderBy(desc(decks.forDate))
  for (const e of earlier) {
    const d = (await getDeck(deps.db, e.id)).drills
    if (d.length) return d.map(draftOf)
  }
  throw new Error('previous plan not found')
}

type ReplaceOutcome = 'ok' | 'started' | 'unavailable'

/**
 * Replaces the drills of a not-started deck. New drills are inserted first, then the old ones are removed by a guarded delete
 * (no interactive transactions on neon-http): if the class starts in between, the new drills are removed again and nothing changes.
 * Throws 'class started' (409), 'planner unavailable' (502, ai source when the LLM fails; the plan is kept) or the source's not-found errors.
 */
export async function replaceDeck(deps: Deps, deckId: string, source: ReplaceSource): Promise<Deck> {
  const { db } = deps
  const deck = await getDeck(db, deckId)
  if (await isStarted(db, deckId)) throw new Error('class started')
  const label = typeof source === 'object' ? 'another class’s plan' : source === 'last' ? 'last class' : source === 'ai' ? 'AI draft' : 'blank'
  const copied = source === 'ai' ? null : await sourceDrills(deps, deck, source)
  const out = await withRun<ReplaceOutcome>(deps, { agent: 'planner', trigger: 'replace', sessionId: null }, async () => {
    let next = copied
    if (!next) {
      const ctx = await planningContext(deps, deck.classId, deck.forDate)
      const r = await llmDrills(deps, ctx, deck.forDate)
      if (r.cause) return { result: 'unavailable', status: 'error', summary: 'Planner unavailable — plan kept', reason: r.cause }
      next = r.drills
    }
    if (await isStarted(db, deckId)) return { result: 'started', summary: 'Replace skipped', reason: 'class started', output: null }
    const old = deck.drills.map(d => d.id)
    const added = next.length ? await db.insert(drills).values(next.map((d, i) => ({ ...d, deckId, position: i + 1 }))).returning({ id: drills.id }) : []
    if (old.length) {
      await db.delete(drills).where(and(inArray(drills.id, old), isNull(drills.startedAt), sql`not exists (select 1 from ${sessions} where ${sessions.deckId} = ${deckId})`))
      const [left] = await db.select({ id: drills.id }).from(drills).where(inArray(drills.id, old)).limit(1)
      if (left) {
        if (added.length) await db.delete(drills).where(inArray(drills.id, added.map(a => a.id)))
        return { result: 'started', summary: 'Replace skipped', reason: 'class started', output: null }
      }
    }
    await db.update(decks).set({ isStarter: false }).where(eq(decks.id, deckId))
    return { result: 'ok', summary: `Plan for ${deck.forDate} replaced from ${label}: ${next.length} item${next.length === 1 ? '' : 's'}`, reason: 'instructor chose a starting point', output: { drills: next } }
  })
  if (out === 'started') throw new Error('class started')
  if (out === 'unavailable') throw new Error('planner unavailable')
  if (out !== 'ok') throw new Error('replace failed')
  return getDeck(db, deckId)
}

const VOICE_INSTRUCTIONS = `The coach and an assistant are discussing the upcoming class. Extract the plan changes they intend and make the plan roughly match.
- Only change what they actually decided or asked for; keep everything else as is. Ignore small talk and anything about other topics.
- If no plan change was decided, return empty added, changed and removed lists.
- Use existing drill ids for changed and removed. afterPosition refers to CURRENT positions (0 = before the first).
- rememberSuggestion must be null.`

export class VoicePlanError extends Error {
  constructor(readonly code: 'budget' | 'unavailable' | 'not_found') { super(code) }
}

/** The class's next deck that has not started: today's if its session hasn't started, else the following occurrence. */
async function targetDeck(deps: Deps, classId: string): Promise<string | null> {
  const [c] = await deps.db.select().from(classes).where(eq(classes.id, classId))
  if (!c) throw new VoicePlanError('not_found')
  const first = await nextDeckFor(deps, classId, addDays(localDate(deps.now(), deps.env.timeZone), -1))
  if (!first) return null
  if (!(await isStarted(deps.db, first))) return first
  return nextDeckFor(deps, classId, (await getDeck(deps.db, first)).forDate)
}

/**
 * Voice plan edit: a (possibly multi-speaker) transcript becomes a diff that is applied at once (an explicit command ignores
 * planner autonomy). The diff is stored as accepted with a before-snapshot, so POST /v1/diffs/:id/undo restores the plan.
 */
export async function voicePlan(deps: Deps, classId: string, transcript: string): Promise<VoicePlanResponse> {
  const deckId = await targetDeck(deps, classId)
  if (!deckId) throw new VoicePlanError('unavailable')
  let failure: unknown = null
  const res = await withRun<VoicePlanResponse>(deps, { agent: 'planner', trigger: 'voice_plan', sessionId: null }, async () => {
    try {
      const before = await getDeck(deps.db, deckId)
      const ctx = await planningContext(deps, classId, before.forDate)
      const prompt = [
        `Conversation: """${transcript}"""`,
        `Current deck (position. id | name | minutes | kind):`,
        ...before.drills.map(d => `${d.position}. ${d.id} | ${d.name} | ${d.minutes}m | ${d.kind}`),
        ctx.text,
      ].join('\n')
      const raw = await deps.llm.object({ name: 'planner.voice', instructions: `${ctx.instructions}\n${VOICE_INSTRUCTIONS}`, prompt, schema: RawDeckDiff })
      const diff = { ...normalizeDiff(raw, before.drills.map(d => d.id), ctx.rosterIds), rememberSuggestion: null }
      if (!diff.added.length && !diff.changed.length && !diff.removed.length) {
        return { result: { diffId: null, deckId, lines: ['No plan changes heard'] }, summary: 'Voice plan: no plan changes heard', reason: 'nothing actionable in the conversation', output: diff }
      }
      const snapshot = before.drills.map(d => ({ id: d.id, ...draftOf(d) }))
      const [row] = await deps.db.insert(deckDiffs).values({ deckId, requestText: transcript.slice(0, 500), diff, before: snapshot }).returning()
      const after = await acceptDiff(deps, row!.id, { remember: false })
      const lines = diffSummary(before.drills, after.drills)
      if (!lines.length) lines.push('Plan updated')
      return {
        result: { diffId: row!.id, deckId, lines },
        summary: `Voice plan applied to ${before.forDate}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`,
        reason: 'explicit voice command (ignores planner autonomy)', output: diff, links: { diffId: row!.id },
      }
    } catch (e) { failure = e; throw e }
  })
  if (res) return res
  throw new VoicePlanError(failure instanceof BudgetExceededError ? 'budget' : 'unavailable')
}
