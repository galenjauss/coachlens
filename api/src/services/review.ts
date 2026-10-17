import { and, desc, eq, isNull } from 'drizzle-orm'
import type { ReviewItem } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { billingFlags, deckDiffs, notes, outbox, students } from '../db/schema'
import { withRun } from '../agents/runs'

const iso = (d: Date) => d.toISOString()
const first = (n: string | null) => (n ? n.split(' ')[0]! : 'Unknown')

export async function listReview(db: Db): Promise<ReviewItem[]> {
  const mail = await db.select({ o: outbox, name: students.name }).from(outbox).innerJoin(students, eq(students.id, outbox.studentId)).where(eq(outbox.status, 'pending_review'))
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

export async function approveOutbox(deps: Deps, id: string, edits: { subject?: string; body?: string } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { db } = deps
  const [row] = await db.select().from(outbox).where(and(eq(outbox.id, id), eq(outbox.status, 'pending_review')))
  if (!row) return { ok: false, error: 'not pending' }
  const subject = edits.subject ?? row.subject
  const body = edits.body ?? row.body
  const to = deps.env.demoEmailOverride ?? row.toEmail
  try {
    await deps.mail.send({ to, subject, text: body })
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    await db.update(outbox).set({ subject, body, error }).where(eq(outbox.id, id))
    return { ok: false, error }
  }
  await db.update(outbox).set({ subject, body, status: 'sent', sentAt: deps.now(), error: null }).where(eq(outbox.id, id))
  await withRun(deps, { agent: 'mailer', trigger: 'approved', sessionId: row.sessionId }, async () => ({
    result: true, summary: `Sent "${subject}" to ${row.toEmail}${deps.env.demoEmailOverride ? ' (demo inbox)' : ''}`, reason: 'instructor approved',
  }))
  return { ok: true }
}

export async function skipOutbox(db: Db, id: string) {
  await db.update(outbox).set({ status: 'skipped' }).where(eq(outbox.id, id))
}

export async function approveAllOutbox(deps: Deps): Promise<{ sent: number; failed: number }> {
  const pending = await deps.db.select({ id: outbox.id }).from(outbox).where(eq(outbox.status, 'pending_review'))
  let sent = 0, failed = 0
  for (const p of pending) ((await approveOutbox(deps, p.id)).ok ? sent++ : failed++)
  return { sent, failed }
}

export async function noteBilling(db: Db, id: string, extraNote: string) {
  const [b] = await db.select().from(billingFlags).where(eq(billingFlags.id, id))
  if (!b) throw new Error('billing flag not found')
  await db.update(billingFlags).set({ note: `${b.note}\n— ${extraNote}` }).where(eq(billingFlags.id, id))
}

export async function handleBilling(db: Db, id: string, extraNote?: string) {
  if (extraNote) await noteBilling(db, id, extraNote)
  await db.update(billingFlags).set({ status: 'handled' }).where(eq(billingFlags.id, id))
}
