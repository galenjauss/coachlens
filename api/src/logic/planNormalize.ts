// PURE: lenient planner output → valid DrillDraft / DeckDiff / alternatives, plus per-mode starter decks.
// The model fills loose shapes (no length limits) so real output never fails structured parsing;
// these functions enforce the app's limits in code instead.
import { z } from 'zod'
import { DrillKind, type DeckDiff, type DrillDraft, type ModeId } from '@matside/shared'

export const NAME_MAX = 40
export const CUE_MAX = 40
export const MAX_CUES = 2
export const RATIONALE_MAX = 160
export const REASON_MAX = 160
export const STARTER_RATIONALE = 'Starter plan — regenerate when online'

/** Drill-count range per mode (from each mode's planShape, floor 5 so short plans still work). */
export const PLAN_RANGE: Record<ModeId, { min: number; max: number }> = {
  martial_arts: { min: 5, max: 12 },
  personal_training: { min: 5, max: 10 },
  tutoring: { min: 5, max: 8 },
}

const RawDrill = z.object({
  name: z.string(), minutes: z.number(), kind: z.string(), cues: z.array(z.string()),
  focusStudentIds: z.array(z.string()), rationale: z.string(),
})
export type RawDrill = z.infer<typeof RawDrill>
export const RawDraftOut = z.object({ drills: z.array(RawDrill) })
export const RawAlternatives = z.object({ alternatives: z.array(RawDrill) })
export const RawDeckDiff = z.object({
  added: z.array(RawDrill.extend({ afterPosition: z.number(), reason: z.string() })),
  changed: z.array(z.object({ drillId: z.string(), after: RawDrill, reason: z.string() })),
  removed: z.array(z.object({ drillId: z.string(), reason: z.string() })),
  rememberSuggestion: z.string().nullable(),
})

/** Trims, collapses whitespace and cuts to `max` chars with an ellipsis. */
export function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

export function normalizeKind(k: string): DrillKind {
  const parsed = DrillKind.safeParse(k.trim().toLowerCase())
  if (parsed.success) return parsed.data
  const t = k.toLowerCase()
  if (/warm|cool|stretch|bow/.test(t)) return 'warmup'
  if (/game/.test(t)) return 'game'
  if (/spar/.test(t)) return 'sparring'
  if (/form|kata|poomsae/.test(t)) return 'forms'
  if (/tech|concept|explain|lift/.test(t)) return 'technique'
  return 'drill'
}

export const clampMinutes = (m: number): number => (Number.isFinite(m) ? Math.min(30, Math.max(1, Math.round(m))) : 5)

/** One drill, or null when it has no usable name. Unknown focus ids (not on the roster) are dropped. */
export function normalizeDrill(d: RawDrill, rosterIds: ReadonlySet<string>): DrillDraft | null {
  const name = clip(d.name, NAME_MAX)
  if (!name) return null
  return {
    name,
    minutes: clampMinutes(d.minutes),
    kind: normalizeKind(d.kind),
    cues: d.cues.map(c => clip(c, CUE_MAX)).filter(Boolean).slice(0, MAX_CUES),
    focusStudentIds: [...new Set(d.focusStudentIds.filter(id => rosterIds.has(id)))],
    rationale: clip(d.rationale, RATIONALE_MAX),
  }
}

const dk = (n: string) => n.trim().toLowerCase()

/** Pads `items` with starter drills (skipping names already used) until it has `n`. */
function padFromStarter(items: DrillDraft[], mode: ModeId, n: number): DrillDraft[] {
  const out = [...items]
  for (const s of starterDeck(mode)) {
    if (out.length >= n) break
    if (!out.some(d => dk(d.name) === dk(s.name))) out.push(s)
  }
  return out
}

/** Whole deck: normalized drills, trimmed to the mode's max and padded from the starter deck to its min. */
export function normalizeDeck(raw: readonly RawDrill[], mode: ModeId, rosterIds: ReadonlySet<string>): DrillDraft[] {
  const { min, max } = PLAN_RANGE[mode]
  const drills = raw.map(d => normalizeDrill(d, rosterIds)).filter((d): d is DrillDraft => d !== null).slice(0, max)
  return drills.length >= min ? drills : padFromStarter(drills, mode, min)
}

/** Exactly 3 alternatives (padded from the starter deck when the model returns fewer). */
export function normalizeAlternatives(raw: readonly RawDrill[], mode: ModeId, rosterIds: ReadonlySet<string>, exclude = ''): DrillDraft[] {
  const alts = raw.map(d => normalizeDrill(d, rosterIds)).filter((d): d is DrillDraft => d !== null).slice(0, 3)
  if (alts.length >= 3) return alts
  return padFromStarter(alts, mode, 3 + (exclude ? 1 : 0)).filter(d => dk(d.name) !== dk(exclude)).slice(0, 3)
}

/** A valid DeckDiff: unknown drill ids and nameless drills are dropped, positions clamped. */
export function normalizeDiff(raw: z.infer<typeof RawDeckDiff>, deckDrillIds: readonly string[], rosterIds: ReadonlySet<string>): DeckDiff {
  const known = new Set(deckDrillIds)
  const reason = (r: string) => clip(r, REASON_MAX)
  const added = raw.added.flatMap(a => {
    const d = normalizeDrill(a, rosterIds)
    if (!d) return []
    const pos = Number.isFinite(a.afterPosition) ? Math.min(deckDrillIds.length, Math.max(0, Math.round(a.afterPosition))) : deckDrillIds.length
    return [{ ...d, afterPosition: pos, reason: reason(a.reason) }]
  })
  const changed = raw.changed.flatMap(c => {
    const d = known.has(c.drillId) ? normalizeDrill(c.after, rosterIds) : null
    return d ? [{ drillId: c.drillId, after: d, reason: reason(c.reason) }] : []
  })
  const removedIds = new Set<string>()
  const removed = raw.removed.flatMap(r => (known.has(r.drillId) && !removedIds.has(r.drillId) && removedIds.add(r.drillId) ? [{ drillId: r.drillId, reason: reason(r.reason) }] : []))
  const remember = raw.rememberSuggestion ? clip(raw.rememberSuggestion, 200) : ''
  return { added, changed: changed.filter(c => !removedIds.has(c.drillId)), removed, rememberSuggestion: remember || null }
}

const s = (name: string, minutes: number, kind: DrillKind, cues: string[]): DrillDraft =>
  ({ name, minutes, kind, cues, focusStudentIds: [], rationale: STARTER_RATIONALE })

const STARTERS: Record<ModeId, DrillDraft[]> = {
  martial_arts: [
    s('Warm-up: jog & dynamic stretch', 5, 'warmup', ['big arm circles', 'stay in your lane']),
    s('Stance holds', 4, 'technique', ['knees out', 'back tall']),
    s('Technique of the week', 8, 'technique', ['slow first', 'then sharp']),
    s('Partner pad drill', 7, 'drill', ['hands up', 'chamber first']),
    s('Forms practice', 8, 'forms', ['count out loud', 'eyes forward']),
    s('Game: sharks & minnows', 6, 'game', ['stances when tagged']),
    s('Line kicks', 5, 'drill', ['pivot the base foot']),
    s('Bow-out & reflection', 2, 'warmup', ['one thing you improved']),
  ],
  personal_training: [
    s('Warm-up: mobility flow', 6, 'warmup', ['breathe slow', 'full range']),
    s('Main lift: squat 4×6', 12, 'technique', ['chest up', 'drive through heels']),
    s('Main lift: row 4×8', 10, 'technique', ['squeeze shoulder blades']),
    s('Accessory: split squat 3×10', 8, 'drill', ['knee over toes', 'tall torso']),
    s('Accessory: plank 3×40s', 5, 'drill', ['ribs down', 'squeeze glutes']),
    s('Finisher: bike intervals', 6, 'game', ['hard 20s / easy 40s']),
    s('Cool-down stretch', 5, 'warmup', ['slow breaths']),
  ],
  tutoring: [
    s('Warm-up problem', 5, 'warmup', ['show your steps']),
    s('Concept explanation', 10, 'technique', ['check for questions']),
    s('Worked example', 8, 'technique', ['think out loud']),
    s('Guided practice', 12, 'drill', ['one hint at a time']),
    s('Independent practice', 12, 'drill', ['try before asking']),
    s('Review game', 6, 'game', ['quick recall']),
    s('Exit ticket', 5, 'warmup', ['one question, no help']),
  ],
}

/** Deterministic starter deck for a mode (used when the planner can't answer). */
export function starterDeck(mode: ModeId): DrillDraft[] {
  return STARTERS[mode].map(d => ({ ...d, cues: [...d.cues], focusStudentIds: [] }))
}
