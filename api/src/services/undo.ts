import { and, asc, desc, eq, inArray, isNull, not, sql } from 'drizzle-orm'
import type { Coverage, UndoResponse } from '@matside/shared'
import type { Deps } from '../deps'
import type { Db } from '../db/client'
import { actionLedger, attendance, billingFlags, deckDiffs, decks, deferredTasks, drills, issues, notes, outbox, studentMetrics, students, utterances } from '../db/schema'
import { atomically } from '../db/atomic'
import { isStarted, undoDiff } from '../agents/planner'
import { computeCoverage, loadSessionContext, modeForStudent } from './context'
import type { AttendanceBefore, AttendanceState, RankState } from './ledger'

/** The shared UndoResponse (C2) plus coverage, which the lens uses to refresh its counter. */
export type UndoResult = UndoResponse & { coverage: Coverage | null }
export class UndoError extends Error {
  constructor(readonly code: 'not_found' | 'already_undone') { super(code) }
}

export const LABEL_MAX = 38
const clip = (s: string) => (s.length <= LABEL_MAX ? s : `${s.slice(0, LABEL_MAX - 1)}…`)
const first = (name: string | undefined) => (name ? name.split(' ')[0]! : 'student')
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

class Labels {
  private readonly set = new Set<string>()
  add(s: string) { this.set.add(clip(s)) }
  get list() { return [...this.set] }
}
type LabelSet = { reversed: Labels; cancelled: Labels; notReversible: Labels }

/**
 * Reverses everything the utterance applied, in one transaction, after atomically claiming it (a second Undo is
 * already_undone). Deferred work sees the claim: it checks utterances.undone_at before writing and before sending.
 * A sent email cannot be recalled and is reported in notReversible. A value changed again since the utterance
 * (attendance, rank, a drill already run) is kept and reported, never overwritten. Once the compensation batch
 * commits, the claim stays whatever happens after (the attendance count, plan reverts and coverage are best effort).
 */
export async function undoUtterance(deps: Deps, utteranceId: string): Promise<UndoResult> {
  const { db } = deps
  const [claimed] = await db.update(utterances).set({ undoneAt: deps.now() })
    .where(and(eq(utterances.id, utteranceId), isNull(utterances.undoneAt))).returning({ sessionId: utterances.sessionId })
  if (!claimed) {
    const [exists] = await db.select({ id: utterances.id }).from(utterances).where(eq(utterances.id, utteranceId))
    throw new UndoError(exists ? 'already_undone' : 'not_found')
  }
  const release = () => db.update(utterances).set({ undoneAt: null }).where(eq(utterances.id, utteranceId)).catch(() => {})
  const labels: LabelSet = { reversed: new Labels(), cancelled: new Labels(), notReversible: new Labels() }
  let plan: Awaited<ReturnType<typeof planCompensation>>
  try {
    plan = await planCompensation(deps, utteranceId, labels)
    await atomically(db, plan.build)
  } catch (e) {
    await release()
    throw e
  }
  // Committed: nothing below releases the claim.
  await plan.after().catch(e => console.error('[undo:after]', utteranceId, e))
  const coverage = claimed.sessionId
    ? await loadSessionContext(db, claimed.sessionId, null).then(ctx => computeCoverage(db, ctx)).catch(() => null)
    : null
  return { ok: true, reversed: labels.reversed.list, cancelled: labels.cancelled.list, notReversible: labels.notReversible.list, coverage }
}

async function gather(db: Db, utteranceId: string) {
  const [ns, bills, metrics, ledger, mail, tasks, diffs] = await Promise.all([
    db.select({ id: notes.id, studentId: notes.studentId }).from(notes).where(eq(notes.utteranceId, utteranceId)),
    db.select({ id: billingFlags.id, studentId: billingFlags.studentId }).from(billingFlags).where(eq(billingFlags.utteranceId, utteranceId)),
    db.select().from(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId)),
    db.select().from(actionLedger).where(eq(actionLedger.utteranceId, utteranceId)).orderBy(desc(actionLedger.createdAt)),
    db.select({ id: outbox.id, studentId: outbox.studentId, status: outbox.status }).from(outbox).where(eq(outbox.utteranceId, utteranceId)),
    db.select().from(deferredTasks).where(and(eq(deferredTasks.utteranceId, utteranceId), inArray(deferredTasks.status, ['pending', 'running']))),
    db.select({ id: deckDiffs.id, status: deckDiffs.status, deckId: deckDiffs.deckId }).from(deckDiffs).where(eq(deckDiffs.utteranceId, utteranceId)).orderBy(asc(deckDiffs.createdAt)),
  ])
  return { ns, bills, metrics, ledger, mail, tasks, diffs }
}

type Ledger = typeof actionLedger.$inferSelect
type Query = PromiseLike<unknown>
const none = (_h: Db): Query[] => []

/** Attendance: a row is restored only while it still holds what this utterance wrote; later changes are kept. */
async function attendancePlan(db: Db, rows: Ledger[], labels: LabelSet) {
  if (!rows.length) return { build: none, sessionId: null as string | null, restored: 0 }
  const sessionId = rows[0]!.entityId.split(':')[0]!
  const current = await db.select().from(attendance).where(eq(attendance.sessionId, sessionId))
  const restore: { studentId: string; before: AttendanceBefore }[] = []
  let kept = 0
  for (const l of rows) {
    const studentId = l.entityId.split(':')[1]!
    const after = l.after as AttendanceState | null
    const now = current.find(c => c.studentId === studentId)
    if (!after || (now?.status === after.status && now?.source === after.source)) restore.push({ studentId, before: l.before as AttendanceBefore })
    else kept++
  }
  if (kept) labels.notReversible.add(`Kept ${kept} attendance ${plural(kept, 'change', 'changes')} made since`)
  const build = (h: Db): Query[] => restore.map(r => {
    const where = and(eq(attendance.sessionId, sessionId), eq(attendance.studentId, r.studentId))
    return r.before ? h.update(attendance).set({ status: r.before.status, source: r.before.source }).where(where) : h.delete(attendance).where(where)
  })
  return { build, sessionId, restored: restore.length }
}

/** Added drills: removed (unless already run), then each touched deck is renumbered from its CURRENT order. */
async function drillPlan(db: Db, rows: Ledger[], labels: LabelSet) {
  if (!rows.length) return none
  const present = await db.select({ id: drills.id, deckId: drills.deckId, startedAt: drills.startedAt }).from(drills).where(inArray(drills.id, rows.map(r => r.entityId)))
  const remove = new Set<string>()
  for (const l of rows) {
    const name = (l.after as { name: string }).name
    const d = present.find(p => p.id === l.entityId)
    if (!d) continue // already removed by hand
    if (d.startedAt) { labels.notReversible.add(`Kept drill: ${name} (already run)`); continue }
    remove.add(d.id)
    labels.reversed.add(`Removed drill: ${name}`)
  }
  const renumber: { id: string; position: number }[] = []
  for (const deckId of new Set(present.filter(p => remove.has(p.id)).map(p => p.deckId))) {
    const left = (await db.select({ id: drills.id, position: drills.position }).from(drills).where(eq(drills.deckId, deckId)).orderBy(asc(drills.position), asc(drills.id)))
      .filter(d => !remove.has(d.id))
    left.forEach((d, i) => { if (d.position !== i + 1) renumber.push({ id: d.id, position: i + 1 }) })
  }
  return (h: Db): Query[] => [
    ...(remove.size ? [h.delete(drills).where(inArray(drills.id, [...remove]))] : []),
    ...renumber.map(r => h.update(drills).set({ position: r.position }).where(eq(drills.id, r.id))),
  ]
}

async function planCompensation(deps: Deps, utteranceId: string, labels: LabelSet) {
  const { db } = deps
  const { reversed, cancelled, notReversible } = labels
  const g = await gather(db, utteranceId)

  const ids = [...new Set([
    ...g.ns.map(n => n.studentId), ...g.bills.map(b => b.studentId), ...g.metrics.map(m => m.studentId), ...g.mail.map(m => m.studentId),
    ...g.ledger.flatMap(l => (l.kind === 'rank' ? [l.entityId] : l.kind === 'issue' ? [(l.after as { studentId: string }).studentId] : [])),
    ...g.tasks.map(t => t.subject),
  ].filter((x): x is string => Boolean(x)))]
  // The lens shows the name the coach uses: the nickname, else the first name.
  const names = new Map(ids.length ? (await db.select({ id: students.id, name: students.name, nickname: students.nickname }).from(students).where(inArray(students.id, ids)))
    .map(s => [s.id, s.nickname || first(s.name)]) : [])
  const nameOf = (id: string | null) => (id ? names.get(id) ?? 'student' : null)

  // Rank: restored only while the belt is still what this utterance set; otherwise kept, with its metric row.
  const rankRows = g.ledger.filter(l => l.kind === 'rank')
  const belts = rankRows.length ? await db.select({ id: students.id, belt: students.belt }).from(students).where(inArray(students.id, rankRows.map(r => r.entityId))) : []
  const rankRestores: { studentId: string; before: RankState }[] = []
  const keptRank: string[] = []
  for (const l of rankRows) {
    const before = l.before as RankState, after = l.after as RankState
    const now = belts.find(c => c.id === l.entityId)
    if (now && now.belt.toLowerCase() === after.belt.toLowerCase()) {
      rankRestores.push({ studentId: l.entityId, before })
      reversed.add(`Restored ${nameOf(l.entityId)} rank: ${before.belt}`)
    } else {
      keptRank.push(l.entityId)
      notReversible.add(`Kept ${nameOf(l.entityId)} rank (changed since)`)
    }
  }

  const sent = g.mail.filter(m => m.status === 'sent' || m.status === 'sending' || m.status === 'handed_off')
  const familyOf = async (studentId: string) => ((await modeForStudent(db, studentId)).recipient === 'client' ? '' : "'s family")
  for (const n of g.ns) reversed.add(n.studentId ? `Removed ${nameOf(n.studentId)} note` : 'Removed unassigned note')
  for (const b of g.bills) reversed.add(b.studentId ? `Removed billing flag for ${nameOf(b.studentId)}` : 'Removed billing flag')
  for (const m of g.metrics) {
    if (m.key !== 'rank') reversed.add(`Removed ${nameOf(m.studentId)} ${m.key} ${m.value}`)
    else if (!rankRows.some(r => r.entityId === m.studentId)) reversed.add(`Removed ${nameOf(m.studentId)} rank reading`)
  }
  for (const l of g.ledger.filter(x => x.kind === 'issue')) {
    const a = l.after as { studentId: string; tag: string }
    reversed.add(`Removed ${nameOf(a.studentId)} ${a.tag} issue`)
  }
  for (const m of g.mail) if (m.status === 'pending_review' || m.status === 'error') cancelled.add(`Cancelled email draft for ${nameOf(m.studentId)}`)
  for (const m of sent) notReversible.add(`Email already sent to ${nameOf(m.studentId)}${await familyOf(m.studentId)}`)
  for (const t of g.tasks) {
    if (t.kind === 'parent_email') {
      if (!sent.some(m => m.studentId === t.subject)) cancelled.add(`Cancelled email draft for ${nameOf(t.subject)}`)
    } else cancelled.add(t.kind === 'auto_adjust' ? 'Cancelled next-class plan change' : 'Cancelled plan request')
  }

  // Plans drafted for this utterance's planner work: removed while unstarted, with their drills and diffs.
  const drafted: string[] = []
  for (const l of g.ledger.filter(x => x.kind === 'deck_drafted')) {
    const [d] = await db.select({ id: decks.id }).from(decks).where(eq(decks.id, l.entityId))
    if (!d) continue
    if (await isStarted(db, d.id)) { notReversible.add('Kept next-class plan (class started)'); continue }
    drafted.push(d.id)
    reversed.add('Removed drafted next-class plan')
  }
  if (g.diffs.some(d => d.status === 'pending' && !drafted.includes(d.deckId))) cancelled.add('Withdrew plan suggestion')

  const att = await attendancePlan(db, g.ledger.filter(l => l.kind === 'attendance'), labels)
  const drillBuild = await drillPlan(db, g.ledger.filter(l => l.kind === 'drill_added'), labels)

  const build = (h: Db): Query[] => [
    h.delete(notes).where(eq(notes.utteranceId, utteranceId)),
    h.delete(billingFlags).where(eq(billingFlags.utteranceId, utteranceId)),
    keptRank.length
      ? h.delete(studentMetrics).where(and(eq(studentMetrics.utteranceId, utteranceId), not(and(eq(studentMetrics.key, 'rank'), inArray(studentMetrics.studentId, keptRank))!)))
      : h.delete(studentMetrics).where(eq(studentMetrics.utteranceId, utteranceId)),
    ...att.build(h),
    ...rankRestores.map(r => h.update(students).set({ belt: r.before.belt, rankSince: r.before.rankSince }).where(eq(students.id, r.studentId))),
    ...g.ledger.filter(l => l.kind === 'issue').map(l => h.delete(issues).where(eq(issues.id, l.entityId))),
    ...drillBuild(h),
    h.update(outbox).set({ status: 'cancelled' }).where(and(eq(outbox.utteranceId, utteranceId), inArray(outbox.status, ['pending_review', 'error']))),
    h.update(deferredTasks).set({ status: 'cancelled', updatedAt: deps.now() }).where(and(eq(deferredTasks.utteranceId, utteranceId), inArray(deferredTasks.status, ['pending', 'running']))),
    h.update(deckDiffs).set({ status: 'undone' }).where(and(eq(deckDiffs.utteranceId, utteranceId), eq(deckDiffs.status, 'pending'))),
    ...(drafted.length ? [
      h.delete(drills).where(and(inArray(drills.deckId, drafted), sql`${drills.startedAt} is null`)),
      h.delete(deckDiffs).where(inArray(deckDiffs.deckId, drafted)),
      h.delete(decks).where(inArray(decks.id, drafted)),
    ] : []),
  ]

  // After the commit: the attendance count, and applied plan changes reverted from their snapshots.
  const after = async () => {
    if (att.sessionId && att.restored) {
      const present = (await db.select({ s: attendance.status }).from(attendance).where(and(eq(attendance.sessionId, att.sessionId), eq(attendance.status, 'present')))).length
      reversed.add(`Attendance restored (${present} present)`)
    }
    for (const d of g.diffs.filter(x => x.status === 'accepted' && !drafted.includes(x.deckId))) {
      try {
        await undoDiff(db, d.id)
        reversed.add('Reverted plan change')
      } catch (e) {
        notReversible.add(e instanceof Error && /class started/.test(e.message) ? 'Plan change kept (class started)' : 'Plan change kept (plan edited since)')
      }
    }
  }
  return { build, after }
}
