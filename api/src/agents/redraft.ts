import { and, desc, eq, gte } from 'drizzle-orm'
import type { RedraftResponse, ReportCardContent } from '@matside/shared'
import type { Deps } from '../deps'
import { drills, notes, outbox, reportCards } from '../db/schema'
import { modeForStudent } from '../services/context'
import { withRun } from './runs'
import { EmailOut, parentEmailInstructions } from './parentEmail'
import { ReportCardOut, reportCardInstructions } from './reportCard'

export type RedraftResult =
  | { ok: true; item: RedraftResponse }
  | { ok: false; code: 'not_found' | 'not_pending' | 'agent_failed'; error: string }

const STEER = '\n- The coach is steering a draft you already wrote. Apply their instruction, keep everything else that still fits, and stay grounded in the facts given.'

/** Re-run the email or report-card agent on a pending draft with the coach's instruction. Same row, still pending_review. */
export async function redraftOutbox(deps: Deps, id: string, instruction: string): Promise<RedraftResult> {
  const { db } = deps
  const [row] = await db.select().from(outbox).where(eq(outbox.id, id))
  if (!row) return { ok: false, code: 'not_found', error: 'draft not found' }
  if (row.status !== 'pending_review') return { ok: false, code: 'not_pending', error: 'draft is not pending' }
  const mode = await modeForStudent(db, row.studentId, row.sessionId)
  const [card] = row.kind === 'report_card' ? await db.select().from(reportCards).where(eq(reportCards.outboxId, id)) : []
  const since = new Date(deps.now().getTime() - 30 * 86_400_000)
  const recent = await db.select({ text: notes.text, at: notes.createdAt, drill: drills.name }).from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
    .where(and(eq(notes.studentId, row.studentId), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)).limit(10)
  const prompt = [
    `Coach: ${deps.env.instructorName}`,
    `Coach's instruction: """${instruction}"""`,
    `Current subject: ${row.subject}`,
    'Current body:', row.body,
    ...(card ? ['Current report card (JSON):', JSON.stringify(card.content)] : []),
    'Recent coach notes (newest first; ground any new detail in these):',
    ...(recent.length ? recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`) : ['- none']),
  ].join('\n')
  const out = await withRun(deps, { agent: row.kind, trigger: 'redraft', sessionId: row.sessionId, links: { outboxId: id, studentId: row.studentId } }, async () => {
    let next: { subject: string; body: string }
    let content: ReportCardContent | null = null
    if (row.kind === 'report_card') {
      const rc = await deps.llm.object({ name: 'report_card.redraft', instructions: reportCardInstructions(mode) + STEER, prompt, schema: ReportCardOut })
      content = rc.content
      next = rc
    } else {
      next = await deps.llm.object({ name: 'parent_email.redraft', instructions: parentEmailInstructions(mode) + STEER, prompt, schema: EmailOut })
    }
    const [saved] = await db.update(outbox).set({ subject: next.subject, body: next.body })
      .where(and(eq(outbox.id, id), eq(outbox.status, 'pending_review'))).returning()
    if (!saved) throw new Error('draft is not pending')
    if (card && content) await db.update(reportCards).set({ content }).where(eq(reportCards.id, card.id))
    return { result: saved, summary: `Redrafted "${next.subject}"`, reason: `coach: "${instruction.slice(0, 80)}"`, output: next }
  })
  if (!out) {
    const [now] = await db.select({ status: outbox.status }).from(outbox).where(eq(outbox.id, id))
    return now?.status !== 'pending_review'
      ? { ok: false, code: 'not_pending', error: 'draft is not pending' }
      : { ok: false, code: 'agent_failed', error: 'redraft failed' }
  }
  return { ok: true, item: { id: out.id, kind: out.kind, subject: out.subject, body: out.body, status: 'pending_review' } }
}
