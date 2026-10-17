import { and, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import type { SkillTag } from '@matside/shared'
import type { Deps } from '../deps'
import { drills, guardians, issues, notes, outbox, students } from '../db/schema'
import { withRun } from './runs'

export const PARENT_EMAIL_INSTRUCTIONS = `You write short emails from a kids' martial arts instructor to a student's parent.
- 80-140 words, plain text, warm and specific. Open with something genuinely positive from the notes.
- Explain the one thing being worked on, referencing the actual drill(s) from the notes.
- Give exactly one fun at-home tip (under 5 minutes, safe, no equipment).
- Never mention other students. No medical or financial advice. No guilt or pressure.
- Sign off as the coach name given.`

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
    const firstName = s.name.split(' ')[0]
    const why = a.trigger.kind === 'recurring' ? `Recurring focus area: ${a.trigger.tag}` : `Instructor asked to tell the parent: ${a.trigger.content}`
    const prompt = [
      `Coach: ${deps.env.instructorName}`, `Student: ${firstName} (${s.belt} belt)`, `Parent: ${g.name}`, why,
      `Open focus areas: ${open.map(o => o.tag).join(', ') || 'none'}`,
      `Recent coach notes (newest first):`, ...recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`),
    ].join('\n')
    const email = await deps.llm.object({ name: 'parent_email', instructions: PARENT_EMAIL_INSTRUCTIONS, prompt, schema: EmailOut })
    const [row] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s.id, sessionId: a.sessionId, toEmail: g.email, subject: email.subject, body: email.body }).returning()
    return { result: row!.id, summary: `Drafted note to ${g.name} (${firstName}): "${email.subject}"`, reason: why, output: email }
  })
}
