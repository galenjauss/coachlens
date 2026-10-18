import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DeckPatch, UtteranceForm } from '@matside/shared'
import type { Deps } from './deps'
import { attendance, billingFlags, enrollments, instructors, notes, sessions, students, classes } from './db/schema'
import { hashToken } from './http/auth'
import { timingSafeEqual } from 'node:crypto'
import { allow, isBlocked, recordFailure } from './http/rateLimit'
import { getToday } from './services/today'
import { endSession, logDrill, requireSession, startSession } from './services/sessions'
import { handleUtterance } from './services/utterance'
import { listReview, approveOutbox, skipOutbox, approveAllOutbox, handleBilling, noteBilling, dismissNote, type ActionResult } from './services/review'
import { getDeck, patchDeck } from './services/decks'
import { runReportCards } from './agents/reportCard'
import { agentFeed, getStudentDetail, listStudents } from './services/students'
import { acceptDiff, alternativesFor, nextDeckFor, suggestDiff, undoDiff } from './agents/planner'
import { applyDiff, totalMinutes } from './logic/deckDiff'
import { localDate } from './logic/dates'
import { computeCoverage, loadSessionContext, markPresent, nextStudentFor } from './services/context'

type Vars = { Variables: { instructorId: string } }
const MAX_AUDIO_BYTES = 2_000_000
const PAIR_FAIL_LIMIT = 20
const PAIR_FAIL_WINDOW_MS = 10 * 60_000
const MAX_TOKENS = 5

function codesMatch(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const json = async <T>(req: Request, schema: z.ZodType<T>): Promise<T> => {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid body' })
  return parsed.data
}

export function createApp(deps: Deps) {
  const app = new Hono<Vars>()
  const { db } = deps

  app.use('*', cors({
    origin: o => (deps.env.allowedOrigins.includes('*') ? o || '*' : deps.env.allowedOrigins.includes(o) ? o : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    maxAge: 600,
  }))

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error('[api]', c.req.method, c.req.path, err)
    return c.json({ error: 'internal_error' }, 500)
  })

  app.get('/health', c => c.json({ ok: true }))

  app.post('/pair', async c => {
    const ip = c.req.header('x-forwarded-for') ?? 'local'
    if (!allow(`pair:${ip}`, 10)) throw new HTTPException(429, { message: 'slow down' })
    const { code } = await json(c.req.raw, z.object({ code: z.string().min(1).max(32) }))
    if (isBlocked('pair-fail:global', PAIR_FAIL_LIMIT)) throw new HTTPException(429, { message: 'slow down' })
    if (!codesMatch(code, deps.env.pairingCode)) {
      recordFailure('pair-fail:global', PAIR_FAIL_WINDOW_MS)
      throw new HTTPException(401, { message: 'bad code' })
    }
    const [ins] = await db.select().from(instructors).limit(1)
    if (!ins) throw new HTTPException(500, { message: 'no instructor seeded' })
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
    const hashes = [...ins.tokenHashes, await hashToken(token)].slice(-MAX_TOKENS)
    await db.update(instructors).set({ tokenHashes: hashes }).where(eq(instructors.id, ins.id))
    return c.json({ token })
  })

  app.use('/v1/*', async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new HTTPException(401, { message: 'missing token' })
    const [ins] = await db.select({ id: instructors.id }).from(instructors).where(sql`${instructors.tokenHashes} @> ${JSON.stringify([await hashToken(token)])}::jsonb`)
    if (!ins) throw new HTTPException(401, { message: 'bad token' })
    c.set('instructorId', ins.id)
    await next()
  })

  app.get('/v1/today', async c => c.json(await getToday(deps)))

  app.post('/v1/sessions', async c => {
    const { classId } = await json(c.req.raw, z.object({ classId: z.string().min(1) }))
    return c.json(await startSession(deps, classId))
  })

  app.post('/v1/sessions/:id/attendance', async c => {
    const { presentIds } = await json(c.req.raw, z.object({ presentIds: z.array(z.string()) }))
    const sessionId = c.req.param('id')
    await requireSession(db, sessionId)
    const ctx = await loadSessionContext(db, sessionId, null)
    for (const s of ctx.roster) {
      const status = presentIds.includes(s.id) ? 'present' : 'absent'
      await db.insert(attendance).values({ sessionId, studentId: s.id, status, source: 'phone' })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'phone' } })
    }
    return c.json(await computeCoverage(db, ctx))
  })

  app.post('/v1/sessions/:id/end', async c => c.json(await endSession(deps, c.req.param('id'))))

  app.post('/v1/sessions/:id/remind', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(30) }))
    const s = await requireSession(db, c.req.param('id'))
    await db.update(classes).set({ remindIds: studentIds }).where(eq(classes.id, s.classId))
    return c.json({ ok: true })
  })

  app.post('/v1/sessions/:id/drills/:drillId/:event', async c => {
    const event = z.enum(['start', 'end']).safeParse(c.req.param('event'))
    if (!event.success) throw new HTTPException(400, { message: 'bad event' })
    await logDrill(deps, c.req.param('id'), c.req.param('drillId'), event.data)
    return c.json({ ok: true })
  })

  app.post('/v1/utterance', async c => {
    if (!allow(`utt:${c.get('instructorId')}`, 120)) {
      c.header('Retry-After', '10')
      throw new HTTPException(429, { message: 'slow down' })
    }
    if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_BYTES + 65536) throw new HTTPException(413, { message: 'audio too large' })
    let body: Awaited<ReturnType<typeof c.req.parseBody>>
    try { body = await c.req.parseBody() } catch { throw new HTTPException(400, { message: 'invalid multipart' }) }
    const str = (k: string) => (typeof body[k] === 'string' && body[k] !== '' ? (body[k] as string) : null)
    const form = UtteranceForm.safeParse({ sessionId: str('sessionId'), drillId: str('drillId'), mode: str('mode'), text: str('text') })
    if (!form.success) throw new HTTPException(400, { message: 'invalid utterance form' })
    const ctx = await loadSessionContext(db, (await requireSession(db, form.data.sessionId)).id, null)
    let transcript = form.data.text
    const audio = body['audio']
    if (!transcript && audio instanceof File) {
      if (audio.size > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'audio too large' })
      transcript = (await deps.stt.transcribe(new Uint8Array(await audio.arrayBuffer()), ctx.roster.map(r => r.name))).trim()
    }
    if (!transcript) throw new HTTPException(422, { message: 'empty_transcript' })
    return c.json(await handleUtterance(deps, { sessionId: form.data.sessionId, drillId: form.data.drillId, mode: form.data.mode, transcript }))
  })

  app.post('/v1/utterances/:id/undo', async c => {
    const id = c.req.param('id')
    const [n] = await db.select({ sessionId: notes.sessionId }).from(notes).where(eq(notes.utteranceId, id)).limit(1)
    await db.delete(notes).where(eq(notes.utteranceId, id))
    await db.delete(billingFlags).where(eq(billingFlags.utteranceId, id))
    const coverage = n?.sessionId ? await computeCoverage(db, await loadSessionContext(db, n.sessionId, null)) : null
    return c.json({ coverage })
  })

  app.post('/v1/notes/:id/assign', async c => {
    const { studentId } = await json(c.req.raw, z.object({ studentId: z.string().min(1) }))
    const [n] = await db.select().from(notes).where(eq(notes.id, c.req.param('id')))
    if (!n) throw new HTTPException(404, { message: 'note not found' })
    if (n.sessionId) {
      const [en] = await db.select().from(enrollments).innerJoin(sessions, eq(sessions.classId, enrollments.classId))
        .where(and(eq(sessions.id, n.sessionId), eq(enrollments.studentId, studentId)))
      if (!en) throw new HTTPException(400, { message: 'student not in class' })
    } else {
      const [st] = await db.select().from(students).where(inArray(students.id, [studentId]))
      if (!st) throw new HTTPException(400, { message: 'unknown student' })
    }
    await db.update(notes).set({ studentId }).where(eq(notes.id, n.id))
    if (!n.sessionId) return c.json({ coverage: null, nextStudent: null })
    await markPresent(db, n.sessionId, studentId, 'backstop')
    const ctx = await loadSessionContext(db, n.sessionId, null)
    return c.json({ coverage: await computeCoverage(db, ctx), nextStudent: await nextStudentFor(db, ctx, deps.now()) })
  })

  const mapped = (c: Context, r: ActionResult) => {
    if (r.ok) return c.json({ ok: true })
    throw new HTTPException(r.code === 'not_found' ? 404 : 409, { message: r.error })
  }
  app.get('/v1/review', async c => c.json(await listReview(db)))
  app.post('/v1/review/outbox/approve-all', async c => {
    const { ids } = await json(c.req.raw, z.object({ ids: z.array(z.string().min(1)).min(1).max(50) }))
    return c.json(await approveAllOutbox(deps, ids))
  })
  app.post('/v1/review/outbox/:id/approve', async c => {
    const edits = await json(c.req.raw, z.object({ subject: z.string().min(1).max(120).optional(), body: z.string().min(1).max(5000).optional() }))
    const r = await approveOutbox(deps, c.req.param('id'), edits)
    if (r.ok) return c.json(r)
    return c.json(r, r.code === 'not_found' ? 404 : r.code === 'not_pending' ? 409 : 502)
  })
  app.post('/v1/review/outbox/:id/skip', async c => mapped(c, await skipOutbox(db, c.req.param('id'))))
  app.post('/v1/review/billing/:id/handle', async c => {
    const { note } = await json(c.req.raw, z.object({ note: z.string().max(500).optional() }))
    return mapped(c, await handleBilling(db, c.req.param('id'), note))
  })
  app.post('/v1/review/billing/:id/note', async c => {
    const { note } = await json(c.req.raw, z.object({ note: z.string().min(1).max(500) }))
    return mapped(c, await noteBilling(db, c.req.param('id'), note))
  })
  app.post('/v1/notes/:id/dismiss', async c => mapped(c, await dismissNote(db, c.req.param('id'))))

  // Missing resources are 404, lost races are 409, bad references are 400.
  const httpErr = (e: unknown): never => {
    if (e instanceof HTTPException) throw e
    const m = e instanceof Error ? e.message : ''
    if (/not found$/.test(m) || /^deck .* not found/.test(m)) throw new HTTPException(404, { message: m })
    if (/not pending$/.test(m)) throw new HTTPException(409, { message: m })
    if (/^drills not in deck|^duplicate drill ids/.test(m)) throw new HTTPException(400, { message: m })
    if (/^planner unavailable/.test(m)) throw new HTTPException(502, { message: m })
    throw e
  }
  const guard = async <T>(p: Promise<T>): Promise<T> => p.catch(httpErr)

  app.get('/jobs/plan', async c => {
    if (!deps.env.cronSecret || !codesMatch(c.req.header('authorization') ?? '', `Bearer ${deps.env.cronSecret}`)) throw new HTTPException(401, { message: 'cron only' })
    const today = localDate(deps.now(), deps.env.timeZone)
    let drafted = 0
    let failed = 0
    for (const cl of await db.select().from(classes)) {
      try { if (await nextDeckFor(deps, cl.id, today)) drafted++ } catch (e) {
        failed++
        console.error('[jobs/plan] class failed', cl.id, e)
      }
    }
    return c.json({ drafted, failed })
  })

  app.get('/v1/decks/:id', async c => c.json(await guard(getDeck(db, c.req.param('id')))))
  app.patch('/v1/decks/:id', async c => c.json(await guard(patchDeck(db, c.req.param('id'), await json(c.req.raw, DeckPatch)))))
  app.post('/v1/decks/:id/suggest', async c => {
    const { text } = await json(c.req.raw, z.object({ text: z.string().min(2).max(500) }))
    const deck = await guard(getDeck(db, c.req.param('id')))
    const s = await suggestDiff(deps, deck.id, text)
    if (!s) throw new HTTPException(502, { message: 'planner unavailable' })
    return c.json({ diffId: s.diffId, diff: s.diff, totalBefore: totalMinutes(deck.drills), totalAfter: totalMinutes(applyDiff(deck.drills, s.diff)) })
  })
  app.post('/v1/diffs/:id/accept', async c => {
    const { remember } = await json(c.req.raw, z.object({ remember: z.boolean() }))
    return c.json(await guard(acceptDiff(deps, c.req.param('id'), { remember })))
  })
  app.post('/v1/diffs/:id/undo', async c => { await undoDiff(db, c.req.param('id')); return c.json({ ok: true }) })
  app.post('/v1/drills/:id/alternatives', async c => c.json({ alternatives: await guard(alternativesFor(deps, c.req.param('id'))) }))

  app.get('/jobs/report-cards', async c => {
    if (!deps.env.cronSecret || !codesMatch(c.req.header('authorization') ?? '', `Bearer ${deps.env.cronSecret}`)) throw new HTTPException(401, { message: 'cron only' })
    return c.json(await runReportCards(deps))
  })
  app.get('/v1/students', async c => c.json(await listStudents(db)))
  app.get('/v1/students/:id', async c => c.json(await guard(getStudentDetail(deps, c.req.param('id')))))
  app.get('/v1/agents/feed', async c => {
    const since = c.req.query('since')
    const d = since ? new Date(since) : null
    if (d && Number.isNaN(d.getTime())) throw new HTTPException(400, { message: 'bad since' })
    return c.json(await agentFeed(db, d))
  })
  app.post('/v1/report-cards/run', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(50).optional() }))
    deps.defer(runReportCards(deps, studentIds))
    return c.json({ started: studentIds?.length ?? (await listStudents(db)).length })
  })

  return app
}
