import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import type { OnboardingCommit } from '@matside/shared'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm, type TestDeps } from './test/helpers'
import { createApp } from './app'
import { classes, curriculum, decks, enrollments, guardians, instructors, students } from './db/schema'
import { BudgetExceededError } from './agents/budget'
import type { Llm } from './deps'
import { cleanClasses, cleanCurriculum, cleanRoster, groundEmails, normalizeTime, normalizeWeekday } from './logic/onboarding'
import { ageFrom } from './services/students'

type Call = { name: string; prompt: string; instructions: string; images?: { data: string; mediaType: string }[] }

const DRAFT = { drills: Array.from({ length: 5 }, (_, i) => ({ name: `Drill ${i + 1}`, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: 'r' })) }

function stubLlm(calls: Call[]): Llm {
  return fakeLlm(a => {
    calls.push(a)
    switch (a.name) {
      case 'onboarding.mode': return { mode: 'tutoring', reason: 'Math tutoring for kids' }
      case 'onboarding.classes': return {
        classes: [
          { name: 'Kids · Tue', weekday: 'Tuesday', startTime: '5:30 PM', mode: null },
          { name: 'Teens', weekday: 'Thu', startTime: '18:00', mode: 'martial_arts' },
          { name: 'Mystery', weekday: 'someday', startTime: '17:00', mode: null },
        ],
        notes: 'Found 3 classes.',
      }
      case 'onboarding.roster': return {
        students: [
          { name: 'Priya Rao', nickname: null, level: 'yellow', age: 8, guardianName: 'Anita Rao', guardianEmail: 'Anita@Example.com', classNames: [] },
          { name: 'Leo Diaz', nickname: 'Leo', level: null, age: null, guardianName: null, guardianEmail: 'not-an-email', classNames: ['Teens'] },
          { name: 'priya rao', nickname: null, level: null, age: null, guardianName: null, guardianEmail: null, classNames: [] },
        ],
        notes: '1 with a parent email, 1 missing.',
      }
      case 'onboarding.curriculum': return {
        weeks: [
          { week: 1, weekStart: '2026-10-21', theme: 'Stances', itemsDue: ['Kata 1', ''] },
          { week: 2, weekStart: null, theme: 'Blocks', itemsDue: [] },
        ],
        notes: '',
      }
      case 'planner.draft': return DRAFT
      default: throw new Error(`unexpected ${a.name}`)
    }
  })
}

async function setup(llm?: Llm) {
  const db = await makeTestDb()
  await db.insert(instructors).values({ name: 'Coach', email: 'c@example.com' })
  const calls: Call[] = []
  const deps = makeDeps(db, { llm: llm ?? stubLlm(calls) })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: h, body: JSON.stringify(body) })
  return { app, h, db, deps, calls, post }
}

const COMMIT: OnboardingCommit = {
  mode: 'martial_arts',
  basics: { schoolName: 'Tiger Dojo', coachName: 'Coach Ana', timeZone: 'America/New_York' },
  classes: [
    { name: 'Kids · Tue', weekday: 2, startTime: '17:30', mode: 'martial_arts' },
    { name: 'Teens', weekday: 4, startTime: '18:00', mode: 'martial_arts' },
  ],
  students: [
    { name: 'Priya Rao', nickname: null, level: 'yellow', age: 8, guardianName: 'Anita Rao', guardianEmail: 'anita@example.com', classNames: ['Kids · Tue', 'Teens'] },
    { name: 'Leo Diaz', nickname: 'Leo', level: null, age: null, guardianName: null, guardianEmail: null, classNames: ['teens'] },
  ],
  curriculum: [
    { weekStart: '2026-10-19', theme: 'Stances', itemsDue: ['Kata 1'] },
    { weekStart: '2026-10-26', theme: 'Blocks', itemsDue: [] },
  ],
}

describe('onboarding logic', () => {
  it('normalizes times and weekdays', () => {
    expect(normalizeTime('5:30 PM')).toBe('17:30')
    expect(normalizeTime('5pm')).toBe('17:00')
    expect(normalizeTime('12 am')).toBe('00:00')
    expect(normalizeTime('0930')).toBe('09:30')
    expect(normalizeTime('17:00')).toBe('17:00')
    expect(normalizeTime('25:00')).toBeNull()
    expect(normalizeTime('noonish')).toBeNull()
    expect(normalizeWeekday('Tuesday')).toBe(2)
    expect(normalizeWeekday('sun')).toBe(0)
    expect(normalizeWeekday(7)).toBe(0)
    expect(normalizeWeekday('3')).toBe(3)
    expect(normalizeWeekday('someday')).toBeNull()
  })
  it('drops unreadable classes, dedupes, applies fallback mode', () => {
    const r = cleanClasses({ classes: [
      { name: 'A', weekday: 'Mon', startTime: '9am', mode: 'bogus' },
      { name: ' a ', weekday: 'Tue', startTime: '10:00', mode: null },
      { name: 'B', weekday: 'x', startTime: '10:00', mode: null },
    ], notes: '' }, 'tutoring', ['tutoring', 'martial_arts'])
    expect(r.items).toEqual([{ name: 'A', weekday: 1, startTime: '09:00', mode: 'tutoring' }])
    expect(r.dropped).toEqual(['B'])
  })
  it('cleans roster emails and ages, dedupes names', () => {
    const r = cleanRoster({ students: [
      { name: 'Ann Lee', nickname: '', level: ' ', age: 150, guardianName: null, guardianEmail: 'MOM@X.COM', classNames: ['Tue', 'Tue', ''] },
      { name: 'ann  lee', nickname: null, level: null, age: 9, guardianName: null, guardianEmail: null, classNames: [] },
      { name: 'Bo', nickname: null, level: null, age: 7.5, guardianName: null, guardianEmail: 'bo@', classNames: [] },
    ], notes: '' })
    expect(r.items).toHaveLength(2)
    expect(r.items[0]).toMatchObject({ nickname: null, level: null, age: null, guardianEmail: 'mom@x.com', classNames: ['Tue'] })
    expect(r.items[1]).toMatchObject({ name: 'Bo', age: null, guardianEmail: null })
    expect(r.dropped[0]).toContain('bo@')
  })
  it('snaps curriculum dates to Monday and numbers missing weeks', () => {
    const r = cleanCurriculum({ weeks: [{ week: 0, weekStart: '2026-10-22', theme: 'Kicks', itemsDue: [' ', 'Form A'] }, { week: 3, weekStart: 'soon', theme: ' ', itemsDue: [] }], notes: '' })
    expect(r.items).toEqual([{ week: 1, weekStart: '2026-10-19', theme: 'Kicks', itemsDue: ['Form A'] }])
  })
})

describe('grounding and ages', () => {
  it('groundEmails nulls emails that are not in the text (case-insensitive)', () => {
    const s = (name: string, guardianEmail: string | null) => ({ name, nickname: null, level: null, age: null, guardianName: null, guardianEmail, classNames: [] })
    const r = groundEmails([s('A', 'mom@x.com'), s('B', 'made@up.com'), s('C', null)], 'A - MOM@X.com\nB\nC')
    expect(r.items.map(i => i.guardianEmail)).toEqual(['mom@x.com', null, null])
    expect(r.removed).toBe(1)
  })
  it('ageFrom: unknown (birth year this year or later) is null', () => {
    expect(ageFrom(2026, 2018)).toBe(8)
    expect(ageFrom(2026, 2026)).toBeNull()
    expect(ageFrom(2026, 2030)).toBeNull()
  })
})

describe('POST /v1/onboarding/extract', () => {
  beforeEach(() => resetRateLimits())

  it('mode: returns the closest mode', async () => {
    const { post, calls } = await setup()
    const r = await post('/v1/onboarding/extract', { step: 'mode', text: 'I tutor middle school math' })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ step: 'mode', mode: 'tutoring', reason: 'Math tutoring for kids' })
    expect(calls[0]!.prompt).toContain('I tutor middle school math')
    expect(calls[0]!.images).toBeUndefined()
  })

  it('classes: normalizes and reports what was skipped', async () => {
    const { post } = await setup()
    const r = await post('/v1/onboarding/extract', { step: 'classes', text: 'Kids Tue 5:30, Teens Thu 6', mode: 'tutoring' })
    const body = await r.json() as { classes: unknown[]; notes: string }
    expect(body.classes).toEqual([
      { name: 'Kids · Tue', weekday: 2, startTime: '17:30', mode: 'tutoring' },
      { name: 'Teens', weekday: 4, startTime: '18:00', mode: 'martial_arts' },
    ])
    expect(body.notes).toContain('Found 3 classes.')
    expect(body.notes).toContain('Mystery')
  })

  it('roster: passes a photo to the model as an image part', async () => {
    const { post, calls } = await setup()
    const r = await post('/v1/onboarding/extract', { step: 'roster', imageBase64: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' })
    expect(r.status).toBe(200)
    const body = await r.json() as { students: { name: string; guardianEmail: string | null }[] }
    expect(body.students.map(s => [s.name, s.guardianEmail])).toEqual([['Priya Rao', 'anita@example.com'], ['Leo Diaz', null]])
    expect(calls[0]!.images).toEqual([{ data: 'iVBORw0KGgoAAAANSUhEUg==', mediaType: 'image/png' }])
    expect(calls[0]!.prompt).toContain('attached image')
  })

  it('roster from text: drops emails that are not in the pasted text and says so', async () => {
    const llm = fakeLlm(() => ({
      students: [
        { name: 'Priya Rao', nickname: null, level: null, age: null, guardianName: null, guardianEmail: 'Anita@Example.com', classNames: [] },
        { name: 'Leo Diaz', nickname: null, level: null, age: null, guardianName: null, guardianEmail: 'leo.parent@gmail.com', classNames: [] },
      ],
      notes: 'Found 2.',
    }))
    const { post } = await setup(llm)
    const body = await (await post('/v1/onboarding/extract', { step: 'roster', text: 'Priya Rao anita@example.com\nLeo Diaz' })).json() as { students: { guardianEmail: string | null }[]; notes: string }
    expect(body.students.map(s => s.guardianEmail)).toEqual(['anita@example.com', null])
    expect(body.notes).toContain('1 email not found in your text was removed')
  })

  it('curriculum: weeks with Monday dates', async () => {
    const { post } = await setup()
    const body = await (await post('/v1/onboarding/extract', { step: 'curriculum', text: 'wk1 stances, wk2 blocks' })).json() as { weeks: unknown[] }
    expect(body.weeks).toEqual([
      { week: 1, weekStart: '2026-10-19', theme: 'Stances', itemsDue: ['Kata 1'] },
      { week: 2, weekStart: null, theme: 'Blocks', itemsDue: [] },
    ])
  })

  it('validates: empty input 400, oversized image 413, unauthenticated 401', async () => {
    const { post, app } = await setup()
    expect((await post('/v1/onboarding/extract', { step: 'roster' })).status).toBe(400)
    expect((await post('/v1/onboarding/extract', { step: 'basics', text: 'x' })).status).toBe(400)
    expect((await post('/v1/onboarding/extract', { step: 'roster', imageBase64: 'A'.repeat(4_000_004) })).status).toBe(413)
    expect((await app.request('/v1/onboarding/extract', { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it('budget reached → 429; model failure → 502', async () => {
    const budget = await setup(fakeLlm(() => { throw new BudgetExceededError() }))
    expect((await budget.post('/v1/onboarding/extract', { step: 'mode', text: 'karate' })).status).toBe(429)
    resetRateLimits()
    const broken = await setup(fakeLlm(() => ({ nope: true })))
    const r = await broken.post('/v1/onboarding/extract', { step: 'mode', text: 'karate' })
    expect(r.status).toBe(502)
    expect(await r.json()).toEqual({ error: 'extract_failed' })
  })
})

describe('POST /v1/onboarding/commit', () => {
  beforeEach(() => resetRateLimits())

  async function counts(db: TestDeps['db']) {
    return {
      classes: (await db.select().from(classes)).length,
      students: (await db.select().from(students)).length,
      guardians: (await db.select().from(guardians)).length,
      enrollments: (await db.select().from(enrollments)).length,
      weeks: (await db.select().from(curriculum)).length,
    }
  }

  it('creates everything, enrolls, saves basics and drafts first plans', async () => {
    const { post, app, h, db, deps, calls } = await setup()
    expect(await (await app.request('/v1/onboarding/status', { headers: h })).json()).toMatchObject({ needsOnboarding: true, classCount: 0 })
    const r = await post('/v1/onboarding/commit', COMMIT)
    expect(r.status).toBe(200)
    const body = await r.json() as { classIds: string[]; studentCount: number; created: Record<string, number>; plansQueued: number }
    expect(body).toMatchObject({ studentCount: 2, created: { classes: 2, students: 2, guardians: 1 }, weeks: 2, plansQueued: 2 })
    expect(await counts(db)).toEqual({ classes: 2, students: 2, guardians: 1, enrollments: 3, weeks: 2 })
    const [ins] = await db.select().from(instructors)
    expect(ins).toMatchObject({ name: 'Coach Ana', schoolName: 'Tiger Dojo', timeZone: 'America/New_York' })
    const [priya] = await db.select().from(students).where(eq(students.name, 'Priya Rao'))
    expect(priya).toMatchObject({ belt: 'yellow', birthYear: 2018 })
    const [leo] = await db.select().from(students).where(eq(students.name, 'Leo Diaz'))
    expect(leo).toMatchObject({ nickname: 'Leo', belt: 'new' })
    expect((await db.select().from(curriculum)).every(w => w.mode === 'martial_arts')).toBe(true)

    await deps.flush()
    expect(calls.filter(c => c.name === 'planner.draft')).toHaveLength(2)
    expect((await db.select().from(decks)).map(d => d.forDate).sort()).toEqual(['2026-10-20', '2026-10-22'])
    expect(await (await app.request('/v1/onboarding/status', { headers: h })).json()).toMatchObject({ needsOnboarding: false, classCount: 2, studentCount: 2, schoolName: 'Tiger Dojo' })
  })

  it('is idempotent by name: re-running updates instead of duplicating', async () => {
    const { post, db, deps, calls } = await setup()
    expect((await post('/v1/onboarding/commit', COMMIT)).status).toBe(200)
    await deps.flush()
    const again: OnboardingCommit = {
      ...COMMIT,
      classes: [{ ...COMMIT.classes[0]!, name: 'kids · tue', startTime: '16:00' }, COMMIT.classes[1]!],
      students: [{ ...COMMIT.students[0]!, name: 'PRIYA RAO', guardianEmail: 'ANITA@example.com', level: 'orange' }, COMMIT.students[1]!],
      curriculum: [{ weekStart: '2026-10-19', theme: 'Kicks', itemsDue: ['Kata 2'] }],
    }
    const r = await post('/v1/onboarding/commit', again)
    expect(r.status).toBe(200)
    expect(((await r.json()) as { created: Record<string, number> }).created).toEqual({ classes: 0, students: 0, guardians: 0 })
    expect(await counts(db)).toEqual({ classes: 2, students: 2, guardians: 1, enrollments: 3, weeks: 2 })
    const tue = (await db.select().from(classes)).find(c => c.weekday === 2)
    expect(tue).toMatchObject({ name: 'kids · tue', startTime: '16:00' })
    expect((await db.select().from(students)).find(s => s.name === 'PRIYA RAO')?.belt).toBe('orange')
    expect((await db.select().from(curriculum).where(eq(curriculum.weekStart, '2026-10-19')))[0]).toMatchObject({ theme: 'Kicks', formsDue: ['Kata 2'] })
    await deps.flush()
    expect(calls.filter(c => c.name === 'planner.draft')).toHaveLength(2) // existing decks are not redrafted
  })

  it('stores curriculum under the chosen mode', async () => {
    const { post, db } = await setup()
    const pt: OnboardingCommit = { ...COMMIT, mode: 'personal_training', classes: COMMIT.classes.map(c => ({ ...c, mode: 'personal_training' as const })) }
    expect((await post('/v1/onboarding/commit', pt)).status).toBe(200)
    expect((await db.select().from(curriculum)).map(w => w.mode)).toEqual(['personal_training', 'personal_training'])
    expect((await db.select().from(classes)).every(c => c.mode === 'personal_training')).toBe(true)
  })

  it('rejects unknown class names and bad bodies without writing', async () => {
    const { post, db } = await setup()
    const bad = { ...COMMIT, students: [{ ...COMMIT.students[0]!, classNames: ['Nope'] }] }
    const r = await post('/v1/onboarding/commit', bad)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'unknown classes: Nope' })
    expect((await post('/v1/onboarding/commit', { ...COMMIT, classes: [] })).status).toBe(400)
    expect((await post('/v1/onboarding/commit', { ...COMMIT, classes: [COMMIT.classes[0], { ...COMMIT.classes[1], name: 'KIDS ·  Tue' }] })).status).toBe(400)
    expect((await post('/v1/onboarding/commit', { ...COMMIT, basics: { ...COMMIT.basics, timeZone: 'Moon/Base' } })).status).toBe(400)
    expect(await counts(db)).toEqual({ classes: 0, students: 0, guardians: 0, enrollments: 0, weeks: 0 })
  })
})
