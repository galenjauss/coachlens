import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from '../http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { createApp } from '../app'
import { agentRuns, classes, decks, drills, enrollments, instructors, sessions, students } from '../db/schema'
import { BudgetExceededError } from './budget'
import { alternativesFor, draftDeck, suggestDiff } from './planner'
import type { Llm } from '../deps'
import {
  clip, normalizeAlternatives, normalizeDrill, normalizeDeck, normalizeDiff, normalizeKind, PLAN_RANGE, STARTER_RATIONALE, starterDeck, type RawDrill,
} from '../logic/planNormalize'

const LONG = 'Super extra long drill name that goes way past eighty characters for sure because we keep adding more and more words'
const raw = (name: string, over: Partial<RawDrill> = {}): RawDrill => ({
  name, minutes: 5, kind: 'drill', cues: ['a'], focusStudentIds: [], rationale: 'why', ...over,
})

/** draftDeck, then waits for the background re-draft it may have deferred. */
async function heal(deps: ReturnType<typeof makeDeps>, classId: string) {
  const id = await draftDeck(deps, classId, '2026-10-19')
  await deps.flush()
  return id
}

async function world(mode: 'martial_arts' | 'tutoring' = 'martial_arts') {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'New class', weekday: 1, startTime: '17:00', mode }).returning()
  const [st] = await db.insert(students).values({ name: 'Priya Rao', belt: 'new', birthYear: 2026 }).returning()
  await db.insert(enrollments).values({ classId: c!.id, studentId: st!.id })
  return { db, classId: c!.id, priyaId: st!.id }
}

describe('planNormalize (pure)', () => {
  it('keeps a 45-char name intact; clips a 100-char name at a word boundary with an ellipsis; cues likewise', () => {
    const mid = 'Warm-up: solve one-step equations quickly'.padEnd(45, 'x')
    const hundred = Array.from({ length: 12 }, () => 'wordy-word').join(' ').slice(0, 100)
    const d = normalizeDrill(raw(mid, { cues: [hundred, 'short cue'] }), new Set())!
    expect(d.name).toBe(mid)
    expect(d.cues[0]!.length).toBeLessThanOrEqual(90)
    expect(d.cues[0]!.endsWith('wordy-word…')).toBe(true)
    expect(d.cues[1]).toBe('short cue')
    const n = normalizeDrill(raw(hundred), new Set())!
    expect(n.name.length).toBeLessThanOrEqual(80)
    expect(n.name.endsWith('wordy-word…')).toBe(true)
  })

  it('clips with an ellipsis and maps unknown kinds', () => {
    expect(clip(LONG, 40).length).toBeLessThanOrEqual(40)
    expect(clip(LONG, 40)).toBe('Super extra long drill name that goes…')
    expect(clip('  short  ', 40)).toBe('short')
    expect(normalizeKind('Warm-up')).toBe('warmup')
    expect(normalizeKind('Kata review')).toBe('forms')
    expect(normalizeKind('SPARRING')).toBe('sparring')
    expect(normalizeKind('whatever')).toBe('drill')
  })
  it('normalizes a messy deck: names, cues, minutes, focus ids, count', () => {
    const messy = Array.from({ length: 14 }, (_, i) => raw(i === 0 ? LONG : `Drill ${i}`, {
      minutes: i === 0 ? 45 : i === 1 ? 0.2 : 6.6,
      cues: ['one cue that is far too long to read on the glasses display and then keeps going on and on and on past ninety chars', 'two', 'three'],
      focusStudentIds: ['known', 'ghost'],
      rationale: 'r'.repeat(300),
    }))
    const deck = normalizeDeck(messy, 'martial_arts', new Set(['known']))
    expect(deck).toHaveLength(PLAN_RANGE.martial_arts.max)
    expect(deck[0]!.name.length).toBeLessThanOrEqual(80)
    expect(deck[0]!.minutes).toBe(30)
    expect(deck[1]!.minutes).toBe(1)
    expect(deck[2]!.minutes).toBe(7)
    expect(deck[0]!.cues).toHaveLength(2)
    expect(deck[0]!.cues[0]!.length).toBeLessThanOrEqual(90)
    expect(deck[0]!.focusStudentIds).toEqual(['known'])
    expect(deck[0]!.rationale.length).toBeLessThanOrEqual(240)
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
      expect(deck.every(d => d.name.length <= 80 && d.cues.length <= 2 && d.minutes >= 1 && d.minutes <= 30)).toBe(true)
    }
  })
})

describe('planner with real-world output', () => {
  beforeEach(() => resetRateLimits())

  it('saves a normalized deck from over-long output (45 min, 14 drills, long cues, ghost ids)', async () => {
    const { db, classId, priyaId } = await world()
    const llm = fakeLlm(() => ({
      drills: Array.from({ length: 14 }, (_, i) => raw(i === 0 ? LONG : `Drill ${i}`, {
        minutes: 45, cues: ['a cue that is much longer than ninety characters in total so it must get clipped at a word boundary okay', 'b', 'c'], focusStudentIds: [priyaId, 'ghost'], rationale: 'z'.repeat(400),
      })),
    }))
    const deps = makeDeps(db, { llm })
    const deckId = await draftDeck(deps, classId, '2026-10-19')
    expect(deckId).toBeTruthy()
    const saved = await db.select().from(drills).where(eq(drills.deckId, deckId!))
    expect(saved).toHaveLength(12)
    expect(saved.every(d => d.name.length <= 80 && d.minutes === 30 && d.cues.length === 2 && d.rationale.length <= 240)).toBe(true)
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
      expect(run!.status).toBe('error')
      expect(run!.summary).toBe('Planner unavailable — starter plan used')
      expect(run!.reason).toBe(label === 'budget exceeded' ? 'daily AI budget reached' : run!.reason)
      const [deck] = await db.select().from(decks)
      expect(deck!.isStarter).toBe(true)
      expect((today as unknown as { deck: { isStarter: boolean } }).deck.isStarter).toBe(true)
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
    expect(s!.diff.added[0]!.name.length).toBeLessThanOrEqual(80)
    expect(s!.diff.changed).toEqual([])
    const [first] = await db.select().from(drills).where(eq(drills.deckId, deckId!))
    const alts = await alternativesFor(deps, first!.id)
    expect(alts).toHaveLength(3)
    expect(alts[1]!.cues).toHaveLength(2)
    expect(call).toBe(3)
  })

  describe('starter deck self-heal', () => {
    const T0 = new Date('2026-10-20T00:30:00Z')
    const at = (min: number) => () => new Date(T0.getTime() + min * 60_000)
    const good = () => ({ drills: Array.from({ length: 6 }, (_, i) => raw(`Real ${i}`)) })

    async function starterWorld() {
      const w = await world('tutoring')
      let calls = 0
      const llm = fakeLlm(() => { calls++; if (calls === 1) throw new BudgetExceededError(); return good() })
      const first = makeDeps(w.db, { llm, now: at(0) })
      const deckId = (await draftDeck(first, w.classId, '2026-10-19'))!
      return { ...w, deckId, llm, calls: () => calls }
    }

    it('budget exceeded: starter + error run + is_starter; later call after cooldown re-drafts and clears the flag', async () => {
      const w = await starterWorld()
      const [run] = await w.db.select().from(agentRuns)
      expect(run).toMatchObject({ status: 'error', summary: 'Planner unavailable — starter plan used', reason: 'daily AI budget reached' })
      expect((await w.db.select().from(decks))[0]!.isStarter).toBe(true)

      await heal(makeDeps(w.db, { llm: w.llm, now: at(11) }), w.classId)
      const [deck] = await w.db.select().from(decks)
      expect(deck!.isStarter).toBe(false)
      const rows = await w.db.select().from(drills).where(eq(drills.deckId, w.deckId))
      expect(rows.map(d => d.name).sort()).toEqual(Array.from({ length: 6 }, (_, i) => `Real ${i}`))
      expect((await w.db.select().from(agentRuns)).map(r => r.trigger)).toEqual(['draft', 'redraft'])
    })

    it('within 10 minutes of the last attempt there is no LLM call', async () => {
      const w = await starterWorld()
      expect(w.calls()).toBe(1)
      await heal(makeDeps(w.db, { llm: w.llm, now: at(5) }), w.classId)
      await heal(makeDeps(w.db, { llm: w.llm, now: at(9) }), w.classId)
      expect(w.calls()).toBe(1)
      expect((await w.db.select().from(decks))[0]!.isStarter).toBe(true)
    })

    it('a failed re-draft keeps the starter deck, logs again, and is throttled', async () => {
      const w = await starterWorld()
      const failing = fakeLlm(() => { throw new Error('provider down') })
      await heal(makeDeps(w.db, { llm: failing, now: at(11) }), w.classId)
      const runs = await w.db.select().from(agentRuns)
      expect(runs).toHaveLength(2)
      expect(runs[1]).toMatchObject({ status: 'error', reason: 'provider down' })
      expect((await w.db.select().from(decks))[0]!.isStarter).toBe(true)
      expect(await w.db.select().from(drills).where(eq(drills.deckId, w.deckId))).toHaveLength(starterDeck('tutoring').length)
      await heal(makeDeps(w.db, { llm: w.llm, now: at(15) }), w.classId)
      expect(w.calls()).toBe(1)
    })

    it('never replaces a starter deck whose session has started', async () => {
      const w = await starterWorld()
      await w.db.insert(sessions).values({ classId: w.classId, deckId: w.deckId, forDate: '2026-10-19', startedAt: T0 })
      await heal(makeDeps(w.db, { llm: w.llm, now: at(60) }), w.classId)
      expect(w.calls()).toBe(1)
      expect((await w.db.select().from(decks))[0]!.isStarter).toBe(true)
    })

    it('does not block draftDeck, and a class that starts during the slow re-draft keeps its drills', async () => {
      const w = await starterWorld()
      let release!: () => void
      const gate = new Promise<void>(r => { release = r })
      const slow = fakeLlm(async () => { await gate; return good() }) as unknown as Llm
      const llm: Llm = { object: async a => { await gate; return slow.object(a) } }
      const deps = makeDeps(w.db, { llm, now: at(11) })
      await draftDeck(deps, w.classId, '2026-10-19') // returns while the re-draft is pending
      await new Promise(r => setTimeout(r, 50))
      await w.db.insert(sessions).values({ classId: w.classId, deckId: w.deckId, forDate: '2026-10-19', startedAt: at(11)() })
      release()
      await deps.flush()
      const rows = await w.db.select().from(drills).where(eq(drills.deckId, w.deckId))
      expect(rows.map(d => d.name).sort()).toEqual(starterDeck('tutoring').map(d => d.name).sort())
      expect((await w.db.select().from(decks))[0]!.isStarter).toBe(true)
      const runs = await w.db.select().from(agentRuns)
      expect(runs.at(-1)).toMatchObject({ trigger: 'redraft', reason: 'class started' })
    })

    it('waits until the deck is 2 minutes old (young deck, never attempted)', async () => {
      const w = await world('tutoring')
      const [deck] = await w.db.insert(decks).values({ classId: w.classId, forDate: '2026-10-19', isStarter: true, createdAt: T0 }).returning()
      await w.db.insert(drills).values(starterDeck('tutoring').map((d, i) => ({ ...d, deckId: deck!.id, position: i + 1 })))
      let calls = 0
      const llm = fakeLlm(() => { calls++; return good() })
      await heal(makeDeps(w.db, { llm, now: at(1) }), w.classId)
      expect(calls).toBe(0)
      await heal(makeDeps(w.db, { llm, now: at(3) }), w.classId)
      expect(calls).toBe(1)
    })
  })

  it('re-drafts a never-attempted deck with a clipped ("…") name exactly once, even though it is not a starter deck', async () => {
    const w = await world('tutoring')
    const T0 = new Date('2026-10-20T00:30:00Z')
    const [deck] = await w.db.insert(decks).values({ classId: w.classId, forDate: '2026-10-19', createdAt: T0 }).returning()
    await w.db.insert(drills).values(starterDeck('tutoring').map((d, i) => ({ ...d, name: i === 0 ? 'Warm-up: Solve one-step equat…' : d.name, deckId: deck!.id, position: i + 1 })))
    let calls = 0
    const llm = fakeLlm(() => { calls++; return { drills: Array.from({ length: 6 }, (_, i) => raw(`Fresh ${i}`)) } })
    const later = (m: number) => () => new Date(T0.getTime() + m * 60_000)
    await heal(makeDeps(w.db, { llm, now: later(5) }), w.classId)
    await heal(makeDeps(w.db, { llm, now: later(30) }), w.classId)
    expect(calls).toBe(1)
    expect((await w.db.select().from(drills).where(eq(drills.deckId, deck!.id))).map(d => d.name).sort()[0]).toBe('Fresh 0')
  })
})
