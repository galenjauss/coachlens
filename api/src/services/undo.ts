import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Coverage } from '@matside/shared'
import type { Deps } from '../deps'
import type { Db } from '../db/client'
import { actionLedger, attendance, billingFlags, deckDiffs, deferredTasks, drills, issues, notes, outbox, studentMetrics, students, utterances } from '../db/schema'
import { atomically } from '../db/atomic'
import { undoDiff } from '../agents/planner'
import { computeCoverage, loadSessionContext, modeForStudent } from './context'
import type { AttendanceBefore, RankState } from './ledger'

/** C2 · POST /v1/utterances/:id/undo. Labels are short human lines (at most 38 characters). */
export interface UndoResult { ok: true; reversed: string[]; cancelled: string[]; notReversible: string[]; coverage: Coverage | null }
export class UndoError extends Error {
  constructor(readonly code: 'not_found' | 'already_undone') { super(code) }
}

export const LABEL_MAX = 38
const clip = (s: string) => (s.length <= LABEL_MAX ? s : `${s.slice(0, LABEL_MAX - 1)}…`)
const first = (name: string | undefined) => (name ? name.split(' ')[0]! : 'student')

class Labels {
  private readonly set = new Set<string>()
  add(s: string) { this.set.add(clip(s)) }
  get list() { return [...this.set] }
}

/**
 * Reverses everything the utterance applied, in one transaction, after atomically claiming it (a second Undo is
 * already_undone). Deferred work sees the claim: it checks utterances.undone_at before writing and before sending.
 * A sent email cannot be recalled and is reported in notReversible.
 */
export async function undoUtterance(deps: Deps, utteranceId: string): Promise<UndoResult> {
  const { db } = deps
  const [claimed] = await db.update(utterances).set({ undoneAt: deps.now() })
    .where(and(eq(utterances.id, utteranceId), isNull(utterances.undoneAt))).returning({ sessionId: utterances.sessionId })
  if (!claimed) {
    const [exists] = await db.select({ id: utterances.id }).from(utterances).where(eq(utterances.id, utteranceId))
    throw new UndoError(exists ? 'already_undone' : 'not_found')
  }
  try {
    const r = await compensate(deps, utteranceId)
    const coverage = claimed.sessionId ? await computeCoverage(db, await loadSessionContext(db, claimed.sessionId, null)) : null
    return { ok: true, ...r, coverage }
  } catch (e) {
    await db.update(utterances).set({ undoneAt: null }).where(eq(utterances.id, utteranceId)).catch(() => {})
    throw e
  }
}

async function gather(db: Db, utteranceId: string) {
  const [ns, bills, metrics, ledger, mail, tasks, diffs] = await Promise.all([
    db.select({ id: notes.id, studentId: notes.studentId }).from(notes).where(eq(notes.utteranceId, utteranceId)),
    db.select({ id: billingFlags.id, studentId: billingFlags.studentId }).from(billingFlags).where(eq(billingFlags.utteranceId, utteranceId)),
    db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId)),
    db.select().from(actionLedger).where(eq(actionLedger.utteranceId, utteranceId)).orderBy(desc(actionLedger.createdAt)),
    db.select({ id: outbox.id, studentId: outbox.studentId, status: outbox.status }).from(outbox).where(eq(outbox.utteranceId, utteranceId)),
    db.select().from(deferredTasks).where(and(eq(deferredTasks.utteranceId, utteranceId), inArray(deferredTasks.status, ['pending', 'running']))),
    db.select({ id: deckDiffs.id, status: deckDiffs.status }).from(deckDiffs).where(eq(deckDiffs.utteranceId, utteranceId)).orderBy(asc(deckDiffs.createdAt)),
  ])
  return { ns, bills, metrics, ledger, mail, tasks, diffs }
}

async function compensate(deps: Deps, utteranceId: string) {
  const { db } = deps
  const g = await gather(db, utteranceId)
  const reversed = new Labels(), cancelled = new Labels(), notReversible = new Labels()

  const ids = [...new Set([
    ...g.ns.map(n => n.studentId), ...g.bills.map(b => b.studentId), ...g.metrics.map(m => m.studentId), ...g.mail.map(m => m.studentId),
    ...g.ledger.flatMap(l => (l.kind === 'rank' ? [l.entityId] : l.kind === 'issue' ? [(l.after as { studentId: string }).studentId] : [])),
    ...g.tasks.map(t => t.subject),
  ].filter((x): x is string => Boolean(x)))]
  // The lens shows the name the coach uses: the nickname, else the first name.
  const names = new Map(ids.length ? (await db.select({ id: students.id, name: students.name, nickname: students.nickname }).from(students).where(inArray(students.id, ids)))
    .map(s => [s.id, s.nickname || first(s.name)]) : [])
  const nameOf = (id: string | null) => (id ? names.get(id) ?? 'student' : null)

  const rankRows = g.ledger.filter(l => l.kind === 'rank')
  const current = rankRows.length ? await db.select({ id: students.id, belt: students.belt }).from(students).where(inArray(students.id, rankRows.map(r => r.entityId))) : []
  const sent = g.mail.filter(m => m.status === 'sent' || m.status === 'sending')
  const familyOf = async (studentId: string) => ((await modeForStudent(db, studentId)).recipient === 'client' ? '' : "'s family")

  // Labels first (they describe the compensations built below).
  for (const n of g.ns) reversed.add(n.studentId ? `Removed ${nameOf(n.studentId)} note` : 'Removed unassigned note')
  for (const b of g.bills) reversed.add(b.studentId ? `Removed billing flag for ${nameOf(b.studentId)}` : 'Removed billing flag')
  for (const m of g.metrics) if (m.key !== 'rank') reversed.add(`Removed ${nameOf(m.studentId)} ${m.key} ${m.value}`)
  const rankRestores: { studentId: string; before: RankState }[] = []
  for (const l of rankRows) {
    const before = l.before as RankState, after = l.after as RankState
    const now = current.find(c => c.id === l.entityId)
    if (now && now.belt.toLowerCase() === after.belt.toLowerCase()) {
      rankRestores.push({ studentId: l.entityId, before })
      reversed.add(`Restored ${nameOf(l.entityId)} rank: ${before.belt}`)
    } else notReversible.add(`Kept ${nameOf(l.entityId)} rank (changed since)`)
  }
  for (const m of g.metrics) if (m.key === 'rank' && !rankRows.some(r => r.entityId === m.studentId)) reversed.add(`Removed ${nameOf(m.studentId)} rank reading`)
  const attRows = g.ledger.filter(l => l.kind === 'attendance')
  for (const l of g.ledger.filter(x => x.kind === 'issue')) {
    const a = l.after as { studentId: string; tag: string }
    reversed.add(`Removed ${nameOf(a.studentId)} ${a.tag} issue`)
  }
  for (const l of g.ledger.filter(x => x.kind === 'drill_added')) reversed.add(`Removed drill: ${(l.after as { name: string }).name}`)
  for (const m of g.mail) if (m.status === 'pending_review' || m.status === 'error') cancelled.add(`Cancelled email draft for ${nameOf(m.studentId)}`)
  for (const m of sent) notReversible.add(`Email already sent to ${nameOf(m.studentId)}${await familyOf(m.studentId)}`)
  for (const t of g.tasks) {
    if (t.kind === 'parent_email') {
      if (!sent.some(m => m.studentId === t.subject)) cancelled.add(`Cancelled email draft for ${nameOf(t.subject)}`)
    } else cancelled.add(t.kind === 'auto_adjust' ? 'Cancelled next-class plan change' : 'Cancelled plan request')
  }
  const pendingDiffs = g.diffs.filter(d => d.status === 'pending')
  if (pendingDiffs.length) cancelled.add('Withdrew plan suggestion')

  await atomically(db, h => [
    h.delete(notes).where(eq(notes.utteranceId, utteranceId)),
    h.delete(billingFlags).where(eq(billingFlags.utteranceId, utteranceId)),
    h.delete(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId)),
    // Newest first, so several changes to one row unwind in order (attendance keeps only its first "before").
    ...attRows.map(l => {
      const [sessionId, studentId] = l.entityId.split(':') as [string, string]
      const before = l.before as AttendanceBefore
      const where = and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, studentId))
      return before ? h.update(attendance).set({ status: before.status, source: before.source }).where(where) : h.delete(attendance).where(where)
    }),
    ...rankRestores.map(r => h.update(students).set({ belt: r.before.belt, rankSince: r.before.rankSince }).where(eq(students.id, r.studentId))),
    ...g.ledger.filter(l => l.kind === 'issue').map(l => h.delete(issues).where(eq(issues.id, l.entityId))),
    ...g.ledger.filter(l => l.kind === 'drill_added').flatMap(l => [
      h.delete(drills).where(eq(drills.id, l.entityId)),
      ...(l.before as { shifted: { id: string; position: number }[] }).shifted.map(s => h.update(drills).set({ position: s.position }).where(eq(drills.id, s.id))),
    ]),
    h.update(outbox).set({ status: 'cancelled' }).where(and(eq(outbox.utteranceId, utteranceId), inArray(outbox.status, ['pending_review', 'error']))),
    h.update(deferredTasks).set({ status: 'cancelled', updatedAt: deps.now() }).where(and(eq(deferredTasks.utteranceId, utteranceId), inArray(deferredTasks.status, ['pending', 'running']))),
    h.update(deckDiffs).set({ status: 'undone' }).where(and(eq(deckDiffs.utteranceId, utteranceId), eq(deckDiffs.status, 'pending'))),
  ])

  if (attRows.length) {
    const sessionId = attRows[0]!.entityId.split(':')[0]!
    const present = (await db.select({ s: attendance.status }).from(attendance).where(and(eq(attendance.sessionId, sessionId), eq(attendance.status, 'present')))).length
    reversed.add(`Attendance restored (${present} present)`)
  }
  // An applied plan change is reverted from its snapshot, unless the class started or the plan was edited since.
  for (const d of g.diffs.filter(x => x.status === 'accepted')) {
    try {
      await undoDiff(db, d.id)
      reversed.add('Reverted plan change')
    } catch (e) {
      notReversible.add(e instanceof Error && /class started/.test(e.message) ? 'Plan change kept (class started)' : 'Plan change kept (plan edited since)')
    }
  }
  return { reversed: reversed.list, cancelled: cancelled.list, notReversible: notReversible.list }
}
