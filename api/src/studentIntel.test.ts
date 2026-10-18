import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { MODES, StudentDetail, UtteranceResponse, type ModeId } from '@matside/shared'
import { resetRateLimits } from './http/rateLimit'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { handleUtterance } from './services/utterance'
import { buildBrief } from './services/brief'
import { attendanceDots, changeFor, timeInRank } from './logic/metrics'
import { agentRuns, agentSettings, attendance, classes, curriculum, decks, drills, enrollments, instructors, notes, issues, sessions, studentMetrics, students } from './db/schema'

const intent = (o: Record<string, unknown>) => ({ type: 'metric', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false, ...o })

async function world(mode: ModeId = 'martial_arts', belt = 'yellow') {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Class', weekday: 1, startTime: '17:00', mode }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz'].map(name => ({ name, belt, birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', mode, theme: 'T', formsDue: [] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'D', minutes: 5, kind: 'drill' })
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const say = (reply: unknown, text = 'x') => {
    const deps = makeDeps(db, { llm: fakeLlm(() => ({ intents: Array.isArray(reply) ? reply : [reply] })) })
    return handleUtterance(deps, { sessionId: se!.id, drillId: null, mode: 'note', transcript: text })
  }
  return { db, ss, sessionId: se!.id, classId: c!.id, deckId: d!.id, say }
}
const metricsOf = (db: Awaited<ReturnType<typeof world>>['db'], id: string) => db.select().from(studentMetrics).where(eq(studentMetrics.studentId, id))

describe('pure metric logic', () => {
  it('detects PRs, grade deltas and time in rank', () => {
    expect(changeFor(false, 225, [205, 215])).toEqual({ kind: 'pr', delta: 10 })
    expect(changeFor(false, 215, [205, 215])).toBeNull()
    expect(changeFor(false, 100, [])).toBeNull()
    expect(changeFor(true, 88, [70, 82])).toEqual({ kind: 'delta', delta: 6 })
    expect(timeInRank('2026-03-01', '2026-10-17')).toBe('8 mo')
    expect(timeInRank('2026-10-10', '2026-10-17')).toBe('7d')
    expect(timeInRank('2025-03-01', '2026-10-17')).toBe('1y 8mo')
    expect(timeInRank(null, '2026-10-17')).toBeNull()
  })
  it('renders attendance dots with a trend word', () => {
    expect(attendanceDots(['present', 'present', 'absent', 'present', 'present', 'present'])).toEqual({ dots: '●●○●●●', trend: 'improving' })
    expect(attendanceDots(['present', 'absent', 'present', 'present', 'absent', 'present'])).toEqual({ dots: '●○●●○●', trend: 'steady' })
    expect(attendanceDots(['absent', 'absent', 'absent', 'present', 'present', 'present']).trend).toBe('improving')
    expect(attendanceDots(['present', 'present', 'present', 'absent', 'absent', 'present']).trend).toBe('dropping')
    expect(attendanceDots(['present', 'absent']).trend).toBe('steady')
  })
})

describe('metric intent', () => {
  it('flags a PR against earlier lifts and logs a progress run', async () => {
    const w = await world('personal_training')
    const maria = w.ss[0]!
    await w.db.insert(studentMetrics).values({ studentId: maria.id, key: 'deadlift', value: '215 lb', num: 215, unit: 'lb', source: 'seed' })
    const r = await w.say(intent({ studentNames: ['Priya'], metricKey: 'Deadlift', metricValue: '225 lb', metricNum: 225, metricUnit: 'lb' }), 'Priya hit 225 on deadlift')
    expect(r.cardLines).toEqual(['✓ Priya · deadlift 225 lb (PR +10)'])
    const rows = await metricsOf(w.db, maria.id)
    expect(rows).toHaveLength(2)
    expect(rows.find(x => x.source === 'voice')).toMatchObject({ key: 'deadlift', num: 225, unit: 'lb' })
    const run = (await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'progress')))[0]!
    expect(run).toMatchObject({ trigger: 'metric', status: 'ok' })
    expect(run.links).toMatchObject({ studentId: maria.id })
  })

  it('a lower or first lift is saved without a PR tag', async () => {
    const w = await world('personal_training')
    const r1 = await w.say(intent({ studentNames: ['Priya'], metricKey: 'squat', metricNum: 185, metricUnit: 'lb' }))
    expect(r1.cardLines).toEqual(['✓ Priya · squat 185 lb'])
    const r2 = await w.say(intent({ studentNames: ['Priya'], metricKey: 'squat', metricNum: 175, metricUnit: 'lb' }))
    expect(r2.cardLines).toEqual(['✓ Priya · squat 175 lb'])
  })

  it('grades show the delta against the last value', async () => {
    const w = await world('tutoring')
    await w.say(intent({ studentNames: ['Leo'], metricKey: 'test', metricValue: 'Unit 2 test', metricNum: 82, metricUnit: '%' }))
    const r = await w.say(intent({ studentNames: ['Leo'], metricKey: 'test', metricValue: 'Unit 3 test', metricNum: 76, metricUnit: '%' }))
    expect(r.cardLines).toEqual(['✓ Leo · test 76% (-6)'])
  })

  it('a rank with a date sets rank_since and the belt', async () => {
    const w = await world()
    const r = await w.say(intent({ studentNames: ['Leo'], metricKey: 'rank', metricValue: 'green', metricSince: '2026-03-01' }))
    expect(r.cardLines).toEqual(['✓ Leo · rank green (since Mar 1)'])
    const [leo] = await w.db.select().from(students).where(eq(students.id, w.ss[1]!.id))
    expect(leo).toMatchObject({ belt: 'green', rankSince: '2026-03-01' })
  })

  it('a rank change without a date starts today; the same rank leaves rank_since alone', async () => {
    const w = await world()
    await w.db.update(students).set({ rankSince: '2026-01-05' }).where(eq(students.id, w.ss[0]!.id))
    await w.say(intent({ studentNames: ['Priya'], metricKey: 'rank', metricValue: 'Yellow' }))
    expect((await w.db.select().from(students).where(eq(students.id, w.ss[0]!.id)))[0]!.rankSince).toBe('2026-01-05')
    await w.say(intent({ studentNames: ['Priya'], metricKey: 'rank', metricValue: 'orange' }))
    expect((await w.db.select().from(students).where(eq(students.id, w.ss[0]!.id)))[0]).toMatchObject({ belt: 'orange', rankSince: '2026-10-19' })
  })

  it('does not save when progress autonomy is off', async () => {
    const w = await world('personal_training')
    await w.db.insert(agentSettings).values({ task: 'progress', autonomy: 'off' })
    const r = await w.say(intent({ studentNames: ['Priya'], metricKey: 'bench', metricNum: 135, metricUnit: 'lb' }))
    expect(r.cardLines).toEqual(['● Progress logging off · not saved'])
    expect(await metricsOf(w.db, w.ss[0]!.id)).toHaveLength(0)
    const run = (await w.db.select().from(agentRuns).where(eq(agentRuns.agent, 'progress')))[0]!
    expect(run.reason).toMatch(/autonomy: off/)
  })

  it('an unknown name asks again and writes nothing', async () => {
    const w = await world('personal_training')
    const r = await w.say(intent({ studentNames: ['Zed'], metricKey: 'bench', metricNum: 135, metricUnit: 'lb' }))
    expect(r.cardLines).toEqual(['? Didn\'t catch "Zed" · say again'])
    expect(await w.db.select().from(studentMetrics)).toHaveLength(0)
  })
})

describe('buildBrief', () => {
  async function briefWorld(mode: ModeId) {
    const w = await world(mode)
    const priya = w.ss[0]!
    // six sessions, oldest first: present x2, absent, present x3
    const pattern = ['present', 'present', 'absent', 'present', 'present', 'present'] as const
    for (const [i, status] of pattern.entries()) {
      const [se] = await w.db.insert(sessions).values({ classId: w.classId, deckId: w.deckId, forDate: `2026-09-${10 + i}`, startedAt: new Date(`2026-09-${10 + i}T17:00:00Z`) }).returning()
      await w.db.insert(attendance).values({ sessionId: se!.id, studentId: priya.id, status, source: 'phone' })
    }
    await w.db.insert(notes).values([
      { studentId: priya.id, text: 'guard drops when tired on the jab combination again', tags: ['guard'], createdAt: new Date('2026-10-10T00:00:00Z') },
      { studentId: priya.id, text: 'great energy', tags: [], createdAt: new Date('2026-10-14T00:00:00Z') },
    ])
    await w.db.insert(issues).values({ studentId: priya.id, tag: 'guard' })
    return w
  }
  const now = new Date('2026-10-20T00:30:00Z')

  it('martial arts: rank with time in rank, dots, two notes, issue; at most 5 lines of 38 chars', async () => {
    const w = await briefWorld('martial_arts')
    await w.db.update(students).set({ rankSince: '2026-03-01' }).where(eq(students.id, w.ss[0]!.id))
    const b = await buildBrief(w.db, w.ss[0]!.id, MODES.martial_arts, now)
    expect(b.name).toBe('Priya Rao')
    expect(b.lines[0]).toBe('Priya · yellow · 8 mo')
    expect(b.lines[1]).toBe('Att ●●○●●● improving')
    expect(b.lines[2]).toBe('10/14 great energy')
    expect(b.lines).toHaveLength(5)
    expect(b.lines.at(-1)).toBe('Working on: guard')
    for (const l of b.lines) expect(l.length).toBeLessThanOrEqual(38)
  })

  it('personal training: client wording and the latest PR; drops the second note over budget', async () => {
    const w = await briefWorld('personal_training')
    await w.db.insert(studentMetrics).values([
      { studentId: w.ss[0]!.id, key: 'deadlift', value: '215 lb', num: 215, unit: 'lb', source: 'seed', recordedAt: new Date('2026-10-01T00:00:00Z') },
      { studentId: w.ss[0]!.id, key: 'deadlift', value: '225 lb', num: 225, unit: 'lb', source: 'voice', recordedAt: new Date('2026-10-08T00:00:00Z') },
    ])
    const b = await buildBrief(w.db, w.ss[0]!.id, MODES.personal_training, now)
    expect(b.lines[0]).toBe('Priya · client · 5 sessions')
    expect(b.lines[1]).toBe('Sessions ●●○●●● improving')
    expect(b.lines).toEqual([...b.lines.slice(0, 2), '10/14 great energy', 'Working on: guard', 'Deadlift 225 lb (PR +10)'])
  })

  it('tutoring: latest grade with its trend', async () => {
    const w = await briefWorld('tutoring')
    await w.db.insert(studentMetrics).values([
      { studentId: w.ss[0]!.id, key: 'test', value: 'Unit 2 test', num: 82, unit: '%', source: 'seed', recordedAt: new Date('2026-10-01T00:00:00Z') },
      { studentId: w.ss[0]!.id, key: 'test', value: 'Unit 3 test', num: 88, unit: '%', source: 'voice', recordedAt: new Date('2026-10-08T00:00:00Z') },
    ])
    const b = await buildBrief(w.db, w.ss[0]!.id, MODES.tutoring, now)
    expect(b.lines[0]).toBe('Priya · student · 5 lessons')
    expect(b.lines[1]).toMatch(/^Lessons ●●○●●● improving$/)
    expect(b.lines.at(-1)).toBe('Last test 88% (+6)')
    expect(b.lines).toHaveLength(5)
  })

  it('a new student gets a short, honest brief', async () => {
    const w = await world()
    const b = await buildBrief(w.db, w.ss[1]!.id, MODES.martial_arts, now)
    expect(b.lines).toEqual(['Leo · yellow', 'Att: none yet'])
  })

  it('shows the dropping trend', async () => {
    const w = await world()
    for (const [i, status] of (['present', 'present', 'present', 'absent', 'absent', 'present'] as const).entries()) {
      const [se] = await w.db.insert(sessions).values({ classId: w.classId, deckId: w.deckId, forDate: `2026-09-${10 + i}`, startedAt: new Date(`2026-09-${10 + i}T17:00:00Z`) }).returning()
      await w.db.insert(attendance).values({ sessionId: se!.id, studentId: w.ss[0]!.id, status, source: 'phone' })
    }
    expect((await buildBrief(w.db, w.ss[0]!.id, MODES.martial_arts, now)).lines[1]).toBe('Att ●●●○○● dropping')
  })
})

describe('student_query intent', () => {
  it('returns a card line and the brief, with no writes', async () => {
    const w = await world()
    const before = await w.db.select().from(notes)
    const r = UtteranceResponse.parse(await w.say(intent({ type: 'student_query', studentNames: ['Priya'] }), "how's Priya doing?"))
    expect(r.cardLines).toEqual(['Priya · see profile'])
    expect(r.brief?.name).toBe('Priya Rao')
    expect(r.brief?.lines[0]).toBe('Priya · yellow')
    expect(await w.db.select().from(notes)).toEqual(before)
    expect(await w.db.select().from(studentMetrics)).toHaveLength(0)
  })
  it('does not add a brief to ordinary replies, and an unknown name asks again', async () => {
    const w = await world()
    const r = await w.say(intent({ type: 'student_query', studentNames: ['Zed'] }))
    expect(r.brief).toBeUndefined()
    expect(r.cardLines).toEqual(['? Didn\'t catch "Zed" · say again'])
  })
})

describe('student intelligence http', () => {
  beforeEach(() => resetRateLimits())
  async function http() {
    const w = await world('personal_training')
    const app = createApp(makeDeps(w.db))
    const { token } = (await (await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })).json()) as { token: string }
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    return { ...w, app, h }
  }

  it('POST /v1/students/:id/metrics adds, detail lists them, DELETE /v1/metrics/:id removes', async () => {
    const { app, h, ss } = await http()
    const id = ss[0]!.id
    const post = await app.request(`/v1/students/${id}/metrics`, { method: 'POST', headers: h, body: JSON.stringify({ key: 'Bench Press', value: '135 lb', num: 135, unit: 'lb' }) })
    expect(post.status).toBe(201)
    const m = (await post.json()) as { id: string; key: string; source: string }
    expect(m).toMatchObject({ key: 'bench_press', source: 'phone' })
    const detail = StudentDetail.parse(await (await app.request(`/v1/students/${id}`, { headers: h })).json())
    expect(detail.metrics.map(x => x.key)).toEqual(['bench_press'])
    expect(detail.brief.lines.length).toBeGreaterThan(0)
    expect(detail.rankSince).toBeNull()
    const del = await app.request(`/v1/metrics/${m.id}`, { method: 'DELETE', headers: h })
    expect(await del.json()).toEqual({ ok: true })
    expect((await app.request(`/v1/metrics/${m.id}`, { method: 'DELETE', headers: h })).status).toBe(404)
    expect(StudentDetail.parse(await (await app.request(`/v1/students/${id}`, { headers: h })).json()).metrics).toEqual([])
  })

  it('validates metric bodies and unknown students', async () => {
    const { app, h, ss } = await http()
    expect((await app.request(`/v1/students/${ss[0]!.id}/metrics`, { method: 'POST', headers: h, body: JSON.stringify({ key: '', value: 'x' }) })).status).toBe(400)
    expect((await app.request('/v1/students/nope/metrics', { method: 'POST', headers: h, body: JSON.stringify({ key: 'a', value: 'b' }) })).status).toBe(404)
  })

  it('GET /v1/students/:id/brief returns the lens brief', async () => {
    const { app, h, ss } = await http()
    const b = (await (await app.request(`/v1/students/${ss[0]!.id}/brief`, { headers: h })).json()) as { name: string; lines: string[] }
    expect(b.name).toBe('Priya Rao')
    expect(b.lines[0]).toBe('Priya · client')
    expect((await app.request('/v1/students/nope/brief', { headers: h })).status).toBe(404)
  })

  it('PATCH accepts belt and rankSince; alias-only replies keep their shape', async () => {
    const { app, h, ss, db } = await http()
    const id = ss[0]!.id
    const r = await app.request(`/v1/students/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ belt: 'green', rankSince: '2026-03-01' }) })
    expect(await r.json()).toEqual({ id, aliases: [], belt: 'green', rankSince: '2026-03-01' })
    expect((await db.select().from(students).where(eq(students.id, id)))[0]).toMatchObject({ belt: 'green', rankSince: '2026-03-01' })
    const cleared = await app.request(`/v1/students/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ rankSince: null }) })
    expect(await cleared.json()).toEqual({ id, aliases: [], rankSince: null })
    expect((await app.request(`/v1/students/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ rankSince: 'March' }) })).status).toBe(400)
    expect((await app.request(`/v1/students/${id}`, { method: 'PATCH', headers: h, body: JSON.stringify({}) })).status).toBe(400)
  })
})
