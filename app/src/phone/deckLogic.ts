import { MODES, type Deck, type DeckDiff, type DeckPatch, type Drill, type DrillDraft, type ModeId } from '@matside/shared'
import { ApiError } from '../core/api'

/** A drill as edited on the phone: `id` is null until the server assigns one. */
export type Editable = DrillDraft & { id: string | null }

export const MAX_ITEMS = 20
export const MAX_CUES = 2
export const CUE_MAX_CHARS = 40
export const NAME_MAX_CHARS = 40
export const RATIONALE_MAX_CHARS = 160

/** One-tap requests for the planner, per mode. */
export const QUICK_CHIPS: Record<ModeId, readonly string[]> = {
  martial_arts: ['More games', 'Shorter', 'More sparring', 'Low energy day'],
  personal_training: ['More conditioning', 'Shorter', 'Lighter load', 'Recovery day'],
  tutoring: ['More practice', 'Shorter', 'Review basics', 'Test prep'],
}

export const chipsFor = (mode: ModeId): readonly string[] => QUICK_CHIPS[mode] ?? QUICK_CHIPS.martial_arts

const PLURALS: Record<string, string> = { drill: 'drills', exercise: 'exercises', activity: 'activities' }

/** Mode-aware wording: plan title ("Drill deck"), item noun ("drill"), and the people noun for focus pickers. */
export function labelsFor(mode: ModeId) {
  const m = MODES[mode] ?? MODES.martial_arts
  return { planUnit: m.planUnit, item: m.planItem, itemPlural: PLURALS[m.planItem] ?? `${m.planItem}s`, people: m.people }
}

export const toEditable = (x: Drill): Editable => ({
  id: x.id, name: x.name, minutes: x.minutes, kind: x.kind, cues: x.cues, focusStudentIds: x.focusStudentIds, rationale: x.rationale,
})

export const blankItem = (): Editable => ({ id: null, name: '', minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' })

/** Trim, drop empties, and enforce the lens limits (≤2 cues, ≤40 chars each). */
export function clampCues(cues: readonly string[]): string[] {
  return cues.map(c => c.trim().slice(0, CUE_MAX_CHARS)).filter(Boolean).slice(0, MAX_CUES)
}

export const clampMinutes = (n: number): number => (Number.isFinite(n) ? Math.max(1, Math.min(30, Math.round(n))) : 1)

/** Normalise one item so it always satisfies the server's DrillDraft schema. Ids are preserved. */
export function normalizeItem(d: Editable): Editable {
  return {
    ...d,
    name: d.name.trim().slice(0, NAME_MAX_CHARS),
    minutes: clampMinutes(d.minutes),
    cues: clampCues(d.cues),
    rationale: d.rationale.slice(0, RATIONALE_MAX_CHARS),
  }
}

/** Swap item `i` with its neighbour. Returns the same array when the move is out of range. */
export function moveItem<T>(list: readonly T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list]
  const n = [...list]
  ;[n[i], n[j]] = [n[j]!, n[i]!]
  return n
}

export const removeItem = <T,>(list: readonly T[], i: number): T[] => list.filter((_, k) => k !== i)
export const replaceItem = (list: readonly Editable[], i: number, next: Editable): Editable[] => list.map((x, k) => (k === i ? next : x))
export const appendItem = (list: readonly Editable[], next: Editable): Editable[] => [...list, next]

export const canAdd = (n: number): boolean => n < MAX_ITEMS
export const canDelete = (n: number): boolean => n > 1

/** Body for PATCH /v1/decks/:id. Existing ids are kept, new items go up with id null. */
export function buildPatch(list: readonly Editable[]): DeckPatch {
  return { drills: list.map(normalizeItem) }
}

export const totalMinutes = (list: readonly { minutes: number }[]): number => list.reduce((n, d) => n + d.minutes, 0)

/** "40 → 45 min (+5)" or "45 min (no change)". */
export function diffTotalText(before: number, after: number): string {
  const d = after - before
  if (d === 0) return `${after} min (no change)`
  return `${before} → ${after} min (${d > 0 ? '+' : '−'}${Math.abs(d)})`
}

/** "1 added · 2 changed" (zero counts omitted). */
export function diffCountsText(diff: DeckDiff): string {
  const parts = [
    diff.added.length && `${diff.added.length} added`,
    diff.changed.length && `${diff.changed.length} changed`,
    diff.removed.length && `${diff.removed.length} removed`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'no changes'
}

export const nameMap = (deck: Deck): Record<string, string> => Object.fromEntries(deck.drills.map(d => [d.id, d.name]))

export type EditorOutcome = { kind: 'gone'; text: string } | { kind: 'error'; text: string }

/** Maps a failed planner/deck call to user text. 502 = planner (LLM) down; 404/409 = diff or deck already resolved. */
export function deckErrorOutcome(e: unknown, what: 'save' | 'suggest' | 'accept' | 'alternatives'): EditorOutcome {
  if (e instanceof ApiError) {
    if (what === 'accept' && (e.status === 409 || e.status === 404)) return { kind: 'gone', text: 'Already applied — reloaded.' }
    if ((what === 'suggest' || what === 'alternatives') && e.status === 502) return { kind: 'error', text: 'Planner unavailable right now.' }
    if (e.status === 401 || e.status === 403) return { kind: 'error', text: 'Session expired. Re-pair this phone from Today.' }
    if (what === 'save' && e.status === 400) return { kind: 'error', text: 'The server rejected that change. Check the fields and try again.' }
    if (e.status === 404) return { kind: 'error', text: 'This plan no longer exists. Go back to Today.' }
    return { kind: 'error', text: `Request failed (${e.status}). Try again.` }
  }
  return { kind: 'error', text: what === 'save' ? 'Couldn’t save. Check your connection.' : 'No connection. Check your signal and try again.' }
}
