import { and, desc, eq, gte, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { ModeConfig, SkillTag } from '@matside/shared'
import type { Deps } from '../deps'
import { drills, guardians, issues, notes, outbox, students } from '../db/schema'
import { withRun } from './runs'
import { modeForStudent } from '../services/context'
import { getAutonomy } from '../services/settings'
import { approveOutbox } from '../services/review'

const COACH: Record<ModeConfig['id'], string> = {
  martial_arts: "a kids' martial arts instructor",
  personal_training: 'a personal trainer',
  tutoring: 'a tutor',
}

/** Email-writer system prompt. Parent modes write to the guardian; client mode writes to the person themself. */
export function parentEmailInstructions(mode: ModeConfig): string {
  const head = mode.recipient === 'client'
    ? [
        `You write short emails from ${COACH[mode.id]} to their ${mode.person}.`,
        `- Address the ${mode.person} directly in second person ("you"); they are the reader.`,
        '- 80-140 words, plain text, warm and specific. Open with something genuinely positive from the notes.',
        `- Explain the one thing being worked on, referencing the actual ${mode.planItem}(s) from the notes.`,
        '- Give exactly one simple between-session tip (under 5 minutes, safe, no equipment).',
      ]
    : [
        `You write short emails from ${COACH[mode.id]} to a ${mode.person}'s parent.`,
        '- 80-140 words, plain text, warm and specific. Open with something genuinely positive from the notes.',
        `- Explain the one thing being worked on, referencing the actual ${mode.planItem}(s) from the notes.`,
        '- Give exactly one fun at-home tip (under 5 minutes, safe, no equipment).',
      ]
  return [...head, '- No financial advice. No guilt or pressure.', `- ${mode.guardrails}`, '- Sign off as the coach name given.'].join('\n')
}

export const EmailOut = z.object({ subject: z.string().min(3).max(80), body: z.string().min(40) })
const DAY = 86_400_000
export const EMAIL_COOLDOWN_DAYS = 30
/**
 * Triggers that are automatic and not urgent: at most one such email per student per cooldown window.
 * Since v2 nothing in the live pipeline drafts a 'recurring' email (recurring issues feed the report card);
 * the cooldown exists so any future automatic trigger added here is rate-limited by default.
 */
const AUTO_TRIGGERS = ['recurring'] as const

export type EmailTrigger =
  | { kind: 'request'; content: string } // explicit "email Priya's mom that…": always drafts
  | { kind: 'urgent'; content: string } // injury / safety / serious behavior: always drafts
  | { kind: 'recurring'; tag: SkillTag } // automatic, non-urgent: subject to the cooldown

/** True when the student already got a non-urgent automatic email inside the cooldown window. */
export async function inEmailCooldown(deps: Deps, studentId: string): Promise<boolean> {
  const since = new Date(deps.now().getTime() - EMAIL_COOLDOWN_DAYS * DAY)
  const [hit] = await deps.db.select({ id: outbox.id }).from(outbox)
    .where(and(eq(outbox.studentId, studentId), eq(outbox.kind, 'parent_email'), inArray(outbox.trigger, [...AUTO_TRIGGERS]), gte(outbox.createdAt, since))).limit(1)
  return Boolean(hit)
}

export async function draftParentEmail(
  deps: Deps,
  a: { studentId: string; sessionId: string | null; utteranceId?: string | null; trigger: EmailTrigger },
): Promise<string | null> {
  const { db } = deps
  const meta = { agent: 'parent_email', trigger: a.trigger.kind, sessionId: a.sessionId, utteranceId: a.utteranceId ?? null, links: { studentId: a.studentId } }
  const autonomy = await getAutonomy(deps.db, 'parent_email')
  if (autonomy === 'off') {
    await withRun(deps, meta, async () => ({ result: null, summary: 'Parent email skipped (off)', reason: 'autonomy: off — parent emails are turned off in Settings' }))
    return null
  }
  if (a.trigger.kind === 'recurring' && await inEmailCooldown(deps, a.studentId)) {
    await withRun(deps, meta, async () => ({ result: null, summary: `Skipped auto note (one per ${EMAIL_COOLDOWN_DAYS} days)`, reason: 'email cooldown' }))
    return null
  }
  return withRun(deps, meta, async () => {
    const [s] = await db.select().from(students).where(eq(students.id, a.studentId))
    const [g] = await db.select().from(guardians).where(eq(guardians.studentId, a.studentId))
    if (!s || !g) throw new Error(`no student/guardian for ${a.studentId}`)
    const since = new Date(deps.now().getTime() - 30 * DAY)
    const recent = await db.select({ text: notes.text, at: notes.createdAt, drill: drills.name })
      .from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
      .where(and(eq(notes.studentId, a.studentId), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)).limit(8)
    const open = await db.select({ tag: issues.tag }).from(issues).where(and(eq(issues.studentId, a.studentId), eq(issues.status, 'open')))
    const mode = await modeForStudent(db, s.id, a.sessionId)
    const toClient = mode.recipient === 'client'
    const firstName = s.name.split(' ')[0]
    const reader = toClient ? `the ${mode.person}` : 'the parent'
    const why = a.trigger.kind === 'recurring'
      ? `Recurring focus area: ${mode.tagLabels[a.trigger.tag] ?? a.trigger.tag}`
      : a.trigger.kind === 'urgent'
        ? `URGENT — coach logged this today and ${reader} should hear it now (observation only, no diagnosis): ${a.trigger.content}`
        : `Coach asked to tell ${reader}: ${a.trigger.content}`
    const who = toClient
      ? [`Client: ${firstName} (writing to them directly)`]
      : [`${mode.person === 'student' ? 'Student' : 'Person'}: ${firstName}${mode.id === 'martial_arts' ? ` (${s.belt} belt)` : ''}`, `Parent: ${g.name}`]
    const prompt = [
      `Coach: ${deps.env.instructorName}`, ...who, why,
      `Open focus areas: ${open.map(o => o.tag).join(', ') || 'none'}`,
      `Recent coach notes (newest first):`, ...recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`),
    ].join('\n')
    const email = await deps.llm.object({ name: 'parent_email', instructions: parentEmailInstructions(mode), prompt, schema: EmailOut })
    const [row] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s.id, sessionId: a.sessionId, toEmail: g.email, subject: email.subject, body: email.body, trigger: a.trigger.kind }).returning()
    const sent = autonomy === 'auto' ? await approveOutbox(deps, row!.id) : null
    const note = sent ? (sent.ok ? ' and sent' : ` (auto-send failed: ${sent.error}; left for review)`) : ''
    return {
      result: row!.id,
      summary: `Drafted ${a.trigger.kind === 'urgent' ? 'urgent ' : ''}note to ${g.name} (${firstName}): "${email.subject}"${note}`,
      reason: autonomy === 'auto' ? `${why} · autonomy: auto` : why,
      output: email, links: { outboxId: row!.id },
    }
  })
}
