import { and, asc, count, desc, eq, gt } from 'drizzle-orm'
import type { AgentRunView, RosterStudent, StudentDetail } from '@matside/shared'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { agentRuns, attendance, drills, issues, notes, outbox, reportCards, students } from '../db/schema'

export async function listStudents(db: Db): Promise<RosterStudent[]> {
  return db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt }).from(students).orderBy(asc(students.name))
}

export async function getStudentDetail(deps: Deps, id: string): Promise<StudentDetail> {
  const { db } = deps
  const [s] = await db.select().from(students).where(eq(students.id, id))
  if (!s) throw new Error('student not found')
  const [cc] = await db.select({ n: count() }).from(attendance).where(and(eq(attendance.studentId, id), eq(attendance.status, 'present')))
  const iss = await db.select().from(issues).where(eq(issues.studentId, id))
  const ns = await db.select({ at: notes.createdAt, text: notes.text, drill: drills.name }).from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
    .where(eq(notes.studentId, id)).orderBy(desc(notes.createdAt)).limit(20)
  const [rc] = await db.select({ r: reportCards, status: outbox.status }).from(reportCards).innerJoin(outbox, eq(outbox.id, reportCards.outboxId))
    .where(eq(reportCards.studentId, id)).orderBy(desc(reportCards.month)).limit(1)
  return {
    id: s.id, name: s.name, belt: s.belt,
    age: Number(new Intl.DateTimeFormat('en-CA', { timeZone: deps.env.timeZone, year: 'numeric' }).format(deps.now())) - s.birthYear,
    classCount: cc?.n ?? 0,
    issues: iss.map(i => ({ tag: i.tag, status: i.status })),
    notes: ns.map(n => ({ date: n.at.toISOString().slice(0, 10), drillName: n.drill, text: n.text })),
    reportCard: rc ? { id: rc.r.id, month: rc.r.month, content: rc.r.content, outboxId: rc.r.outboxId, status: rc.status } : null,
  }
}

export async function agentFeed(db: Db, since: Date | null): Promise<AgentRunView[]> {
  const rows = await db.select().from(agentRuns).where(since ? gt(agentRuns.createdAt, since) : undefined).orderBy(desc(agentRuns.createdAt)).limit(50)
  return rows.map(r => ({ id: r.id, agent: r.agent, summary: r.summary, reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString() }))
}
