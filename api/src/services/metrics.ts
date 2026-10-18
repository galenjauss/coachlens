import { asc, desc, eq } from 'drizzle-orm'
import type { StudentMetric } from '@matside/shared'
import type { Db } from '../db/client'
import { studentMetrics } from '../db/schema'
import { changeFor, normalizeKey, type Change } from '../logic/metrics'

type Row = typeof studentMetrics.$inferSelect
export const toMetricView = (r: Row): StudentMetric => ({ id: r.id, key: r.key, value: r.value, num: r.num, unit: r.unit, recordedAt: r.recordedAt.toISOString(), source: r.source })

/** All of a student's readings, newest first. */
export async function listMetrics(db: Db, studentId: string): Promise<Row[]> {
  return db.select().from(studentMetrics).where(eq(studentMetrics.studentId, studentId)).orderBy(desc(studentMetrics.recordedAt))
}

export interface NewMetric { studentId: string; key: string; value: string; num?: number | null; unit?: string | null; source: 'voice' | 'phone' | 'seed'; utteranceId?: string | null; recordedAt?: Date }

/** Inserts one reading and reports what it means against the earlier readings of the same key. */
export async function recordMetric(db: Db, m: NewMetric, isGrade: boolean): Promise<{ row: Row; change: Change }> {
  const key = normalizeKey(m.key)
  const prior = (await db.select().from(studentMetrics).where(eq(studentMetrics.studentId, m.studentId)).orderBy(asc(studentMetrics.recordedAt)))
    .filter(r => r.key === key && r.num !== null).map(r => r.num as number)
  const num = m.num ?? null
  const [row] = await db.insert(studentMetrics).values({
    studentId: m.studentId, key, value: m.value, num, unit: m.unit ?? null, source: m.source, utteranceId: m.utteranceId ?? null,
    ...(m.recordedAt ? { recordedAt: m.recordedAt } : {}),
  }).returning()
  return { row: row!, change: key === 'rank' ? null : changeFor(isGrade, num, prior) }
}

export async function deleteMetric(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(studentMetrics).where(eq(studentMetrics.id, id)).returning({ id: studentMetrics.id })
  return rows.length > 0
}
