import { and, asc, count, desc, eq, gte, inArray, isNull } from 'drizzle-orm'
import {
  AGENT_TASK_LABELS, AgentTask,
  type AgentColor, type AgentRunDetail, type AgentRunLinks, type AgentRunView, type AgentTaskRun, type AgentTile, type UtteranceRun,
} from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { agentRuns, billingFlags, deckDiffs, insights, notes, outbox, students, utterances } from '../db/schema'
import { localDate } from '../logic/dates'

type RunRow = typeof agentRuns.$inferSelect

// Each topic tile is fed by the agent names its runs are logged under (the agent name equals the task).
const TASK_AGENTS: Record<AgentTask, string[]> = {
  progress: ['progress'], parent_email: ['parent_email'], report_card: ['report_card'],
  billing: ['billing'], planner: ['planner'], attendance: ['attendance'], insights: ['insights'],
}
const taskOf = (agent: string): AgentTask | null =>
  (AgentTask.options.find(t => TASK_AGENTS[t].includes(agent)) ?? null)

const view = (r: RunRow): AgentRunView => ({ id: r.id, agent: r.agent, summary: r.summary, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() })
const colorOf = (urgent: number, pending: number): AgentColor => (urgent ? 'red' : pending ? 'amber' : 'green')

/** Current state of the items runs link to, fetched in one batch per table. */
async function linkedState(db: Db, runs: RunRow[]) {
  const ids = (k: keyof AgentRunLinks) => [...new Set(runs.flatMap(r => (r.links?.[k] ? [r.links[k]!] : [])))]
  const [mail, bills, diffs, ns] = await Promise.all([
    ids('outboxId').length ? db.select({ id: outbox.id, status: outbox.status, trigger: outbox.trigger }).from(outbox).where(inArray(outbox.id, ids('outboxId'))) : [],
    ids('billingFlagId').length ? db.select({ id: billingFlags.id, status: billingFlags.status, urgency: billingFlags.urgency }).from(billingFlags).where(inArray(billingFlags.id, ids('billingFlagId'))) : [],
    ids('diffId').length ? db.select({ id: deckDiffs.id, status: deckDiffs.status }).from(deckDiffs).where(inArray(deckDiffs.id, ids('diffId'))) : [],
    ids('noteId').length ? db.select({ id: notes.id, studentId: notes.studentId }).from(notes).where(inArray(notes.id, ids('noteId'))) : [],
  ])
  return { mail: new Map(mail.map(m => [m.id, m])), bills: new Map(bills.map(b => [b.id, b])), diffs: new Map(diffs.map(d => [d.id, d])), notes: new Map(ns.map(n => [n.id, n])) }
}
type Linked = Awaited<ReturnType<typeof linkedState>>

/** red: failed, or urgent and unhandled. amber: waiting for the coach. green: nothing to do. */
function runColor(r: RunRow, s: Linked): AgentColor {
  if (r.status === 'error') return 'red'
  const l = r.links ?? {}
  const m = l.outboxId ? s.mail.get(l.outboxId) : undefined
  if (m?.status === 'pending_review') return m.trigger === 'urgent' ? 'red' : 'amber'
  const b = l.billingFlagId ? s.bills.get(l.billingFlagId) : undefined
  if (b?.status === 'open') return b.urgency === 'high' ? 'red' : 'amber'
  if (l.diffId && s.diffs.get(l.diffId)?.status === 'pending') return 'amber'
  if (l.noteId && s.notes.has(l.noteId) && !s.notes.get(l.noteId)!.studentId) return 'amber'
  return 'green'
}

async function withColors(db: Db, rows: RunRow[]): Promise<AgentTaskRun[]> {
  const s = await linkedState(db, rows)
  return rows.map(r => ({ ...view(r), color: runColor(r, s), links: r.links ?? {} }))
}

async function pendingCounts(db: Db): Promise<Record<AgentTask, { pending: number; urgent: number }>> {
  const n = (rows: { n: number }[]) => rows[0]?.n ?? 0
  const [pe, peU, rc, bi, biU, pl, loose, ins] = await Promise.all([
    db.select({ n: count() }).from(outbox).where(and(eq(outbox.kind, 'parent_email'), eq(outbox.status, 'pending_review'))),
    db.select({ n: count() }).from(outbox).where(and(eq(outbox.kind, 'parent_email'), eq(outbox.status, 'pending_review'), eq(outbox.trigger, 'urgent'))),
    db.select({ n: count() }).from(outbox).where(and(eq(outbox.kind, 'report_card'), eq(outbox.status, 'pending_review'))),
    db.select({ n: count() }).from(billingFlags).where(eq(billingFlags.status, 'open')),
    db.select({ n: count() }).from(billingFlags).where(and(eq(billingFlags.status, 'open'), eq(billingFlags.urgency, 'high'))),
    db.select({ n: count() }).from(deckDiffs).where(eq(deckDiffs.status, 'pending')),
    db.select({ n: count() }).from(notes).where(isNull(notes.studentId)),
    db.select({ n: count() }).from(insights).where(eq(insights.status, 'new')),
  ])
  return {
    progress: { pending: n(loose), urgent: 0 },
    parent_email: { pending: n(pe), urgent: n(peU) },
    report_card: { pending: n(rc), urgent: 0 },
    billing: { pending: n(bi), urgent: n(biU) },
    planner: { pending: n(pl), urgent: 0 },
    attendance: { pending: 0, urgent: 0 },
    insights: { pending: n(ins), urgent: 0 }, // new insights waiting: amber
  }
}

export async function agentsSummary(deps: Deps): Promise<AgentTile[]> {
  const { db } = deps
  const now = deps.now()
  const today = localDate(now, deps.env.timeZone)
  const since = new Date(now.getTime() - 36 * 3_600_000) // covers "today" in any US time zone
  const allAgents = AgentTask.options.flatMap(t => TASK_AGENTS[t])
  const [recent, counts, latest] = await Promise.all([
    db.select({ agent: agentRuns.agent, at: agentRuns.createdAt }).from(agentRuns).where(and(inArray(agentRuns.agent, allAgents), gte(agentRuns.createdAt, since))),
    pendingCounts(db),
    Promise.all(AgentTask.options.map(t => db.select().from(agentRuns).where(inArray(agentRuns.agent, TASK_AGENTS[t])).orderBy(desc(agentRuns.createdAt)).limit(1))),
  ])
  return AgentTask.options.map((task, i) => {
    const c = counts[task]
    const todayN = recent.filter(r => TASK_AGENTS[task].includes(r.agent) && localDate(r.at, deps.env.timeZone) === today).length
    const last = latest[i]![0]
    return { task, label: AGENT_TASK_LABELS[task], counts: { today: todayN, ...c }, color: colorOf(c.urgent, c.pending), latest: last ? view(last) : null }
  })
}

export async function agentTaskRuns(db: Db, task: AgentTask, limit: number): Promise<AgentTaskRun[]> {
  const rows = await db.select().from(agentRuns).where(inArray(agentRuns.agent, TASK_AGENTS[task])).orderBy(desc(agentRuns.createdAt)).limit(limit)
  return withColors(db, rows)
}

export async function agentRunDetail(db: Db, id: string): Promise<AgentRunDetail> {
  const [r] = await db.select().from(agentRuns).where(eq(agentRuns.id, id))
  if (!r) throw new Error('agent run not found')
  const [run] = await withColors(db, [r])
  const l = r.links ?? {}
  const one = async <T>(p: Promise<T[]>): Promise<T | null> => (await p)[0] ?? null
  const [utt, o, b, d, n] = await Promise.all([
    r.utteranceId ? one(db.select({ transcript: utterances.transcript }).from(utterances).where(eq(utterances.id, r.utteranceId))) : null,
    l.outboxId ? one(db.select().from(outbox).where(eq(outbox.id, l.outboxId))) : null,
    l.billingFlagId ? one(db.select().from(billingFlags).where(eq(billingFlags.id, l.billingFlagId))) : null,
    l.diffId ? one(db.select().from(deckDiffs).where(eq(deckDiffs.id, l.diffId))) : null,
    l.noteId ? one(db.select().from(notes).where(eq(notes.id, l.noteId))) : null,
  ])
  const studentId = l.studentId ?? o?.studentId ?? b?.studentId ?? n?.studentId ?? null
  const st = studentId ? await one(db.select({ name: students.name }).from(students).where(eq(students.id, studentId))) : null
  return {
    ...run!,
    task: taskOf(r.agent),
    trigger: r.trigger,
    utteranceId: r.utteranceId,
    transcript: utt?.transcript ?? null,
    studentName: st?.name ?? null,
    outbox: o ? { id: o.id, kind: o.kind, to: o.toEmail, subject: o.subject, body: o.body, status: o.status, urgent: o.trigger === 'urgent' } : null,
    billing: b ? { id: b.id, note: b.note, urgency: b.urgency, amount: b.amount, status: b.status } : null,
    diff: d ? { id: d.id, deckId: d.deckId, requestText: d.requestText, diff: d.diff, status: d.status } : null,
    note: n ? { id: n.id, text: n.text, heard: n.heard, studentId: n.studentId } : null,
  }
}

/** Runs started by one utterance, oldest first (deferred agents appear as they finish). */
export async function utteranceRuns(db: Db, utteranceId: string): Promise<UtteranceRun[]> {
  const rows = await db.select().from(agentRuns).where(eq(agentRuns.utteranceId, utteranceId)).orderBy(asc(agentRuns.createdAt))
  return rows.map(r => ({ agent: r.agent, summary: r.summary, status: r.status, createdAt: r.createdAt.toISOString() }))
}
