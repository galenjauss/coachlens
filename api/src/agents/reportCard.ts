import { and, count, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import { ReportCardContent, type ModeConfig } from '@matside/shared'
import type { Deps } from '../deps'
import { attendance, drills, guardians, issues, notes, outbox, reportCards, sessions, students } from '../db/schema'
import { withRun } from './runs'
import { modeForStudent } from '../services/context'
import { getAutonomy } from '../services/settings'

const SUBJECT: Record<ModeConfig['id'], string> = {
  martial_arts: 'a child in a martial arts class, for their parent',
  personal_training: 'a personal training client, written to the client',
  tutoring: 'a tutoring student, for their parent',
}

/** Report-card system prompt: grounded in notes, focused on the mode's reportCardFocus. */
export function reportCardInstructions(mode: ModeConfig): string {
  const reader = mode.recipient === 'client' ? `the ${mode.person}, in second person ("you")` : 'the parent'
  return `You write a monthly progress report card for ${SUBJECT[mode.id]}.
- Focus on: ${mode.reportCardFocus}.
- Ground every statement in the coach notes provided. Quote 2-4 notes in coachNotes with their date and ${mode.planItem}.
- strengths: up to 3 short phrases. workingOn: up to 3 short phrases. nextGoal: one concrete goal for next month.
- body: a 120-180 word warm email to ${reader} that summarizes the card in plain text. Sign as the coach. No financial advice.
- ${mode.guardrails}`
}

export const ReportCardOut = z.object({ content: ReportCardContent, subject: z.string().min(3).max(80), body: z.string().min(60) })
const DAY = 86_400_000

export async function draftReportCard(deps: Deps, studentId: string, month: string): Promise<string | null> {
  const { db } = deps
  const [existing] = await db.select().from(reportCards).where(and(eq(reportCards.studentId, studentId), eq(reportCards.month, month)))
  if (existing) return existing.outboxId
  if (await getAutonomy(db, 'report_card') === 'off') {
    await withRun(deps, { agent: 'report_card', trigger: 'monthly', sessionId: null, links: { studentId } }, async () => ({ result: null, summary: 'Report card skipped (off)', reason: 'autonomy: off — report cards are turned off in Settings' }))
    return null
  }
  return withRun(deps, { agent: 'report_card', trigger: 'monthly', sessionId: null, links: { studentId } }, async () => {
    const [s] = await db.select().from(students).where(eq(students.id, studentId))
    const [g] = await db.select().from(guardians).where(eq(guardians.studentId, studentId))
    if (!s || !g) throw new Error(`no student/guardian ${studentId}`)
    const since = new Date(deps.now().getTime() - 30 * DAY)
    const recent = await db.select({ text: notes.text, at: notes.createdAt, drill: drills.name }).from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
      .where(and(eq(notes.studentId, studentId), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)).limit(15)
    const [present] = await db.select({ n: count() }).from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId))
      .where(and(eq(attendance.studentId, studentId), eq(attendance.status, 'present'), gte(sessions.startedAt, since)))
    const open = await db.select({ tag: issues.tag }).from(issues).where(and(eq(issues.studentId, studentId), eq(issues.status, 'open')))
    const mode = await modeForStudent(db, studentId)
    const firstName = s.name.split(' ')[0]!
    const who = mode.recipient === 'client'
      ? [`Client: ${firstName} (writing to them directly)`]
      : [`Student: ${firstName}${mode.id === 'martial_arts' ? `, ${s.belt} belt` : ''}`, `Parent: ${g.name}`]
    const prompt = [
      `Coach: ${deps.env.instructorName}`, ...who, `Month: ${month}`,
      `Classes attended in the last 30 days (recorded): ${present?.n ?? 0}`, `Open focus areas: ${open.map(o => o.tag).join(', ') || 'none'}`,
      'Coach notes:', ...recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`),
    ].join('\n')
    const out = await deps.llm.object({ name: 'report_card', instructions: reportCardInstructions(mode), prompt, schema: ReportCardOut })
    const [o] = await db.insert(outbox).values({ kind: 'report_card', studentId, toEmail: g.email, subject: out.subject, body: out.body, trigger: 'monthly' }).returning()
    const won = await db.insert(reportCards).values({ studentId, month, content: out.content, outboxId: o!.id }).onConflictDoNothing().returning()
    if (won.length === 0) {
      // A concurrent run drafted this month first: discard our outbox row, return theirs.
      await db.delete(outbox).where(eq(outbox.id, o!.id))
      const [theirs] = await db.select().from(reportCards).where(and(eq(reportCards.studentId, studentId), eq(reportCards.month, month)))
      return { result: theirs!.outboxId, summary: `Report card for ${firstName} already drafted for ${month}`, reason: 'concurrent run won', output: out.content, links: { outboxId: theirs!.outboxId } }
    }
    return { result: o!.id, summary: `Drafted ${month} report card for ${firstName}`, reason: `${recent.length} notes, ${present?.n ?? 0} classes`, output: out.content, links: { outboxId: o!.id } }
  })
}

export async function runReportCards(deps: Deps, studentIds?: string[]): Promise<{ drafted: number }> {
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: deps.env.timeZone, year: 'numeric', month: '2-digit' }).format(deps.now())
  const ids = [...new Set(studentIds ?? (await deps.db.select({ id: students.id }).from(students)).map(r => r.id))]
  let drafted = 0
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(ids.slice(i, i + 4).map(id => draftReportCard(deps, id, month)))
    drafted += batch.filter(Boolean).length
  }
  return { drafted }
}
