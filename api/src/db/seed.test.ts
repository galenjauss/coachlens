import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { MODES } from '@matside/shared'
import { makeTestDb } from '../test/helpers'
import { seed } from './seed'
import { PAST_SESSIONS_PER_CLASS } from './seedHistory'
import { students, notes, issues, curriculum, decks, classes, guardians, drills, sessions, attendance, studentMetrics, insights, kv } from './schema'
import { loadFacts } from '../services/insightFacts'
import { detectAll, returningStudent } from '../agents/insights'
import { buildBrief } from '../services/brief'

const TODAY = '2026-10-17' // Saturday
const NOW = new Date('2026-10-17T19:00:00Z') // noon Pacific
const opts = { today: TODAY, guardianEmail: (i: number) => `parent${i}@example.com` }

describe('seed', () => {
  it('creates the demo world and is idempotent', async () => {
    const db = await makeTestDb()
    await seed(db, opts)
    const r = await seed(db, opts)
    // martial-arts world: Priya keeps exactly 2 guard notes so the live 3rd one marks guard recurring
    const priyaNotes = await db.select().from(notes).where(eq(notes.studentId, r.priyaId))
    expect(priyaNotes.filter(n => n.tags.includes('guard'))).toHaveLength(2)
    const iss = await db.select().from(issues)
    expect(iss.map(i => i.tag).sort()).toEqual(['focus', 'guard', 'guard'])
    // 2 martial-arts classes (Tue, Thu) + PT + Algebra: 3 modes, 4 classes
    const cls = await db.select().from(classes)
    expect(cls.map(c => c.mode).sort()).toEqual(['martial_arts', 'martial_arts', 'personal_training', 'tutoring'])
    expect(await db.select().from(students)).toHaveLength(23)
    expect(await db.select().from(guardians)).toHaveLength(23)
    const cur = await db.select().from(curriculum)
    const perMode = (m: string) => cur.filter(c => c.mode === m).length
    expect([perMode('martial_arts'), perMode('personal_training'), perMode('tutoring')]).toEqual([4, 2, 2])
    // each class: one upcoming draft deck (the demo plan) + one finished deck per past session
    const ds = await db.select().from(decks)
    expect(ds).toHaveLength(4 * (1 + PAST_SESSIONS_PER_CLASS))
    const upcoming = ds.filter(d => d.status === 'draft')
    expect(new Set(upcoming.map(d => d.classId))).toEqual(new Set(cls.map(c => c.id)))
    const deckOf = async (classId: string) => db.select().from(drills).where(eq(drills.deckId, upcoming.find(d => d.classId === classId)!.id))
    expect((await deckOf(r.classIds.tue)).map(d => d.name)).toContain('Guard-up jab drill')
    expect(await deckOf(r.classIds.pt)).toHaveLength(7)
    expect(await deckOf(r.classIds.algebra)).toHaveLength(6)
    expect(upcoming.find(d => d.classId === r.classIds.pt)!.forDate).toBe('2026-10-19') // next Mon
    expect(upcoming.find(d => d.classId === r.classIds.algebra)!.forDate).toBe('2026-10-21') // next Wed
    expect(upcoming.find(d => d.classId === r.classIds.tue)!.forDate).toBe('2026-10-20') // next Tue
    // PT: Maria has 2 depth notes so her 3rd triggers recurring; clients get their own emails
    const maria = await db.select().from(notes).where(eq(notes.studentId, r.mariaId))
    expect(maria.filter(n => n.tags.includes('depth'))).toHaveLength(2)
    const [mg] = await db.select().from(guardians).where(eq(guardians.studentId, r.mariaId))
    expect(mg!.name).toBe('Maria Gomez')
    const sam = await db.select().from(notes).where(eq(notes.studentId, r.samPatelId))
    expect(sam.filter(n => n.tags.includes('procedure'))).toHaveLength(2)
    // no seeded rationale claims "this week's theme"
    expect((await db.select().from(drills)).filter(d => /this week/i.test(d.rationale))).toHaveLength(0)
  })

  it('has 6 finished past sessions per class, all before today, with attendance for everyone enrolled', async () => {
    const db = await makeTestDb()
    const r = await seed(db, opts)
    const ss = await db.select().from(sessions)
    expect(ss).toHaveLength(4 * PAST_SESSIONS_PER_CLASS)
    expect(ss.every(s => s.endedAt && s.forDate < TODAY)).toBe(true)
    const tue = ss.filter(s => s.classId === r.classIds.tue).map(s => s.forDate).sort()
    expect(tue).toEqual(['2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06', '2026-10-13'])
    // 14 kids x 12 + 5 clients x 6 + 4 students x 6
    expect(await db.select().from(attendance)).toHaveLength(14 * 12 + 5 * 6 + 4 * 6)
  })

  it('gives every mode profile data: ranks, attendance dots and metrics', async () => {
    const db = await makeTestDb()
    const r = await seed(db, opts)
    const kids = (await db.select().from(students)).filter(s => !['client', 'grade 7', 'grade 8'].includes(s.belt))
    expect(kids.every(k => k.rankSince)).toBe(true)
    const priya = await buildBrief(db, r.priyaId, MODES.martial_arts, NOW)
    expect(priya.lines[0]).toBe('Priya · orange · 8 mo')
    expect(priya.lines[1]).toContain('●●○●●●')
    const ms = await db.select().from(studentMetrics).where(eq(studentMetrics.studentId, r.mariaId))
    expect(new Set(ms.map(m => m.key))).toEqual(new Set(['squat', 'deadlift', 'bench_press']))
    expect(Math.max(...ms.filter(m => m.key === 'deadlift').map(m => m.num!))).toBe(215) // live "225 on deadlift" is PR +10
    const mariaBrief = await buildBrief(db, r.mariaId, MODES.personal_training, NOW)
    expect(mariaBrief.lines.some(l => l.startsWith('Squat 185 lb (PR +10)'))).toBe(true)
    const samBrief = await buildBrief(db, r.samPatelId, MODES.tutoring, NOW)
    expect(samBrief.lines.some(l => l.includes('unit test 81%'))).toBe(true)
  })

  it('every detector has exactly one believable hit on the first run after seeding', async () => {
    const db = await makeTestDb()
    await seed(db, opts)
    const facts = await loadFacts(db, undefined, { today: TODAY, now: NOW })
    const hits = detectAll(facts, { today: TODAY, now: NOW, sessionId: null })
    const name = (id: string | null) => facts.find(f => f.id === id)!.name.split(' ')[0]
    expect(hits.map(h => `${h.kind}:${name(h.studentId)}`).sort()).toEqual([
      'attendance_decline:Jake', 'billing_repeat:Leonardo', 'grade_drop:Noah', 'issue_resolved:Priya',
      'new_pr:Maria', 'no_feedback:Eli', 'ready_to_test:Gus',
    ])
    expect(hits.find(h => h.kind === 'attendance_decline')!.title).toBe('Jake missed 3 of last 3 classes')
    expect(hits.find(h => h.kind === 'grade_drop')!.title).toBe("Noah's unit test down 12 pts")
    expect(hits.find(h => h.kind === 'new_pr')!.title).toBe('Maria hit a PR: squat 185 lb')
    // the live demo: Jake marked present in the next Kids · Tue class -> returning_student
    const jake = facts.find(f => f.name === 'Jake Ross')!
    const live = { ...jake, attendance: [...jake.attendance, { sessionId: 'live', forDate: '2026-10-20', status: 'present' as const, ended: false }] }
    expect(returningStudent(live, { today: '2026-10-20', now: NOW, sessionId: 'live' })!.title).toBe("Jake's back after 3 missed")
  })

  it('a reseed clears insights and insight bookkeeping, keeping other kv keys', async () => {
    const db = await makeTestDb()
    await seed(db, opts)
    await db.insert(insights).values({ kind: 'new_pr', title: 't', detail: 'd', urgency: 'low', action: { type: 'none', label: null }, dedupeKey: 'k' })
    await db.insert(kv).values([{ key: 'insights:last_run', value: 'x' }, { key: 'insights:live:abc', value: 'x' }, { key: 'other', value: 'x' }])
    await seed(db, opts)
    expect(await db.select().from(insights)).toEqual([])
    expect((await db.select().from(kv)).map(k => k.key)).toEqual(['other'])
  })
})
