import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ReviewItem } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { billingFlags, deckDiffs, notes, outbox, students } from '../db/schema'
import { withRun } from '../agents/runs'

const iso = (d: Date) => d.toISOString()
const first = (n: string | null) => (n ? n.split(' ')[0]! : 'Unknown')

export async function listReview(db: Db): Promise<ReviewItem[]> {
  const mail = await db.select({ o: outbox, name: students.name }).from(outbox).leftJoin(students, eq(students.id, outbox.studentId)).where(eq(outbox.status, 'pending_review'))
  const bills = await db.select({ b: billingFlags, name: students.name }).from(billingFlags).leftJoin(students, eq(students.id, billingFlags.studentId)).where(eq(billingFlags.status, 'open'))
  const loose = await db.select().from(notes).where(isNull(notes.studentId)).orderBy(desc(notes.createdAt)).limit(20)
  const diffs = await db.select().from(deckDiffs).where(eq(deckDiffs.status, 'pending'))
  const items: ReviewItem[] = [
    ...mail.map(({ o, name }) => ({ kind: o.kind, id: o.id, studentName: first(name), to: o.toEmail, subject: o.subject, body: o.body, createdAt: iso(o.createdAt) }) as ReviewItem),
    ...bills.map(({ b, name }) => ({ kind: 'billing' as const, id: b.id, studentName: first(name), urgency: b.urgency, note: b.note, amount: b.amount, createdAt: iso(b.createdAt) })),
    ...loose.map(n => ({ kind: 'unassigned_note' as const, id: n.id, heard: n.heard, text: n.text, createdAt: iso(n.createdAt) })),
    ...diffs.map(d => ({ kind: 'deck_diff' as const, id: d.id, deckId: d.deckId, requestText: d.requestText, diff: d.diff, createdAt: iso(d.createdAt) })),
  ]
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type ReviewFail = 'not_found' | 'not_pending'
export type ActionResult = { ok: true } | { ok: false; code: ReviewFail; error: string }
export type ApproveResult = { ok: true } | { ok: false; code: ReviewFail | 'send_failed'; error: string }

const notFound = (what: string): ActionResult => ({ ok: false, code: 'not_found', error: `${what} not found` })
const conflict = (what: string): ActionResult => ({ ok: false, code: 'not_pending', error: `${what} is not pending` })

export async function approveOutbox(deps: Deps, id: string, edits: { subject?: string; body?: string } = {}): Promise<ApproveResult> {
  const { db } = deps
  // Atomic claim: only one concurrent caller can move pending_review -> sending.
  const [row] = await db.update(outbox).set({ status: 'sending' }).where(and(eq(outbox.id, id), eq(outbox.status, 'pending_review'))).returning()
  if (!row) {
    const [exists] = await db.select({ id: outbox.id }).from(outbox).where(eq(outbox.id, id))
    return exists ? { ok: false, code: 'not_pending', error: 'not pending' } : { ok: false, code: 'not_found', error: 'not found' }
  }
  const subject = edits.subject ?? row.subject
  const body = edits.body ?? row.body
  const to = deps.env.demoEmailOverride ?? row.toEmail
  let sendError: string | null = null
  await withRun(deps, { agent: 'mailer', trigger: 'approved', sessionId: row.sessionId, links: { outboxId: id, studentId: row.studentId } }, async () => {
    try {
      await deps.mail.send({ to, subject, text: body })
    } catch (e) {
      sendError = e instanceof Error ? e.message : String(e)
      throw e
    }
    return { result: true, summary: `Sent "${subject}" to ${row.toEmail}${deps.env.demoEmailOverride ? ' (demo inbox)' : ''}`, reason: 'instructor approved' }
  })
  if (sendError !== null) {
    await db.update(outbox).set({ subject, body, status: 'pending_review', error: sendError }).where(eq(outbox.id, id))
    return { ok: false, code: 'send_failed', error: sendError }
  }
  await db.update(outbox).set({ subject, body, status: 'sent', sentAt: deps.now(), error: null }).where(eq(outbox.id, id))
  return { ok: true }
}

export async function skipOutbox(db: Db, id: string): Promise<ActionResult> {
  const done = await db.update(outbox).set({ status: 'skipped' }).where(and(eq(outbox.id, id), eq(outbox.status, 'pending_review'))).returning({ id: outbox.id })
  if (done.length) return { ok: true }
  const [exists] = await db.select({ id: outbox.id }).from(outbox).where(eq(outbox.id, id))
  return exists ? conflict('email') : notFound('email')
}

export async function approveAllOutbox(deps: Deps, ids: string[]): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0
  for (const id of new Set(ids)) ((await approveOutbox(deps, id)).ok ? sent++ : failed++)
  return { sent, failed }
}

export async function noteBilling(db: Db, id: string, extraNote: string): Promise<ActionResult> {
  const [b] = await db.select().from(billingFlags).where(eq(billingFlags.id, id))
  if (!b) return notFound('billing flag')
  await db.update(billingFlags).set({ note: `${b.note}\n— ${extraNote}` }).where(eq(billingFlags.id, id))
  return { ok: true }
}

export async function handleBilling(db: Db, id: string, extraNote?: string): Promise<ActionResult> {
  const [b] = await db.select().from(billingFlags).where(eq(billingFlags.id, id))
  if (!b) return notFound('billing flag')
  if (b.status !== 'open') return conflict('billing flag')
  if (extraNote) await noteBilling(db, id, extraNote)
  await db.update(billingFlags).set({ status: 'handled' }).where(and(eq(billingFlags.id, id), eq(billingFlags.status, 'open')))
  return { ok: true }
}

export async function dismissNote(db: Db, id: string): Promise<ActionResult> {
  const gone = await db.delete(notes).where(and(eq(notes.id, id), isNull(notes.studentId))).returning({ id: notes.id })
  return gone.length ? { ok: true } : notFound('unassigned note')
}
