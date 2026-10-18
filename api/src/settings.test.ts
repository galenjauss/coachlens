import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { MAX_VOCAB } from '@matside/shared'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { instructors, agentRuns, classes, curriculum, decks, drills, enrollments, guardians, outbox, sessions, students, deckDiffs } from './db/schema'
import { getAutonomy, patchSettings } from './services/settings'
import { addVocab, capHints, vocabHints, MAX_HINT_CHARS } from './services/vocab'
import { draftParentEmail } from './agents/parentEmail'
import { autoAdjustNextDeck } from './agents/planner'
import { routerInstructions } from './agents/router'
import { handleUtterance } from './services/utterance'
import { MODES } from '@matside/shared'
import { buildCardLines } from './logic/cardLines'
import { specificDrillNames } from './services/vocab'

beforeEach(() => resetRateLimits())

async function pairToken(app: ReturnType<typeof createApp>, db: Awaited<ReturnType<typeof makeTestDb>>) {
  await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' })
  const r = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  return ((await r.json()) as { token: string }).token
}

const EMAIL = { subject: 'Priya update', body: 'Hi Anita, Priya worked hard on her guard today and we are going to keep building on it next week.' }
const drill = (n: string) => ({ name: n, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: 'r' })

async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
  await db.insert(guardians).values({ studentId: s!.id, name: 'Anita Rao', email: 'anita@example.com' })
  await db.insert(enrollments).values({ classId: c!.id, studentId: s!.id })
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: [] })
  return { db, classId: c!.id, studentId: s!.id }
}

describe('settings service', () => {
  it('defaults: missing rows give each task its default, including insights = review', async () => {
    const db = await makeTestDb()
    const expected = { parent_email: 'review', report_card: 'review', planner: 'review', billing: 'auto', progress: 'auto', attendance: 'auto', insights: 'review' }
    for (const [t, v] of Object.entries(expected)) expect(await getAutonomy(db, t as never)).toBe(v)
    const app = createApp(makeDeps(db))
    const token = await pairToken(app, db)
    const r = await app.request('/v1/settings', { headers: { Authorization: `Bearer ${token}` } })
    expect(await r.json()).toEqual({ autonomy: expected, vocabulary: [] })
  })

  it('PATCH stores partial changes and rejects disallowed values with 400 (nothing written)', async () => {
    resetRateLimits()
    const db = await makeTestDb()
    const app = createApp(makeDeps(db))
    const token = await pairToken(app, db)
    const patch = (body: unknown) => app.request('/v1/settings', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const ok = await patch({ autonomy: { parent_email: 'auto' } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { autonomy: Record<string, string> }).autonomy).toMatchObject({ parent_email: 'auto', planner: 'review' })
    expect((await patch({ autonomy: { report_card: 'auto' } })).status).toBe(400)
    expect((await patch({ autonomy: { billing: 'review' } })).status).toBe(400)
    expect((await patch({ autonomy: { progress: 'review', planner: 'off' } })).status).toBe(400) // all-or-nothing
    expect((await patch({ autonomy: { bogus: 'auto' } })).status).toBe(400)
    expect((await patch({ vocabulary: ['x'.repeat(41)] })).status).toBe(400)
    expect(await getAutonomy(db, 'planner')).toBe('review')
    expect(await getAutonomy(db, 'parent_email')).toBe('auto')
  })
})

describe('vocabulary', () => {
  it('PATCH replaces the list, deduping case-insensitively; caps at 200 (400 above)', async () => {
    const db = await makeTestDb()
    await patchSettings(db, { vocabulary: ['Mawashi', 'mawashi ', 'Kata Ni', 'KATA NI'] })
    expect(await vocabHints(db)).toEqual(['Mawashi', 'Kata Ni'])
    await patchSettings(db, { vocabulary: ['Kata Ni'] })
    expect(await vocabHints(db)).toEqual(['Kata Ni'])
    resetRateLimits()
    const app = createApp(makeDeps(db))
    const token = await pairToken(app, db)
    const tooMany = Array.from({ length: MAX_VOCAB + 1 }, (_, i) => `term${i}`)
    const r = await app.request('/v1/settings', { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ vocabulary: tooMany }) })
    expect(r.status).toBe(400)
  })

  it('addVocab dedupes, respects the 200 cap and the 40 char limit', async () => {
    const db = await makeTestDb()
    expect(await addVocab(db, ['Kata 1', 'kata 1', 'y'.repeat(41), 'Bo staff'])).toBe(2)
    await addVocab(db, Array.from({ length: 300 }, (_, i) => `t${i}`))
    expect(await vocabHints(db)).toHaveLength(MAX_VOCAB)
    expect(await addVocab(db, ['one more'])).toBe(0)
  })

  it('capHints keeps priority order, dedupes and stays within the character budget', () => {
    const out = capHints(['Priya', 'priya', 'Leo', ...Array.from({ length: 500 }, (_, i) => `drillname${i}`)])
    expect(out.slice(0, 2)).toEqual(['Priya', 'Leo'])
    expect(out.join(', ').length).toBeLessThanOrEqual(MAX_HINT_CHARS)
    expect(out.length).toBeLessThan(500)
  })

  it('STT hints = roster + vocabulary + deck drills; router instructions get a Known terms line', async () => {
    const { db, classId } = await world()
    await addVocab(db, ['Mawashi'])
    const [d] = await db.insert(decks).values({ classId, forDate: '2026-10-19', status: 'active' }).returning()
    await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' })
    const [se] = await db.insert(sessions).values({ classId, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
    let hints: string[] = []
    let instructions = ''
    const deps = makeDeps(db, { stt: { async transcribe(_w, h) { hints = h; return 'Priya nice mawashi' } }, llm: fakeLlm(a => { instructions = a.instructions; return { intents: [] } }) })
    const app = createApp(deps)
    const token = await pairToken(app, db)
    const form = new FormData()
    form.set('sessionId', se!.id); form.set('mode', 'note'); form.set('audio', new File([new Uint8Array(10)], 'a.wav', { type: 'audio/wav' }))
    const r = await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    expect(r.status).toBe(200)
    expect(hints).toEqual(['Priya Rao', 'Mawashi', 'Guard-up jab'])
    expect(instructions).toContain('Known terms')
    expect(instructions).toContain('Mawashi')
    expect(routerInstructions(MODES.martial_arts)).not.toContain('Known terms')
  })
})

describe('parent_email autonomy', () => {
  it('off: no draft, no LLM call, logs "skipped (off)"', async () => {
    const { db, studentId } = await world()
    await patchSettings(db, { autonomy: { parent_email: 'off' } })
    const deps = makeDeps(db) // llm throws if called
    expect(await draftParentEmail(deps, { studentId, sessionId: null, trigger: { kind: 'request', content: 'tell mom' } })).toBeNull()
    expect(await db.select().from(outbox)).toHaveLength(0)
    const [run] = await db.select().from(agentRuns)
    expect(run!.summary).toContain('skipped (off)')
    expect(run!.status).toBe('ok')
  })

  it('auto: sends via the approve path, honoring DEMO_EMAIL_OVERRIDE', async () => {
    const { db, studentId } = await world()
    await patchSettings(db, { autonomy: { parent_email: 'auto' } })
    const deps = makeDeps(db, { llm: fakeLlm(() => EMAIL) })
    deps.env.demoEmailOverride = 'me@example.com'
    const id = await draftParentEmail(deps, { studentId, sessionId: null, trigger: { kind: 'request', content: 'tell mom' } })
    expect(deps.sent).toHaveLength(1)
    expect(deps.sent[0]).toMatchObject({ to: 'me@example.com', subject: EMAIL.subject })
    const [row] = await db.select().from(outbox).where(eq(outbox.id, id!))
    expect(row!.status).toBe('sent')
    const runs = await db.select().from(agentRuns)
    expect(runs.find(r => r.agent === 'parent_email')!.reason).toContain('autonomy: auto')
    expect(runs.find(r => r.agent === 'parent_email')!.summary).toContain('and sent')
  })

  it('review (default): drafts and waits, nothing sent', async () => {
    const { db, studentId } = await world()
    const deps = makeDeps(db, { llm: fakeLlm(() => EMAIL) })
    const id = await draftParentEmail(deps, { studentId, sessionId: null, trigger: { kind: 'request', content: 'tell mom' } })
    expect(deps.sent).toHaveLength(0)
    expect((await db.select().from(outbox).where(eq(outbox.id, id!)))[0]!.status).toBe('pending_review')
  })
})

describe('planner autonomy', () => {
  const llm = fakeLlm(({ name }) => name === 'planner.draft'
    ? { drills: ['A', 'B', 'C', 'D', 'E', 'F'].map(drill) }
    : { added: [{ ...drill('Sparring'), kind: 'sparring', afterPosition: 1, reason: 'x' }], changed: [], removed: [], rememberSuggestion: null })
  const run = (deps: ReturnType<typeof makeDeps>, classId: string) => autoAdjustNextDeck(deps, { classId, afterDate: '2026-10-19', sessionId: null, requestText: 'more guard' })
  const names = async (db: Awaited<ReturnType<typeof makeTestDb>>) => (await db.select().from(drills)).map(d => d.name)

  it('auto accepts the diff', async () => {
    const { db, classId } = await world()
    await patchSettings(db, { autonomy: { planner: 'auto' } })
    await run(makeDeps(db, { llm }), classId)
    expect(await names(db)).toContain('Sparring')
    expect((await db.select().from(deckDiffs))[0]!.status).toBe('accepted')
  })

  it('review (default) leaves the diff pending', async () => {
    const { db, classId } = await world()
    await run(makeDeps(db, { llm }), classId)
    expect(await names(db)).not.toContain('Sparring')
    expect((await db.select().from(deckDiffs))[0]!.status).toBe('pending')
  })

  it('off: no auto-adjust at all, run logged as skipped', async () => {
    const { db, classId } = await world()
    await patchSettings(db, { autonomy: { planner: 'off' } })
    await run(makeDeps(db), classId) // llm would throw
    expect(await db.select().from(decks)).toHaveLength(0)
    expect((await db.select().from(agentRuns))[0]!.summary).toContain('skipped (off)')
  })

  it('a plan_request note auto-accepts its diff only under auto', async () => {
    for (const mode of ['review', 'auto'] as const) {
      const { db, classId } = await world()
      await patchSettings(db, { autonomy: { planner: mode } })
      const [d] = await db.insert(decks).values({ classId, forDate: '2026-10-19', status: 'active' }).returning()
      await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Warm', minutes: 5, kind: 'drill' })
      const [se] = await db.insert(sessions).values({ classId, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
      const deps = makeDeps(db, { llm: fakeLlm(a => a.name === 'router'
        ? { intents: [{ type: 'plan_request', studentNames: [], content: 'more sparring next time', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }] }
        : a.name === 'planner.draft' ? { drills: ['A', 'B', 'C', 'D', 'E', 'F'].map(drill) }
        : { added: [{ ...drill('Sparring'), kind: 'sparring', afterPosition: 1, reason: 'x' }], changed: [], removed: [], rememberSuggestion: null }) })
      await handleUtterance(deps, { sessionId: se!.id, drillId: null, mode: 'note', transcript: 'more sparring next time' })
      await deps.flush()
      expect((await db.select().from(deckDiffs))[0]!.status).toBe(mode === 'auto' ? 'accepted' : 'pending')
    }
  })
})

describe('honest card lines and run reasons', () => {
  const fb = (o: object) => ({ kind: 'feedback' as const, name: 'Priya', tag: 'guard' as const, count: 3, recurring: true, ...o })
  it('deck line follows planner autonomy', () => {
    expect(buildCardLines([fb({ deck: 'auto' })])).toContain('→ added to next deck')
    expect(buildCardLines([fb({ deck: 'review' })])).toContain('→ next deck change to review')
    const off = buildCardLines([fb({ deck: 'off' })])
    expect(off.join(' ')).not.toContain('next deck')
  })
  it('urgent parent-note line is dropped when parent emails are off', () => {
    expect(buildCardLines([fb({ recurring: false, urgent: true, mail: 'review' })])).toContain('! urgent · parent note drafting')
    expect(buildCardLines([fb({ recurring: false, urgent: true, mail: 'off' })]).join(' ')).not.toContain('parent note')
  })
  it('parent_message with parent_email off adds no parent_note line', async () => {
    const { db, studentId, classId } = await world()
    await patchSettings(db, { autonomy: { parent_email: 'off' } })
    const [d] = await db.insert(decks).values({ classId, forDate: '2026-10-19', status: 'active' }).returning()
    const [se] = await db.insert(sessions).values({ classId, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ intents: [{ type: 'parent_message', studentNames: ['Priya'], content: 'tell mom hi', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }] })) })
    const r = await handleUtterance(deps, { sessionId: se!.id, drillId: null, mode: 'note', transcript: 'email priya mom' })
    expect(r.cardLines.join(' ')).not.toContain('parent note')
    expect(studentId).toBeTruthy()
  })
  it('planner runs say whether the change was applied or awaiting accept', async () => {
    for (const [mode, reason] of [['auto', 'autonomy: auto (applied)'], ['review', 'autonomy: review (awaiting accept)']] as const) {
      const { db, classId } = await world()
      await patchSettings(db, { autonomy: { planner: mode } })
      await autoAdjustNextDeck(makeDeps(db, { llm: fakeLlm(({ name }) => name === 'planner.draft'
        ? { drills: ['A', 'B', 'C', 'D', 'E', 'F'].map(drill) }
        : { added: [{ ...drill('Sparring'), kind: 'sparring', afterPosition: 1, reason: 'x' }], changed: [], removed: [], rememberSuggestion: null }) }), { classId, afterDate: '2026-10-19', sessionId: null, requestText: 'more guard' })
      expect((await db.select().from(agentRuns)).some(r => r.reason === reason)).toBe(true)
    }
  })
  it('generic or tiny drill names are not added to vocabulary', () => {
    expect(specificDrillNames(['Warm-up', 'Cool Down', 'GAME', 'Water break', 'Jab', 'Drill', 'Hip rotation'])).toEqual(['Hip rotation'])
  })
})
