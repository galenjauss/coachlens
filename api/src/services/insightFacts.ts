import { and, asc, eq, inArray, isNotNull, type Column } from 'drizzle-orm'
import type { Db } from '../db/client'
import { attendance, billingFlags, classes, enrollments, issues, notes, sessions, studentMetrics, students } from '../db/schema'
import type { StudentFacts } from '../agents/insights'

/** Loads what the insight detectors need, for the given students (everyone when omitted), in a handful of queries. */
export async function loadFacts(db: Db, studentIds?: readonly string[]): Promise<StudentFacts[]> {
  if (studentIds && !studentIds.length) return []
  const ids = studentIds ? [...studentIds] : null
  const only = (col: Column) => (ids ? inArray(col, ids) : undefined)
  const [studs, enr, att, ns, iss, ms, bills] = await Promise.all([
    db.select().from(students).where(only(students.id)),
    db.select({ studentId: enrollments.studentId, classId: classes.id, mode: classes.mode }).from(enrollments)
      .innerJoin(classes, eq(classes.id, enrollments.classId)).where(only(enrollments.studentId)).orderBy(asc(classes.weekday), asc(classes.id)),
    db.select({ studentId: attendance.studentId, sessionId: attendance.sessionId, status: attendance.status, forDate: sessions.forDate, endedAt: sessions.endedAt })
      .from(attendance).innerJoin(sessions, eq(sessions.id, attendance.sessionId)).where(only(attendance.studentId))
      .orderBy(asc(sessions.forDate), asc(sessions.startedAt)),
    db.select({ studentId: notes.studentId, sessionId: notes.sessionId, tags: notes.tags, createdAt: notes.createdAt }).from(notes)
      .where(and(isNotNull(notes.studentId), only(notes.studentId))).orderBy(asc(notes.createdAt)),
    db.select().from(issues).where(and(eq(issues.status, 'open'), only(issues.studentId))),
    db.select().from(studentMetrics).where(only(studentMetrics.studentId)).orderBy(asc(studentMetrics.recordedAt)),
    db.select().from(billingFlags).where(and(eq(billingFlags.status, 'open'), isNotNull(billingFlags.studentId), only(billingFlags.studentId))).orderBy(asc(billingFlags.createdAt)),
  ])
  const group = <T>(rows: T[], key: (r: T) => string | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows) { const k = key(r); if (k) m.set(k, [...(m.get(k) ?? []), r]) }
    return m
  }
  const primary = new Map<string, (typeof enr)[number]>()
  for (const e of enr) if (!primary.has(e.studentId)) primary.set(e.studentId, e)
  const byAtt = group(att, r => r.studentId), byNote = group(ns, r => r.studentId), byIssue = group(iss, r => r.studentId)
  const byMetric = group(ms, r => r.studentId), byBill = group(bills, r => r.studentId)
  return studs.map(s => ({
    id: s.id, name: s.name, belt: s.belt, rankSince: s.rankSince,
    classId: primary.get(s.id)?.classId ?? null,
    mode: primary.get(s.id)?.mode ?? 'martial_arts',
    attendance: (byAtt.get(s.id) ?? []).map(a => ({ sessionId: a.sessionId, forDate: a.forDate, status: a.status, ended: a.endedAt !== null })),
    notes: (byNote.get(s.id) ?? []).map(n => ({ sessionId: n.sessionId, tags: n.tags, createdAt: n.createdAt })),
    openIssues: (byIssue.get(s.id) ?? []).map(i => ({ id: i.id, tag: i.tag, openedAt: i.openedAt })),
    metrics: (byMetric.get(s.id) ?? []).map(m => ({ key: m.key, value: m.value, num: m.num, unit: m.unit, recordedAt: m.recordedAt })),
    openBilling: (byBill.get(s.id) ?? []).map(b => ({ note: b.note, createdAt: b.createdAt })),
  }))
}

/** Student ids enrolled in a class. */
export async function rosterIds(db: Db, classId: string): Promise<string[]> {
  return (await db.select({ id: enrollments.studentId }).from(enrollments).where(eq(enrollments.classId, classId))).map(r => r.id)
}
