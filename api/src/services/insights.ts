import { and, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import { clip } from '../logic/text'
import { INSIGHT_OUTCOME_MAX, type Autonomy, type Insight, type InsightAction, type InsightKind } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, drills, insights, issues, kv, notes, outbox, sessions, students } from '../db/schema'
import { detectAll, liveNoFeedback, runSummary, type InsightDraft } from '../agents/insights'
import { safeDefer, withRun } from '../agents/runs'
import { draftParentEmail } from '../agents/parentEmail'
import { acceptDiff, autoAdjustNextDeck, markAutonomy, nextDeckFor, suggestDiff } from '../agents/planner'
import { addDays, localDate } from '../logic/dates'
import { getAutonomy } from './settings'
import { loadSessionContext } from './context'
import { loadFacts, rosterIds } from './insightFacts'

type Row = typeof insights.$inferSelect
export const LAZY_RUN_MS = 10 * 60_000
const LAST_RUN_KEY = 'insights:last_run'
const liveKey = (sessionId: string) => `insights:live:${sessionId}`
const DEFAULT_CLASS_MINUTES = 60

export interface RunOptions {
  trigger: 'session_end' | 'attendance' | 'cron' | 'lazy'
  sessionId?: string | null
  /** Limit the run to one class's roster. */
  classId?: string | null
  only?: readonly InsightKind[]
  /** The date the run is about (a session's date); defaults to today, local. */
  today?: string
  /** Run auto-mode actions in the background instead of before returning (the lazy GET path). */
  deferActions?: boolean
}

async function kvGet(deps: Deps, key: string): Promise<string | null> {
  const [r] = await deps.db.select().from(kv).where(eq(kv.key, key))
  return r?.value ?? null
}
async function kvSet(deps: Deps, key: string, value: string) {
  await deps.db.insert(kv).values({ key, value, updatedAt: deps.now() }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: deps.now() } })
}

/** Inserts drafts, skipping any whose dedupe key exists. Auto mode marks actionable rows auto_done (they run next). */
async function insertDrafts(deps: Deps, drafts: InsightDraft[], sessionId: string | null, autonomy: Autonomy): Promise<Row[]> {
  const out: Row[] = []
  for (const d of drafts) {
    const status = autonomy === 'auto' && d.action.type !== 'none' ? 'auto_done' as const : 'new' as const
    const [row] = await deps.db.insert(insights).values({ ...d, sessionId, status, createdAt: deps.now() })
      .onConflictDoNothing({ target: insights.dedupeKey }).returning()
    if (row) out.push(row)
  }
  return out
}

async function namesFor(deps: Deps, ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => Boolean(x)))]
  if (!uniq.length) return new Map()
  return new Map((await deps.db.select({ id: students.id, name: students.name }).from(students).where(inArray(students.id, uniq))).map(s => [s.id, s.name]))
}

/** Runs auto-mode actions for freshly inserted rows and records each outcome on its row. */
async function runAutoActions(deps: Deps, rows: Row[]) {
  for (const r of rows.filter(x => x.status === 'auto_done')) {
    const res = await executeAction(deps, r, false).catch(e => ({ ok: false, outcome: `Failed: ${e instanceof Error ? e.message : e}` }))
    await deps.db.update(insights).set({ outcome: clip(res.outcome, INSIGHT_OUTCOME_MAX), actedAt: deps.now() }).where(eq(insights.id, r.id))
  }
}

async function logRun(deps: Deps, trigger: string, sessionId: string | null, autonomy: Autonomy, find: () => Promise<InsightDraft[]>): Promise<Row[]> {
  const rows = await withRun(deps, { agent: 'insights', trigger, sessionId }, async () => {
    const drafts = await find()
    const created = await insertDrafts(deps, drafts, sessionId, autonomy)
    const names = await namesFor(deps, created.map(c => c.studentId))
    return {
      result: created,
      summary: runSummary(created.map(c => ({ kind: c.kind, studentName: c.studentId ? names.get(c.studentId) ?? null : null }))),
      reason: `${trigger}: ${drafts.length} found, ${created.length} new (rest already seen this week) · autonomy: ${autonomy}`,
      output: created.map(c => ({ id: c.id, kind: c.kind, title: c.title, status: c.status })),
    }
  })
  return rows ?? []
}

/** One detector pass. Off: nothing runs. Returns the rows it created. */
export async function runInsights(deps: Deps, o: RunOptions): Promise<Row[]> {
  const autonomy = await getAutonomy(deps.db, 'insights')
  if (autonomy === 'off') return []
  const full = !o.classId && !o.only
  if (full) await kvSet(deps, LAST_RUN_KEY, deps.now().toISOString())
  const sessionId = o.sessionId ?? null
  const rows = await logRun(deps, o.trigger, sessionId, autonomy, async () => {
    const facts = await loadFacts(deps.db, o.classId ? await rosterIds(deps.db, o.classId) : undefined)
    return detectAll(facts, { today: o.today ?? localDate(deps.now(), deps.env.timeZone), now: deps.now(), sessionId }, o.only)
  })
  if (o.deferActions) safeDefer(deps, 'insights_auto', runAutoActions(deps, rows))
  else await runAutoActions(deps, rows)
  return rows
}

/** GET path: a full pass at most every 10 minutes (best effort; the timestamp lives in kv so instances share it). */
export async function maybeLazyRun(deps: Deps): Promise<boolean> {
  const last = await kvGet(deps, LAST_RUN_KEY)
  if (last && deps.now().getTime() - new Date(last).getTime() < LAZY_RUN_MS) return false
  await runInsights(deps, { trigger: 'lazy', deferActions: true })
  return true
}

/** Attendance changed in a live session: only returning_student, in the background. */
export function insightsOnAttendance(deps: Deps, s: { sessionId: string; classId: string; forDate: string }) {
  safeDefer(deps, 'insights', runInsights(deps, { trigger: 'attendance', sessionId: s.sessionId, classId: s.classId, today: s.forDate, only: ['returning_student'] }))
}

/** Once 70% of planned class time has passed, flags present students with no note yet (one check per session). */
export async function runLiveCheck(deps: Deps, session: typeof sessions.$inferSelect): Promise<void> {
  if (session.endedAt) return
  const autonomy = await getAutonomy(deps.db, 'insights')
  if (autonomy === 'off' || await kvGet(deps, liveKey(session.id))) return
  const planned = (await deps.db.select({ minutes: drills.minutes }).from(drills).where(eq(drills.deckId, session.deckId))).reduce((t, d) => t + d.minutes, 0)
  const elapsed = (deps.now().getTime() - session.startedAt.getTime()) / ((planned || DEFAULT_CLASS_MINUTES) * 60_000)
  if (elapsed < 0.7) return
  await kvSet(deps, liveKey(session.id), deps.now().toISOString())
  await logRun(deps, 'live', session.id, autonomy, async () => {
    const ctx = await loadSessionContext(deps.db, session.id, null)
    if (!ctx.attendanceTaken) return []
    const noted = await deps.db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, session.id))
    return liveNoFeedback({
      sessionId: session.id, today: session.forDate, elapsed,
      present: ctx.roster.filter(r => ctx.presentIds.has(r.id)).map(r => ({ id: r.id, name: r.name, classId: ctx.classId, mode: ctx.mode.id })),
      notedIds: new Set(noted.flatMap(n => (n.id ? [n.id] : []))),
    })
  })
}

export class InsightsError extends Error {
  constructor(readonly code: 'not_found' | 'bad_request', message: string) { super(message) }
}

const toView = (r: Row, names: Map<string, string>): Insight => ({
  id: r.id, kind: r.kind, studentId: r.studentId, studentName: r.studentId ? names.get(r.studentId) ?? null : null, classId: r.classId,
  title: r.title, detail: r.detail, urgency: r.urgency, status: r.status, createdAt: r.createdAt.toISOString(), actionLabel: r.action.label,
})

/**
 * New insights, high first. scope=class keeps the class's students (and class-level rows). A live session shows only
 * its class's high items created since it started; an ended session is just a class filter.
 */
export async function listInsights(deps: Deps, q: { scope: 'all' | 'class'; classId?: string; sessionId?: string }): Promise<Insight[]> {
  const { db } = deps
  let classId = q.classId
  let live: typeof sessions.$inferSelect | null = null
  if (q.sessionId) {
    const [s] = await db.select().from(sessions).where(eq(sessions.id, q.sessionId))
    if (!s) throw new InsightsError('not_found', 'session not found')
    if (!s.endedAt) live = s
    classId ??= s.classId
  }
  if (q.scope === 'class' && !classId) throw new InsightsError('bad_request', 'classId required for scope=class')
  if (classId && !(await db.select({ id: classes.id }).from(classes).where(eq(classes.id, classId))).length) throw new InsightsError('not_found', 'class not found')
  await maybeLazyRun(deps)
  if (live) await runLiveCheck(deps, live)
  const conds = [eq(insights.status, 'new')]
  if (q.scope === 'class' || live) {
    const ids = await rosterIds(db, classId!)
    const cls = and(isNull(insights.studentId), eq(insights.classId, classId!))!
    conds.push(ids.length ? or(inArray(insights.studentId, ids), cls)! : cls)
  }
  if (live) conds.push(eq(insights.urgency, 'high'), gte(insights.createdAt, live.startedAt))
  const rows = await db.select().from(insights).where(and(...conds))
    .orderBy(sql`case when ${insights.urgency} = 'high' then 0 else 1 end`, desc(insights.createdAt)).limit(50)
  const names = await namesFor(deps, rows.map(r => r.studentId))
  return rows.map(r => toView(r, names))
}

// ---- Accept / dismiss ----

const PURPOSE: Record<string, string> = {
  check_in: 'A friendly check-in about missed classes',
  welcome_back: 'Glad to see them back after missing a few',
  ready_to_test: 'They look ready for their next rank test',
  praise: 'Celebrate a new personal best',
  positive: 'A positive update: the focus area has improved',
}

async function emailOutcome(deps: Deps, row: Row, studentId: string, purpose: string): Promise<{ ok: boolean; outcome: string; mail: 'off' | 'drafted' | 'sent' | 'failed' }> {
  const autonomy = await getAutonomy(deps.db, 'parent_email')
  const content = `${PURPOSE[purpose] ?? purpose}. ${row.detail}`
  const id = await draftParentEmail(deps, { studentId, sessionId: row.sessionId, trigger: { kind: 'insight', content } })
  if (autonomy === 'off') return { ok: true, outcome: 'Parent emails are off in Settings', mail: 'off' }
  if (!id) return { ok: false, outcome: 'Email draft failed', mail: 'failed' }
  const [o] = await deps.db.select({ status: outbox.status }).from(outbox).where(eq(outbox.id, id))
  return o?.status === 'sent' ? { ok: true, outcome: 'Email sent', mail: 'sent' } : { ok: true, outcome: 'Email drafted for review', mail: 'drafted' }
}

/** The date after which "next class" is looked up: today counts unless the class already met today. */
async function planAfterDate(deps: Deps, classId: string): Promise<string> {
  const today = localDate(deps.now(), deps.env.timeZone)
  const [met] = await deps.db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.forDate, today))).limit(1)
  return met ? today : addDays(today, -1)
}

/**
 * plan_focus. Auto (no coach): autoAdjustNextDeck, which honors planner autonomy. Accepted by the coach: an explicit
 * request, so it always suggests (planner auto applies it), like a spoken plan request.
 */
async function planOutcome(deps: Deps, row: Row, a: Extract<InsightAction, { type: 'plan_focus' }>, explicit: boolean) {
  const planner = await getAutonomy(deps.db, 'planner')
  const afterDate = await planAfterDate(deps, a.classId)
  if (!explicit) {
    await autoAdjustNextDeck(deps, { classId: a.classId, afterDate, requestText: a.text, sessionId: row.sessionId })
    return { ok: true, outcome: planner === 'off' ? 'Planner is off in Settings' : planner === 'auto' ? 'Added to next plan' : 'Plan change ready for review' }
  }
  const deckId = await nextDeckFor(deps, a.classId, afterDate)
  const s = deckId ? await suggestDiff(deps, deckId, a.text, row.sessionId) : null
  if (!s) return { ok: false, outcome: 'Planner unavailable' }
  const auto = planner === 'auto'
  if (auto) await acceptDiff(deps, s.diffId, { remember: false })
  await markAutonomy(deps, row.sessionId, null, auto, s.diffId, 'insight')
  return { ok: true, outcome: auto ? 'Added to next plan' : 'Plan change ready for review' }
}

/** Executes a row's action. `explicit`: the coach accepted it (vs. auto mode acting alone). */
export async function executeAction(deps: Deps, row: Row, explicit: boolean): Promise<{ ok: boolean; outcome: string }> {
  const a = row.action
  switch (a.type) {
    case 'draft_email': return emailOutcome(deps, row, a.studentId, a.purpose)
    case 'plan_focus': return planOutcome(deps, row, a, explicit)
    case 'resolve_issue': {
      const done = await deps.db.update(issues).set({ status: 'resolved' }).where(and(eq(issues.id, a.issueId), eq(issues.status, 'open'))).returning({ id: issues.id })
      const head = done.length ? 'Resolved' : 'Already resolved'
      if (!a.notify) return { ok: true, outcome: head }
      const mail = await emailOutcome(deps, row, a.studentId, 'positive')
      const tail = { off: 'emails are off', drafted: 'email drafted for review', sent: 'email sent', failed: 'email draft failed' }[mail.mail]
      return { ok: true, outcome: `${head} · ${tail}` }
    }
    case 'none': return { ok: true, outcome: 'Noted' }
  }
}

export type InsightActResult = { ok: true; outcome: string } | { ok: false; code: 'not_found' | 'not_pending' | 'failed'; error: string }

/** Claims the row (new -> accepted) so a double tap can't run it twice; a failed action puts it back to new. */
export async function acceptInsight(deps: Deps, id: string): Promise<InsightActResult> {
  const [claimed] = await deps.db.update(insights).set({ status: 'accepted', actedAt: deps.now() })
    .where(and(eq(insights.id, id), eq(insights.status, 'new'))).returning()
  if (!claimed) {
    const [exists] = await deps.db.select({ id: insights.id }).from(insights).where(eq(insights.id, id))
    return exists ? { ok: false, code: 'not_pending', error: 'insight not pending' } : { ok: false, code: 'not_found', error: 'insight not found' }
  }
  const res = await withRun(deps, { agent: 'insights', trigger: 'accept', sessionId: claimed.sessionId, links: claimed.studentId ? { studentId: claimed.studentId } : undefined }, async () => {
    const r = await executeAction(deps, claimed, true)
    if (!r.ok) throw new Error(r.outcome)
    return { result: r, summary: clip(`${claimed.title} → ${r.outcome}`, 120), reason: `coach accepted · ${claimed.action.type}` }
  })
  if (!res) {
    await deps.db.update(insights).set({ status: 'new', actedAt: null }).where(eq(insights.id, id))
    return { ok: false, code: 'failed', error: 'action failed' }
  }
  const outcome = clip(res.outcome, INSIGHT_OUTCOME_MAX)
  await deps.db.update(insights).set({ outcome }).where(eq(insights.id, id))
  return { ok: true, outcome }
}

/** new -> dismissed (dismissing twice is fine; an accepted row is a 409). */
export async function dismissInsight(deps: Deps, id: string): Promise<InsightActResult> {
  const [row] = await deps.db.select({ status: insights.status }).from(insights).where(eq(insights.id, id))
  if (!row) return { ok: false, code: 'not_found', error: 'insight not found' }
  if (row.status === 'dismissed') return { ok: true, outcome: 'Dismissed' }
  if (row.status !== 'new') return { ok: false, code: 'not_pending', error: 'insight not pending' }
  await deps.db.update(insights).set({ status: 'dismissed', actedAt: deps.now() }).where(and(eq(insights.id, id), eq(insights.status, 'new')))
  return { ok: true, outcome: 'Dismissed' }
}
