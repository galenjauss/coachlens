import { HTTPException } from 'hono/http-exception'
import { and, count, eq, gte, isNull, isNotNull } from 'drizzle-orm'
import type { StartSessionResponse, WrapUp } from '@matside/shared'
import type { Deps } from '../deps'
import type { Db } from '../db/client'
import { agentRuns, billingFlags, classes, decks, drills, notes, outbox, sessions } from '../db/schema'
import { upcomingClassDate } from '../logic/dates'
import { draftDeck } from '../agents/planner'
import { computeCoverage, loadSessionContext, nextStudentFor } from './context'
import { safeDefer } from '../agents/runs'
import { runInsights } from './insights'

export async function requireSession(db: Db, id: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, id))
  if (!s) throw new HTTPException(404, { message: 'session not found' })
  return s
}

export async function startSession(deps: Deps, classId: string): Promise<StartSessionResponse> {
  const { db } = deps
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId))
  if (!cls) throw new HTTPException(404, { message: 'class not found' })
  const forDate = upcomingClassDate(deps.now(), deps.env.timeZone, cls.weekday)
  const [open] = await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.forDate, forDate), isNull(sessions.endedAt)))
  let session = open
  if (!session) {
    const deckId = await draftDeck(deps, classId, forDate)
    if (!deckId) throw new Error('could not prepare a deck')
    const c = cls
    ;[session] = await db.insert(sessions).values({ classId, deckId, forDate, startedAt: deps.now(), remindIds: c.remindIds }).returning()
    await db.update(classes).set({ remindIds: [] }).where(eq(classes.id, classId))
    await db.update(decks).set({ status: 'active' }).where(eq(decks.id, deckId))
  }
  const ctx = await loadSessionContext(db, session!.id, null)
  return { sessionId: session!.id, startedAt: session!.startedAt.toISOString(), coverage: await computeCoverage(db, ctx), nextStudent: await nextStudentFor(db, ctx, deps.now()) }
}

export async function logDrill(deps: Deps, sessionId: string, drillId: string, event: 'start' | 'end') {
  const { db } = deps
  const s = await requireSession(db, sessionId)
  const [dr] = await db.select({ id: drills.id }).from(drills).where(and(eq(drills.id, drillId), eq(drills.deckId, s.deckId)))
  if (!dr) throw new HTTPException(404, { message: 'drill not found' })
  const now = deps.now()
  if (event === 'start') {
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt), isNull(drills.endedAt)))
    await db.update(drills).set({ startedAt: now, endedAt: null }).where(and(eq(drills.id, drillId), eq(drills.deckId, s.deckId)))
  } else {
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.id, drillId), eq(drills.deckId, s.deckId)))
  }
}

export async function endSession(deps: Deps, sessionId: string): Promise<WrapUp> {
  const { db } = deps
  const now = deps.now()
  const s = await requireSession(db, sessionId)
  if (!s.endedAt) {
    await db.update(sessions).set({ endedAt: now }).where(eq(sessions.id, sessionId))
    await db.update(decks).set({ status: 'done' }).where(eq(decks.id, s.deckId))
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt), isNull(drills.endedAt)))
    // The class just finished: look over its roster for things worth surfacing (background).
    safeDefer(deps, 'insights', runInsights(deps, { trigger: 'session_end', sessionId, classId: s.classId, today: s.forDate }))
  }
  const ctx = await loadSessionContext(db, sessionId, null)
  const coverage = await computeCoverage(db, ctx)
  const noted = new Set((await db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, sessionId))).flatMap(r => (r.id ? [r.id] : [])))
  const present = ctx.attendanceTaken ? ctx.roster.filter(r => ctx.presentIds.has(r.id)) : ctx.roster
  const [ran] = await db.select({ n: count() }).from(drills).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt)))
  const [runs] = await db.select({ n: count() }).from(agentRuns).where(and(eq(agentRuns.sessionId, sessionId), eq(agentRuns.status, 'ok')))
  const [mail] = await db.select({ n: count() }).from(outbox).where(and(eq(outbox.status, 'pending_review'), gte(outbox.createdAt, s.startedAt)))
  const [bills] = await db.select({ n: count() }).from(billingFlags).where(and(eq(billingFlags.status, 'open'), gte(billingFlags.createdAt, s.startedAt)))
  return {
    sessionId,
    minutes: Math.round(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000),
    drillsRun: ran?.n ?? 0,
    coverage,
    missed: present.filter(p => !noted.has(p.id)).map(p => ({ id: p.id, name: p.name.split(' ')[0]! })),
    agentActions: runs?.n ?? 0,
    pendingReview: (mail?.n ?? 0) + (bills?.n ?? 0),
  }
}
