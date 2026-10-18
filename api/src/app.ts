import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { AgentTask, InsightsQuery, DeckPatch, ReplaceDeckRequest, VoicePlanRequest, SettingsPatch, ExtractRequest, MAX_ALIASES, MetricCreate, MAX_IMAGE_BASE64, MAX_ONBOARDING_TEXT, OnboardingCommit, RedraftRequest, TranscribeForm, UtteranceForm, type UtteranceResponse } from '@matside/shared'
import { SttUnavailableError, type Deps } from './deps'
import { getStatus } from './services/status'
import { attendance, billingFlags, drills, enrollments, instructors, insights as insightsTable, notes, sessions, students, classes, utterances } from './db/schema'
import { runAs } from './http/context'
import { authenticate, DEV_PAIRING_PEPPER, instructorForCode, issueToken, revokeOtherTokens, revokeToken, rotatePairingCode, syncEnvPairingCode } from './services/pairing'
import { bump, clientIp, IP_LIMIT, PREFIX_LIMIT, prefixBucket, unbump } from './services/pairLimits'
import {
  insightOwnedBy, ownedStudentIds, ownsAgentRun, ownsBilling, ownsClass, ownsDeck, ownsDiff, ownsDrill, ownsInsight,
  ownsMetric, ownsNote, ownsOutbox, ownsSession, ownsStudent, ownsUtterance,
} from './services/ownership'
import { timingSafeEqual } from 'node:crypto'
import { allow } from './http/rateLimit'
import { getToday, listClasses } from './services/today'
import { endSession, logDrill, requireSession, startSession } from './services/sessions'
import { handleUtterance } from './services/utterance'
import { hintsFor } from './services/hints'
import { listReview, approveOutbox, skipOutbox, approveAllOutbox, handleBilling, noteBilling, dismissNote, type ActionResult } from './services/review'
import { getDeck, patchDeck } from './services/decks'
import { runReportCards } from './agents/reportCard'
import { buildBrief } from './services/brief'
import { applyRank, deleteMetric, recordMetric, toMetricView } from './services/metrics'
import { isGradeMetric } from './logic/metrics'
import { modeForStudent } from './services/context'
import { agentFeed, getStudentDetail, listStudents } from './services/students'
import { replaceDeck, voicePlan, VoicePlanError } from './agents/planEdit'
import { acceptDiff, alternativesFor, nextDeckFor, suggestDiff, undoDiff } from './agents/planner'
import { applyDiff, totalMinutes } from './logic/deckDiff'
import { addAlias } from './logic/names'
import { draftParentEmail } from './agents/parentEmail'
import { redraftOutbox } from './agents/redraft'
import { ClassCreate, ClassLiveError, ClassUpdate, StudentCreate, StudentUpdateBody, createClass, createStudent, deleteClass, deleteStudent, noteCandidates, studentView, updateClass, updateStudent } from './services/roster'
import { claimOperation, completeOperation, MAX_KEY, opEntityId, releaseOperation } from './services/operations'
import { undoUtterance, UndoError } from './services/undo'
import { deferOnce } from './services/deferred'
import { recordAttendance } from './services/ledger'
import { agentRunDetail, agentTaskRuns, agentsSummary, utteranceRuns } from './services/agents'
import { localDate, upcomingClassDate } from './logic/dates'
import { computeCoverage, coverageAndNext, loadSessionContext, markPresent, nextStudentFor } from './services/context'
import { extractOnboarding } from './agents/onboarding'
import { BudgetExceededError } from './agents/budget'
import { getSettings, patchSettings, SettingsError } from './services/settings'
import { commitOnboarding, onboardingStatus, OnboardingError } from './services/onboarding'
import { acceptInsight, dismissInsight, insightsOnAttendance, InsightsError, listInsights, runInsights, type InsightActResult } from './services/insights'

type Vars = { Variables: { instructorId: string; tokenId: string } }
const MAX_AUDIO_BYTES = 2_000_000
const MAX_EXTRACT_BYTES = MAX_IMAGE_BASE64 + MAX_ONBOARDING_TEXT * 4 + 4096

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
    allowHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposeHeaders: ['Idempotent-Replay'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  }))

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error('[api]', c.req.method, c.req.path, err)
    return c.json({ error: 'internal_error' }, 500)
  })

  app.get('/health', c => c.json({ ok: true }))

  const pepper = deps.env.pairingPepper ?? DEV_PAIRING_PEPPER
  // Once per process: the demo instructor's code follows a changed PAIRING_CODE (see syncEnvPairingCode).
  let envSynced: Promise<void> | null = null
  app.post('/pair', async c => {
    const { code } = await json(c.req.raw, z.object({ code: z.string().min(1).max(32) }))
    envSynced ??= syncEnvPairingCode(db, deps.env.pairingCode, pepper).catch(e => { envSynced = null; console.error('[pair:sync]', e) })
    await envSynced
    // S1: the attempt is counted (in the database) before the lookup; a blocked IP is refused without a lookup.
    const ipBucket = `ip:${clientIp(k => c.req.header(k))}`
    if (await bump(db, ipBucket, deps.now()) > IP_LIMIT) throw new HTTPException(429, { message: 'slow down' })
    // C4: a code pairs to exactly one instructor (keyed hash lookup); no "first instructor" fallback.
    const instructorId = await instructorForCode(db, code, deps.env.pairingCode, pepper)
    if (instructorId) {
      await unbump(db, ipBucket)
      return c.json({ token: await issueToken(db, instructorId, deps.now()) })
    }
    // The shared prefix bucket only ever refuses codes that do not match.
    const many = await bump(db, prefixBucket(code), deps.now()) > PREFIX_LIMIT
    throw new HTTPException(many ? 429 : 401, { message: many ? 'slow down' : 'bad code' })
  })

  app.use('/v1/*', async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new HTTPException(401, { message: 'missing token' })
    const auth = await authenticate(db, token, deps.now()) // expired or revoked: 401, the client re-pairs
    if (!auth) throw new HTTPException(401, { message: 'bad token' })
    c.set('instructorId', auth.instructorId)
    c.set('tokenId', auth.tokenId)
    await runAs(auth.instructorId, () => next())
  })

  /** C4 ownership guard: another instructor's entity (or a missing one) is a 404. */
  const need = async (owned: Promise<boolean>, what: string) => {
    if (!(await owned)) throw new HTTPException(404, { message: `${what} not found` })
  }
  const me = (c: Context<Vars>) => c.get('instructorId')

  app.post('/v1/unpair', async c => {
    await revokeToken(db, c.get('tokenId'), deps.now())
    return c.json({ ok: true })
  })
  /** Owner action: a fresh reusable code, returned once (only its hash is stored). Paired phones stay paired. */
  // { revokeOthers: true } also signs out every other phone (S3: a lost or stolen phone).
  app.post('/v1/pairing/rotate', async c => {
    const body = await json(c.req.raw, z.object({ revokeOthers: z.boolean().optional() }).catch({}))
    const code = await rotatePairingCode(db, me(c), pepper)
    const revoked = body.revokeOthers ? await revokeOtherTokens(db, me(c), c.get('tokenId'), deps.now()) : 0
    return c.json({ code, ...(body.revokeOthers ? { revoked } : {}) })
  })
  /** S3: signs out every phone of this instructor except the calling one. */
  app.post('/v1/tokens/revoke-others', async c => c.json({ ok: true, revoked: await revokeOtherTokens(db, me(c), c.get('tokenId'), deps.now()) }))


  /** Degraded-mode status: AI calls left today (Anthropic calls only) and whether speech-to-text is configured. */
  app.get('/v1/status', async c => c.json(await getStatus(deps)))

  app.post('/v1/sessions', async c => {
    const { classId } = await json(c.req.raw, z.object({ classId: z.string().min(1) }))
    await need(ownsClass(db, me(c), classId), 'class')
    return c.json(await startSession(deps, classId))
  })

  app.post('/v1/sessions/:id/attendance', async c => {
    const { presentIds } = await json(c.req.raw, z.object({ presentIds: z.array(z.string()) }))
    const sessionId = c.req.param('id')
    await need(ownsSession(db, me(c), sessionId), 'session')
    const session = await requireSession(db, sessionId)
    const ctx = await loadSessionContext(db, sessionId, null)
    for (const s of ctx.roster) {
      const status = presentIds.includes(s.id) ? 'present' : 'absent'
      await db.insert(attendance).values({ sessionId, studentId: s.id, status, source: 'phone' })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'phone' } })
    }
    if (!session.endedAt) insightsOnAttendance(deps, { sessionId, classId: session.classId, forDate: session.forDate })
    return c.json(await computeCoverage(db, ctx))
  })

  app.post('/v1/sessions/:id/end', async c => {
    await need(ownsSession(db, me(c), c.req.param('id')), 'session')
    return c.json(await endSession(deps, c.req.param('id')))
  })

  app.post('/v1/sessions/:id/remind', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(30) }))
    await need(ownsSession(db, me(c), c.req.param('id')), 'session')
    const s = await requireSession(db, c.req.param('id'))
    // Only students on this class's roster (never another class's or instructor's ids).
    const roster = new Set((await db.select({ id: enrollments.studentId }).from(enrollments).where(eq(enrollments.classId, s.classId))).map(r => r.id))
    await db.update(classes).set({ remindIds: [...new Set(studentIds)].filter(id => roster.has(id)) }).where(eq(classes.id, s.classId))
    return c.json({ ok: true })
  })

  app.post('/v1/sessions/:id/drills/:drillId/:event', async c => {
    const event = z.enum(['start', 'end']).safeParse(c.req.param('event'))
    if (!event.success) throw new HTTPException(400, { message: 'bad event' })
    await need(ownsSession(db, me(c), c.req.param('id')), 'session')
    await logDrill(deps, c.req.param('id'), c.req.param('drillId'), event.data)
    return c.json({ ok: true })
  })

  /**
   * Shared by /v1/utterance and /v1/transcribe: per-instructor rate limit (own bucket per route),
   * the request size cap, and the multipart parse. `audio()` applies the audio size cap.
   */
  const audioUpload = async (c: Context<Vars>, bucket: string) => {
    if (!allow(`${bucket}:${c.get('instructorId')}`, 120)) {
      c.header('Retry-After', '10')
      throw new HTTPException(429, { message: 'slow down' })
    }
    if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_BYTES + 65536) throw new HTTPException(413, { message: 'audio too large' })
    let body: Awaited<ReturnType<typeof c.req.parseBody>>
    try { body = await c.req.parseBody() } catch { throw new HTTPException(400, { message: 'invalid multipart' }) }
    const str = (k: string) => (typeof body[k] === 'string' && body[k] !== '' ? (body[k] as string) : null)
    const audio = (): File | null => {
      const a = body['audio']
      if (!(a instanceof File)) return null
      if (a.size > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'audio too large' })
      return a
    }
    return { str, audio }
  }
  const transcribe = async (audio: File, hints: string[]) => {
    try {
      return (await deps.stt.transcribe(new Uint8Array(await audio.arrayBuffer()), hints)).trim()
    } catch (e) {
      if (e instanceof SttUnavailableError) throw new HTTPException(503, { message: 'stt_not_configured' })
      throw e
    }
  }

  const isUniqueViolation = (e: unknown): boolean => {
    const code = (x: unknown) => (x && typeof x === 'object' && 'code' in x ? (x as { code: unknown }).code : null)
    return code(e) === '23505' || code((e as { cause?: unknown })?.cause) === '23505'
  }
  const utteranceExists = async (id: string) => (await db.select({ id: utterances.id }).from(utterances).where(eq(utterances.id, id))).length > 0
  /** The reply for an utterance an earlier attempt committed (its card lines are not replayed; its actions stand). */
  const savedUtterance = async (id: string): Promise<UtteranceResponse> => {
    const [u] = await db.select().from(utterances).where(eq(utterances.id, id))
    const ctx = await loadSessionContext(db, u!.sessionId!, null)
    const { coverage, next } = await coverageAndNext(db, ctx, deps.now())
    return { utteranceId: id, transcript: u!.transcript, cardLines: ['√ Already saved'], coverage, nextStudent: next, disambiguation: null }
  }

  /** C1: the stable operation id, from the Idempotency-Key header or the multipart field `opId`. */
  const opKey = (c: Context<Vars>, str: (k: string) => string | null): string | null => {
    const key = c.req.header('idempotency-key')?.trim() || str('opId')
    if (key && (key.length > MAX_KEY || !/^[\w.:-]+$/.test(key))) throw new HTTPException(400, { message: 'bad idempotency key' })
    return key || null
  }
  /** C1: runs `work` once per key; a done key replays its stored response, a pending one is 409 in_progress. */
  const once = async (c: Context<Vars>, key: string | null, route: string, work: () => Promise<unknown>) => {
    // Scoped by route (the same opId on transcribe and utterance are two operations).
    if (!key) return c.json(await work() as object)
    const claim = await claimOperation(db, me(c), key, route, deps.now())
    // The response is stored as its exact JSON text, so a replay is byte-identical to the lost original.
    if (claim.kind === 'replay') {
      c.header('Idempotent-Replay', 'true')
      return c.body(String(claim.response), 200, { 'Content-Type': 'application/json' })
    }
    if (claim.kind === 'in_progress') throw new HTTPException(409, { message: 'in_progress' })
    try {
      const text = JSON.stringify(await work())
      await completeOperation(db, me(c), key, route, text)
      return c.body(text, 200, { 'Content-Type': 'application/json' })
    } catch (e) {
      await releaseOperation(db, me(c), key, route).catch(() => {})
      throw e
    }
  }

  app.post('/v1/utterance', async c => {
    const { str, audio } = await audioUpload(c, 'utt')
    const form = UtteranceForm.safeParse({ sessionId: str('sessionId'), drillId: str('drillId'), mode: str('mode'), text: str('text') })
    if (!form.success) throw new HTTPException(400, { message: 'invalid utterance form' })
    await need(ownsSession(db, me(c), form.data.sessionId), 'session')
    const session = await requireSession(db, form.data.sessionId)
    if (form.data.drillId) {
      const [dr] = await db.select({ id: drills.id }).from(drills).where(and(eq(drills.id, form.data.drillId), eq(drills.deckId, session.deckId)))
      if (!dr) throw new HTTPException(400, { message: 'drill not in this class plan' })
    }
    const file = form.data.text ? null : audio()
    const key = opKey(c, str)
    const utteranceId = key ? opEntityId(me(c), 'utterance', key) : undefined
    return once(c, key, 'utterance', async () => {
      // A re-run after a crash or a 5xx that already committed this utterance answers from it instead of repeating it.
      if (utteranceId && await utteranceExists(utteranceId)) return savedUtterance(utteranceId)
      let transcript = form.data.text
      if (file) transcript = await transcribe(file, await hintsFor(db, { sessionId: form.data.sessionId }))
      if (!transcript) throw new HTTPException(422, { message: 'empty_transcript' })
      try {
        return await handleUtterance(deps, { sessionId: form.data.sessionId, drillId: form.data.drillId, mode: form.data.mode, transcript, utteranceId })
      } catch (e) {
        // Only a duplicate insert (a concurrent run with the same id won) is answered from the saved utterance;
        // any other failure is a real 5xx, and the retry answers from whatever the first attempt committed.
        if (utteranceId && isUniqueViolation(e) && await utteranceExists(utteranceId)) return savedUtterance(utteranceId)
        throw e
      }
    })
  })

  /** Transcript-first: STT only (nothing saved). The lens then sends the text as an utterance. */
  app.post('/v1/transcribe', async c => {
    const { str, audio } = await audioUpload(c, 'stt')
    const form = TranscribeForm.safeParse({ sessionId: str('sessionId'), classId: str('classId') })
    if (!form.success) throw new HTTPException(400, { message: 'invalid transcribe form' })
    const file = audio()
    if (!file) throw new HTTPException(400, { message: 'missing audio' })
    if (form.data.sessionId) await need(ownsSession(db, me(c), form.data.sessionId), 'session')
    if (form.data.classId) await need(ownsClass(db, me(c), form.data.classId), 'class')
    return once(c, opKey(c, str), 'transcribe', async () => {
      const transcript = await transcribe(file, await hintsFor(db, form.data))
      if (!transcript) throw new HTTPException(422, { message: 'empty_transcript' })
      return { transcript }
    })
  })

  app.post('/v1/utterances/:id/undo', async c => {
    const id = c.req.param('id')
    await need(ownsUtterance(db, me(c), id), 'utterance')
    // C2: { ok, reversed, cancelled, notReversible } (+ coverage for the lens); a second Undo is 409 already_undone.
    try { return c.json(await undoUtterance(deps, id)) } catch (e) {
      if (e instanceof UndoError) throw new HTTPException(e.code === 'not_found' ? 404 : 409, { message: e.code })
      throw e
    }
  })

  app.get('/v1/utterances/:id/runs', async c => {
    await need(ownsUtterance(db, me(c), c.req.param('id')), 'utterance')
    return c.json(await utteranceRuns(db, c.req.param('id')))
  })

  app.post('/v1/notes/:id/assign', async c => {
    const { studentId } = await json(c.req.raw, z.object({ studentId: z.string().min(1) }))
    await need(ownsNote(db, me(c), c.req.param('id')), 'note')
    const [n] = await db.select().from(notes).where(eq(notes.id, c.req.param('id')))
    if (!n) throw new HTTPException(404, { message: 'note not found' })
    if (n.sessionId) {
      const [en] = await db.select().from(enrollments).innerJoin(sessions, eq(sessions.classId, enrollments.classId))
        .where(and(eq(sessions.id, n.sessionId), eq(enrollments.studentId, studentId)))
      if (!en) throw new HTTPException(400, { message: 'student not in class' })
    } else {
      if (!await ownsStudent(db, me(c), studentId)) throw new HTTPException(400, { message: 'unknown student' })
    }
    await db.update(notes).set({ studentId }).where(eq(notes.id, n.id))
    if (n.heard) await learnAlias(studentId, n.heard)
    // An urgent note that was waiting for a student now drafts its urgent note home.
    if (n.urgent && !n.studentId) {
      await deferOnce(deps, { utteranceId: n.utteranceId, kind: 'parent_email', subject: studentId },
        () => draftParentEmail(deps, { studentId, sessionId: n.sessionId, utteranceId: n.utteranceId, trigger: { kind: 'urgent', content: n.text } }))
    }
    if (!n.sessionId) return c.json({ coverage: null, nextStudent: null })
    await recordAttendance(db, n.utteranceId, n.sessionId, [{ studentId, status: 'present', source: 'backstop' }]) // C2: the note's Undo restores this too
    await markPresent(db, n.sessionId, studentId, 'backstop')
    const ctx = await loadSessionContext(db, n.sessionId, null)
    return c.json({ coverage: await computeCoverage(db, ctx), nextStudent: await nextStudentFor(db, ctx, deps.now()) })
  })

  /** Remember how STT heard a student's name once the coach assigns the note (deduped, max 10). */
  const learnAlias = async (studentId: string, heard: string) => {
    const [st] = await db.select({ name: students.name, nickname: students.nickname, aliases: students.aliases }).from(students).where(eq(students.id, studentId))
    if (!st) return
    const next = addAlias(st, heard, MAX_ALIASES)
    if (next !== st.aliases) await db.update(students).set({ aliases: next }).where(eq(students.id, studentId))
  }

  const mapped = (c: Context, r: ActionResult) => {
    if (r.ok) return c.json({ ok: true })
    throw new HTTPException(r.code === 'not_found' ? 404 : 409, { message: r.error })
  }
  app.get('/v1/review', async c => c.json(await listReview(db, me(c))))
  app.post('/v1/review/outbox/approve-all', async c => {
    const { ids } = await json(c.req.raw, z.object({ ids: z.array(z.string().min(1)).min(1).max(50) }))
    const uniq = [...new Set(ids)]
    const owned = (await Promise.all(uniq.map(async id => ((await ownsOutbox(db, me(c), id)) ? id : null)))).filter((x): x is string => x !== null)
    const r = await approveAllOutbox(deps, owned)
    return c.json({ sent: r.sent, failed: r.failed + uniq.length - owned.length })
  })
  app.use('/v1/review/outbox/:id/*', async (c, next) => { await need(ownsOutbox(db, me(c), c.req.param('id')!), 'email'); await next() })
  app.use('/v1/review/billing/:id/*', async (c, next) => { await need(ownsBilling(db, me(c), c.req.param('id')!), 'billing flag'); await next() })
  app.post('/v1/review/outbox/:id/approve', async c => {
    const edits = await json(c.req.raw, z.object({ subject: z.string().min(1).max(120).optional(), body: z.string().min(1).max(5000).optional() }))
    const r = await approveOutbox(deps, c.req.param('id'), edits)
    if (r.ok) return c.json(r)
    return c.json(r, r.code === 'not_found' ? 404 : r.code === 'not_pending' ? 409 : 502)
  })
  app.post('/v1/review/outbox/:id/redraft', async c => {
    const { instruction } = await json(c.req.raw, RedraftRequest)
    const r = await redraftOutbox(deps, c.req.param('id'), instruction)
    if (r.ok) return c.json(r.item)
    throw new HTTPException(r.code === 'not_found' ? 404 : r.code === 'not_pending' ? 409 : 502, { message: r.error })
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
  app.post('/v1/notes/:id/dismiss', async c => {
    await need(ownsNote(db, me(c), c.req.param('id')), 'note')
    return mapped(c, await dismissNote(db, c.req.param('id')))
  })

  // Missing resources are 404, lost races are 409, bad references are 400.
  const httpErr = (e: unknown): never => {
    if (e instanceof HTTPException) throw e
    const m = e instanceof Error ? e.message : ''
    if (/not found$/.test(m) || /^deck .* not found/.test(m)) throw new HTTPException(404, { message: m })
    if (/not pending$/.test(m)) throw new HTTPException(409, { message: m })
    if (/^drills not in deck|^duplicate drill ids/.test(m)) throw new HTTPException(400, { message: m })
    if (/^class started|^plan changed since|^previous plan not found/.test(m)) throw new HTTPException(/^(class started|plan changed since)/.test(m) ? 409 : 404, { message: m })
    if (/^planner unavailable/.test(m)) throw new HTTPException(502, { message: m })
    throw e
  }
  const guard = async <T>(p: Promise<T>): Promise<T> => p.catch(httpErr)

  app.get('/v1/classes', async c => c.json(await listClasses(db, me(c))))
  app.get('/v1/today', async c => {
    const classId = c.req.query('classId')
    if (classId !== undefined && (classId.length < 1 || classId.length > 64)) throw new HTTPException(400, { message: 'bad classId' })
    return c.json(await guard(getToday(deps, classId, me(c))))
  })

  app.get('/jobs/plan', async c => {
    if (!deps.env.cronSecret || !codesMatch(c.req.header('authorization') ?? '', `Bearer ${deps.env.cronSecret}`)) throw new HTTPException(401, { message: 'cron only' })
    const today = localDate(deps.now(), deps.env.timeZone)
    let drafted = 0
    let failed = 0
    for (const cl of await db.select().from(classes)) {
      try { if (await runAs(cl.instructorId, () => nextDeckFor(deps, cl.id, today))) drafted++ } catch (e) {
        failed++
        console.error('[jobs/plan] class failed', cl.id, e)
      }
    }
    // Daily opportunistic pass (after the plans, so a plan_focus auto action finds next class's deck).
    // Per instructor (C4): each pass sees only that instructor's students and settings.
    let insights = 0
    for (const ins of await db.select({ id: instructors.id }).from(instructors)) {
      insights += await runAs(ins.id, () => runInsights(deps, { trigger: 'cron' })).then(r => r.length).catch(e => { console.error('[jobs/plan] insights failed', ins.id, e); return 0 })
    }
    return c.json({ drafted, failed, insights })
  })

  app.use('/v1/decks/:id', async (c, next) => { await need(ownsDeck(db, me(c), c.req.param('id')!), 'deck'); await next() })
  app.use('/v1/decks/:id/*', async (c, next) => { await need(ownsDeck(db, me(c), c.req.param('id')!), 'deck'); await next() })
  app.use('/v1/diffs/:id/*', async (c, next) => { await need(ownsDiff(db, me(c), c.req.param('id')!), 'diff'); await next() })
  app.use('/v1/drills/:id/*', async (c, next) => { await need(ownsDrill(db, me(c), c.req.param('id')!), 'drill'); await next() })
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
  app.post('/v1/diffs/:id/undo', async c => { await guard(undoDiff(db, c.req.param('id'))); return c.json({ ok: true }) })
  app.post('/v1/decks/:id/replace', async c => {
    const { source } = await json(c.req.raw, ReplaceDeckRequest)
    if (typeof source === 'object' && 'deckId' in source) await need(ownsDeck(db, me(c), source.deckId), 'deck')
    if (typeof source === 'object' && 'classId' in source) await need(ownsClass(db, me(c), source.classId), 'class')
    return c.json(await guard(replaceDeck(deps, c.req.param('id'), source)))
  })
  app.post('/v1/plan/voice', async c => {
    const body = await json(c.req.raw, VoicePlanRequest)
    await need(ownsClass(db, me(c), body.classId), 'class')
    try { return c.json(await voicePlan(deps, body.classId, body.transcript)) } catch (e) {
      if (e instanceof VoicePlanError) {
        if (e.code === 'not_found') throw new HTTPException(404, { message: 'class not found' })
        if (e.code === 'budget') throw new HTTPException(429, { message: 'ai_budget_reached' })
        throw new HTTPException(502, { message: 'planner unavailable' })
      }
      throw e
    }
  })
  app.post('/v1/drills/:id/alternatives', async c => c.json({ alternatives: await guard(alternativesFor(deps, c.req.param('id'))) }))

  app.get('/jobs/report-cards', async c => {
    if (!deps.env.cronSecret || !codesMatch(c.req.header('authorization') ?? '', `Bearer ${deps.env.cronSecret}`)) throw new HTTPException(401, { message: 'cron only' })
    let drafted = 0
    for (const ins of await db.select({ id: instructors.id }).from(instructors)) {
      drafted += (await runAs(ins.id, async () => runReportCards(deps, await ownedStudentIds(db, ins.id)))).drafted
    }
    return c.json({ drafted })
  })
  app.get('/v1/students', async c => c.json(await listStudents(db, me(c))))
  app.use('/v1/students/:id', async (c, next) => { await need(ownsStudent(db, me(c), c.req.param('id')!), 'student'); await next() })
  app.use('/v1/students/:id/*', async (c, next) => { await need(ownsStudent(db, me(c), c.req.param('id')!), 'student'); await next() })
  app.get('/v1/students/:id', async c => {
    const id = c.req.param('id')
    const [detail, view] = await Promise.all([guard(getStudentDetail(deps, id)), studentView(db, id)])
    // C3: the edit screen also needs the guardians and class memberships.
    return c.json({ ...detail, nickname: view?.nickname ?? null, aliases: view?.aliases ?? [], guardians: view?.guardians ?? [], classIds: view?.classIds ?? [] })
  })
  app.get('/v1/students/:id/brief', async c => {
    const id = c.req.param('id')
    return c.json(await guard(modeForStudent(db, id).then(m => buildBrief(db, id, m, deps.now(), deps.env.timeZone))))
  })
  // ---- C3: roster maintenance (ownership checked by the /v1/students/:id middleware) ----
  const ownAllClasses = async (c: Context<Vars>, ids: string[] | undefined) => {
    for (const id of new Set(ids ?? [])) await need(ownsClass(db, me(c), id), 'class')
  }
  app.post('/v1/students', async c => {
    const body = await json(c.req.raw, StudentCreate)
    await ownAllClasses(c, body.classIds)
    const year = Number(localDate(deps.now(), deps.env.timeZone).slice(0, 4))
    return c.json(await createStudent(db, me(c), body, year), 201)
  })
  app.patch('/v1/students/:id', async c => {
    const id = c.req.param('id')
    const patch = await json(c.req.raw, StudentUpdateBody)
    await ownAllClasses(c, patch.classIds)
    await updateStudent(db, me(c), id, patch)
    const view = (await studentView(db, id))!
    // Roster edits echo the whole student; alias / belt / rankSince edits keep their original reply shape.
    if (patch.name !== undefined || patch.nickname !== undefined || patch.classIds || patch.guardians) return c.json(view)
    return c.json({ id: view.id, aliases: view.aliases, ...(patch.belt !== undefined ? { belt: view.belt } : {}), ...(patch.rankSince !== undefined ? { rankSince: view.rankSince } : {}) })
  })
  app.delete('/v1/students/:id', async c => {
    await deleteStudent(db, c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/v1/notes/:id/candidates', async c => {
    await need(ownsNote(db, me(c), c.req.param('id')), 'note')
    const r = await noteCandidates(db, c.req.param('id'))
    if (!r) throw new HTTPException(404, { message: 'note not found' })
    if (r === 'no_class') throw new HTTPException(409, { message: 'no_class' })
    return c.json(r)
  })
  app.post('/v1/classes', async c => c.json(await createClass(db, me(c), await json(c.req.raw, ClassCreate)), 201))
  app.use('/v1/classes/:id', async (c, next) => { await need(ownsClass(db, me(c), c.req.param('id')!), 'class'); await next() })
  app.patch('/v1/classes/:id', async c => c.json(await updateClass(db, c.req.param('id'), await json(c.req.raw, ClassUpdate))))
  app.delete('/v1/classes/:id', async c => {
    const [cls] = await db.select({ weekday: classes.weekday }).from(classes).where(eq(classes.id, c.req.param('id')))
    const today = upcomingClassDate(deps.now(), deps.env.timeZone, cls!.weekday) // the same "current session" date startSession uses
    try { await deleteClass(db, c.req.param('id'), today) } catch (e) {
      if (e instanceof ClassLiveError) throw new HTTPException(409, { message: 'class_live' })
      throw e
    }
    return c.json({ ok: true })
  })
  app.post('/v1/students/:id/metrics', async c => {
    const id = c.req.param('id')
    const body = await json(c.req.raw, MetricCreate)
    const [st] = await db.select({ id: students.id }).from(students).where(eq(students.id, id))
    if (!st) throw new HTTPException(404, { message: 'student not found' })
    const mode = await modeForStudent(db, id)
    const unit = body.unit || null
    const { row } = await recordMetric(db, { studentId: id, key: body.key, value: body.value, num: body.num, unit, source: 'phone' }, isGradeMetric(mode.id, unit))
    // A rank reading takes the same path as the voice one: it moves the belt and, if changed, starts rank-since today.
    if (row.key === 'rank') await applyRank(db, id, row.value, null, localDate(deps.now(), deps.env.timeZone))
    return c.json(toMetricView(row), 201)
  })
  app.delete('/v1/metrics/:id', async c => {
    await need(ownsMetric(db, me(c), c.req.param('id')), 'metric')
    if (!await deleteMetric(db, c.req.param('id'))) throw new HTTPException(404, { message: 'metric not found' })
    return c.json({ ok: true })
  })
  app.get('/v1/agents/summary', async c => c.json(await agentsSummary(deps, me(c))))
  app.get('/v1/agents/runs/:id', async c => {
    await need(ownsAgentRun(db, me(c), c.req.param('id')), 'run')
    return c.json(await guard(agentRunDetail(db, c.req.param('id'))))
  })
  app.get('/v1/agents/feed', async c => {
    const since = c.req.query('since')
    const d = since ? new Date(since) : null
    if (d && Number.isNaN(d.getTime())) throw new HTTPException(400, { message: 'bad since' })
    return c.json(await agentFeed(db, d, me(c)))
  })
  app.get('/v1/agents/:task', async c => {
    const task = AgentTask.safeParse(c.req.param('task'))
    if (!task.success) throw new HTTPException(404, { message: 'unknown agent task' })
    const limit = z.coerce.number().int().min(1).max(200).catch(50).parse(c.req.query('limit') ?? 50)
    return c.json(await agentTaskRuns(db, task.data, limit, me(c)))
  })
  app.post('/v1/report-cards/run', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(50).optional() }))
    let ids: string[]
    if (studentIds) {
      const uniq = new Set(studentIds)
      ids = (await ownedStudentIds(db, me(c))).filter(id => uniq.has(id))
      if (!ids.length) throw new HTTPException(400, { message: 'no matching students' })
    } else ids = await ownedStudentIds(db, me(c))
    deps.defer(runReportCards(deps, ids).catch(e => console.error('[report-cards]', e)))
    return c.json({ started: ids.length })
  })

  // ---- Opportunistic insights (lens + phone) ----
  const insightFail = (r: Extract<InsightActResult, { ok: false }>) =>
    new HTTPException(r.code === 'not_found' ? 404 : r.code === 'not_pending' ? 409 : 502, { message: r.error })
  app.get('/v1/insights', async c => {
    const q = InsightsQuery.safeParse({ scope: c.req.query('scope') || undefined, classId: c.req.query('classId') || undefined, sessionId: c.req.query('sessionId') || undefined })
    if (!q.success) throw new HTTPException(400, { message: 'bad insights query' })
    if (q.data.classId) await need(ownsClass(db, me(c), q.data.classId), 'class')
    if (q.data.sessionId) await need(ownsSession(db, me(c), q.data.sessionId), 'session')
    try {
      const list = await listInsights(deps, q.data)
      const ids = list.map(i => i.id)
      const owned = ids.length ? new Set((await db.select({ id: insightsTable.id }).from(insightsTable).where(and(inArray(insightsTable.id, ids), insightOwnedBy(me(c))))).map(r => r.id)) : new Set<string>()
      return c.json({ insights: list.filter(i => owned.has(i.id)) })
    } catch (e) {
      if (e instanceof InsightsError) throw new HTTPException(e.code === 'not_found' ? 404 : 400, { message: e.message })
      throw e
    }
  })
  app.use('/v1/insights/:id/*', async (c, next) => { await need(ownsInsight(db, me(c), c.req.param('id')!), 'insight'); await next() })
  app.post('/v1/insights/:id/accept', async c => {
    const r = await acceptInsight(deps, c.req.param('id'))
    if (!r.ok) throw insightFail(r)
    return c.json({ ok: true, outcome: r.outcome })
  })
  app.post('/v1/insights/:id/dismiss', async c => {
    const r = await dismissInsight(deps, c.req.param('id'))
    if (!r.ok) throw insightFail(r)
    return c.json({ ok: true })
  })

  // ---- Settings: per-agent autonomy + custom vocabulary ----
  app.get('/v1/settings', async c => c.json(await getSettings(db)))
  app.patch('/v1/settings', async c => {
    const body = await json(c.req.raw, SettingsPatch)
    try { return c.json(await patchSettings(db, body)) } catch (e) {
      if (e instanceof SettingsError) throw new HTTPException(400, { message: e.message })
      throw e
    }
  })

  // ---- Onboarding quiz: per-step AI extraction, then one idempotent commit ----
  app.get('/v1/onboarding/status', async c => c.json(await onboardingStatus(deps, c.get('instructorId'))))
  app.post('/v1/onboarding/extract', async c => {
    if (!allow(`onb:${c.get('instructorId')}`, 20)) {
      c.header('Retry-After', '30')
      throw new HTTPException(429, { message: 'slow down' })
    }
    if (Number(c.req.header('content-length') ?? 0) > MAX_EXTRACT_BYTES) throw new HTTPException(413, { message: 'image too large' })
    const raw: unknown = await c.req.json().catch(() => null)
    const img = raw && typeof raw === 'object' ? (raw as { imageBase64?: unknown }).imageBase64 : undefined
    if (typeof img === 'string' && img.length > MAX_IMAGE_BASE64) throw new HTTPException(413, { message: 'image too large' })
    const req = ExtractRequest.safeParse(raw)
    if (!req.success) throw new HTTPException(400, { message: 'invalid body' })
    try {
      return c.json(await extractOnboarding(deps, req.data, localDate(deps.now(), deps.env.timeZone)))
    } catch (e) {
      if (e instanceof BudgetExceededError) throw new HTTPException(429, { message: 'ai_budget_reached' })
      console.error('[onboarding:extract]', req.data.step, e instanceof Error ? e.message : e)
      throw new HTTPException(502, { message: 'extract_failed' })
    }
  })
  app.post('/v1/onboarding/commit', async c => {
    const body = await json(c.req.raw, OnboardingCommit)
    try {
      return c.json(await commitOnboarding(deps, c.get('instructorId'), body))
    } catch (e) {
      if (e instanceof OnboardingError) throw new HTTPException(400, { message: e.message })
      throw e
    }
  })

  return app
}
