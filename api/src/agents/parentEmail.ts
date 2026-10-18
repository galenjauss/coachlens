import { and, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import type { ModeConfig, SkillTag } from '@matside/shared'
import type { Deps } from '../deps'
import { drills, guardians, issues, notes, outbox, students } from '../db/schema'
import { withRun } from './runs'
import { modeForStudent } from '../services/context'

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

const EmailOut = z.object({ subject: z.string().min(3).max(80), body: z.string().min(40) })
const DAY = 86_400_000

export async function draftParentEmail(
  deps: Deps,
  a: { studentId: string; sessionId: string | null; trigger: { kind: 'recurring'; tag: SkillTag } | { kind: 'request'; content: string } },
): Promise<string | null> {
  const { db } = deps
  return withRun(deps, { agent: 'parent_email', trigger: a.trigger.kind, sessionId: a.sessionId }, async () => {
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
    const [row] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s.id, sessionId: a.sessionId, toEmail: g.email, subject: email.subject, body: email.body }).returning()
    return { result: row!.id, summary: `Drafted note to ${g.name} (${firstName}): "${email.subject}"`, reason: why, output: email }
  })
}
