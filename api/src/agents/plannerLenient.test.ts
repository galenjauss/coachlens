import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from '../http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { createApp } from '../app'
import { agentRuns, classes, decks, drills, enrollments, instructors, students } from '../db/schema'
import { BudgetExceededError } from './budget'
import { alternativesFor, draftDeck, suggestDiff } from './planner'
import type { Llm } from '../deps'
import {
  clip, normalizeAlternatives, normalizeDeck, normalizeDiff, normalizeKind, PLAN_RANGE, STARTER_RATIONALE, starterDeck, type RawDrill,
} from '../logic/planNormalize'

const LONG = 'Super extra long drill name that goes way past forty characters for sure'
const raw = (name: string, over: Partial<RawDrill> = {}): RawDrill => ({
  name, minutes: 5, kind: 'drill', cues: ['a'], focusStudentIds: [], rationale: 'why', ...over,
})

async function world(mode: 'martial_arts' | 'tutoring' = 'martial_arts') {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'New class', weekday: 1, startTime: '17:00', mode }).returning()
  const [st] = await db.insert(students).values({ name: 'Priya Rao', belt: 'new', birthYear: 2026 }).returning()
  await db.insert(enrollments).values({ classId: c!.id, studentId: st!.id })
  return { db, classId: c!.id, priyaId: st!.id }
}

describe('planNormalize (pure)', () => {
  it('clips with an ellipsis and maps unknown kinds', () => {
    expect(clip(LONG, 40)).toHaveLength(40)
    expect(clip(LONG, 40).endsWith('…')).toBe(true)
    expect(clip('  short  ', 40)).toBe('short')
    expect(normalizeKind('Warm-up')).toBe('warmup')
    expect(normalizeKind('Kata review')).toBe('forms')
    expect(normalizeKind('SPARRING')).toBe('sparring')
    expect(normalizeKind('whatever')).toBe('drill')
  })
  it('normalizes a messy deck: names, cues, minutes, focus ids, count', () => {
    const messy = Array.from({ length: 14 }, (_, i) => raw(i === 0 ? LONG : `Drill ${i}`, {
      minutes: i === 0 ? 45 : i === 1 ? 0.2 : 6.6,
      cues: ['one cue that is far too long to read on the glasses display', 'two', 'three'],
      focusStudentIds: ['known', 'ghost'],
      rationale: 'r'.repeat(300),
    }))
    const deck = normalizeDeck(messy, 'martial_arts', new Set(['known']))
    expect(deck).toHaveLength(PLAN_RANGE.martial_arts.max)
    expect(deck[0]!.name.length).toBeLessThanOrEqual(40)
    expect(deck[0]!.minutes).toBe(30)
    expect(deck[1]!.minutes).toBe(1)
    expect(deck[2]!.minutes).toBe(7)
    expect(deck[0]!.cues).toHaveLength(2)
    expect(deck[0]!.cues[0]!.length).toBeLessThanOrEqual(40)
    expect(deck[0]!.focusStudentIds).toEqual(['known'])
    expect(deck[0]!.rationale.length).toBeLessThanOrEqual(160)
  })
  it('pads short decks from the starter deck and trims to the mode max', () => {
    const short = normalizeDeck([raw('Only one'), raw('   ')], 'tutoring', new Set())
    expect(short).toHaveLength(PLAN_RANGE.tutoring.min)
    expect(short[0]!.name).toBe('Only one')
    expect(short[1]!.rationale).toBe(STARTER_RATIONALE)
    expect(normalizeDeck(Array.from({ length: 20 }, (_, i) => raw(`D${i}`)), 'tutoring', new Set())).toHaveLength(8)
  })
  it('alternatives are always exactly 3, never the drill being replaced', () => {
    expect(normalizeAlternatives([raw('A'), raw('B'), raw('C'), raw('D')], 'martial_arts', new Set())).toHaveLength(3)
    const padded = normalizeAlternatives([raw('A')], 'martial_arts', new Set(), 'Stance holds')
    expect(padded).toHaveLength(3)
    expect(padded.map(d => d.name)).not.toContain('Stance holds')
  })
  it('diff: drops unknown drill ids, clamps positions, nulls empty remember', () => {
    const d = normalizeDiff({
      added: [{ ...raw(LONG), afterPosition: 99, reason: 'x' }, { ...raw(' '), afterPosition: 1, reason: 'y' }],
      changed: [{ drillId: 'd1', after: raw('Better', { minutes: 50 }), reason: 'r' }, { drillId: 'ghost', after: raw('X'), reason: 'r' }],
      removed: [{ drillId: 'd2', reason: 'r' }, { drillId: 'd2', reason: 'again' }, { drillId: 'nope', reason: 'r' }],
      rememberSuggestion: '  ',
    }, ['d1', 'd2', 'd3'], new Set())
    expect(d.added).toHaveLength(1)
    expect(d.added[0]!.afterPosition).toBe(3)
    expect(d.changed).toEqual([{ drillId: 'd1', after: expect.objectContaining({ name: 'Better', minutes: 30 }), reason: 'r' }])
    expect(d.removed).toEqual([{ drillId: 'd2', reason: 'r' }])
    expect(d.rememberSuggestion).toBeNull()
  })
  it('every mode has a valid starter deck within its range', () => {
    for (const m of ['martial_arts', 'personal_training', 'tutoring'] as const) {
      const deck = starterDeck(m)
      expect(deck.length).toBeGreaterThanOrEqual(PLAN_RANGE[m].min)
      expect(deck.length).toBeLessThanOrEqual(PLAN_RANGE[m].max)
      expect(deck.every(d => d.name.length <= 40 && d.cues.length <= 2 && d.minutes >= 1 && d.minutes <= 30)).toBe(true)
    }
  })
})

describe('planner with real-world output', () => {
  beforeEach(() => resetRateLimits())

  it('saves a normalized deck from over-long output (45 min, 14 drills, long cues, ghost ids)', async () => {
    const { db, classId, priyaId } = await world()
    const llm = fakeLlm(() => ({
      drills: Array.from({ length: 14 }, (_, i) => raw(i === 0 ? LONG : `Drill ${i}`, {
        minutes: 45, cues: ['a cue that is much longer than forty characters total', 'b', 'c'], focusStudentIds: [priyaId, 'ghost'], rationale: 'z'.repeat(400),
      })),
    }))
    const deps = makeDeps(db, { llm })
    const deckId = await draftDeck(deps, classId, '2026-10-19')
    expect(deckId).toBeTruthy()
    const saved = await db.select().from(drills).where(eq(drills.deckId, deckId!))
    expect(saved).toHaveLength(12)
    expect(saved.every(d => d.name.length <= 40 && d.minutes === 30 && d.cues.length === 2 && d.rationale.length <= 160)).toBe(true)
    expect(saved[0]!.focusStudentIds).toEqual([priyaId])
    const [run] = await db.select().from(agentRuns)
    expect(run).toMatchObject({ agent: 'planner', status: 'ok', reason: 'theme + forms cycle + open issues' })
  })

  for (const [label, llm] of [
    ['throws', fakeLlm(() => { throw new Error('No object generated: response did not match schema.') })],
    ['budget exceeded', fakeLlm(() => { throw new BudgetExceededError() })],
    ['returns garbage', fakeLlm(() => ({ nope: 1 }))],
  ] as [string, Llm][]) {
    it(`falls back to the starter deck when the model ${label}, and Today still returns 200`, async () => {
      const { db, classId } = await world('tutoring')
      const deps = makeDeps(db, { llm })
      const app = createApp(deps)
      const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
      const { token } = (await pair.json()) as { token: string }
      const r = await app.request(`/v1/today?classId=${classId}`, { headers: { Authorization: `Bearer ${token}` } })
      expect(r.status).toBe(200)
      const today = await r.json() as { deck: { drills: { name: string; rationale: string }[] } }
      expect(today.deck.drills.map(d => d.name)).toEqual(starterDeck('tutoring').map(d => d.name))
      expect(today.deck.drills.every(d => d.rationale === STARTER_RATIONALE)).toBe(true)
      const [run] = await db.select().from(agentRuns)
      expect(run!.status).toBe('ok')
      expect(run!.reason).toMatch(/^fell back to starter deck/)
      expect(await db.select().from(decks)).toHaveLength(1)
    })
  }

  it('suggest and alternatives accept loose output and normalize it', async () => {
    const { db, classId } = await world()
    let call = 0
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name }) => {
        call++
        if (name === 'planner.draft') return { drills: Array.from({ length: 8 }, (_, i) => raw(`Drill ${i}`)) }
        if (name === 'planner.diff') return { added: [{ ...raw(LONG, { minutes: 90 }), afterPosition: -3, reason: 'more' }], changed: [{ drillId: 'ghost', after: raw('X'), reason: 'r' }], removed: [], rememberSuggestion: null }
        return { alternatives: [raw(LONG), raw('Alt two', { cues: ['1', '2', '3', '4'] })] }
      }),
    })
    const deckId = await draftDeck(deps, classId, '2026-10-19')
    const s = await suggestDiff(deps, deckId!, 'longer')
    expect(s!.diff.added[0]).toMatchObject({ afterPosition: 0, minutes: 30 })
    expect(s!.diff.added[0]!.name.length).toBeLessThanOrEqual(40)
    expect(s!.diff.changed).toEqual([])
    const [first] = await db.select().from(drills).where(eq(drills.deckId, deckId!))
    const alts = await alternativesFor(deps, first!.id)
    expect(alts).toHaveLength(3)
    expect(alts[1]!.cues).toHaveLength(2)
    expect(call).toBe(3)
  })
})
