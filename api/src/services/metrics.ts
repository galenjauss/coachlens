import { asc, desc, eq } from 'drizzle-orm'
import type { StudentMetric } from '@matside/shared'
import type { Db } from '../db/client'
import { studentMetrics, students } from '../db/schema'
import { changeFor, normalizeKey, parseReading, type Change } from '../logic/metrics'

type Row = typeof studentMetrics.$inferSelect
export const toMetricView = (r: Row): StudentMetric => ({ id: r.id, key: r.key, value: r.value, num: r.num, unit: r.unit, recordedAt: r.recordedAt.toISOString(), source: r.source })

/** All of a student's readings, newest first. */
export async function listMetrics(db: Db, studentId: string): Promise<Row[]> {
  return db.select().from(studentMetrics).where(eq(studentMetrics.studentId, studentId)).orderBy(desc(studentMetrics.recordedAt))
}

export interface NewMetric { studentId: string; key: string; value: string; num?: number | null; unit?: string | null; source: 'voice' | 'phone' | 'seed'; utteranceId?: string | null; recordedAt?: Date }

/** Inserts one reading and reports what it means against earlier readings of the same key and unit. */
export async function recordMetric(db: Db, m: NewMetric, isGrade: boolean): Promise<{ row: Row; change: Change }> {
  const key = normalizeKey(m.key)
  // A string-only reading ("225 lb") still carries a number and unit.
  const parsed = m.num == null ? parseReading(m.value) : { num: m.num, unit: null }
  const num = m.num ?? parsed.num
  const unit = m.unit?.trim() || parsed.unit
  const prior = (await db.select().from(studentMetrics).where(eq(studentMetrics.studentId, m.studentId)).orderBy(asc(studentMetrics.recordedAt)))
    .filter(r => r.key === key)
  const [row] = await db.insert(studentMetrics).values({
    studentId: m.studentId, key, value: m.value, num, unit, source: m.source, utteranceId: m.utteranceId ?? null,
    ...(m.recordedAt ? { recordedAt: m.recordedAt } : {}),
  }).returning()
  return { row: row!, change: key === 'rank' ? null : changeFor(isGrade, num, unit, prior) }
}

/**
 * A rank reading also moves the belt. A given date sets rank_since; with none, a changed belt starts today and
 * the same belt leaves rank_since alone. `since` must already be a validated real date (or null).
 */
export async function applyRank(db: Db, studentId: string, value: string, since: string | null, today: string): Promise<string> {
  const [cur] = await db.select({ belt: students.belt }).from(students).where(eq(students.id, studentId))
  const changed = cur?.belt.toLowerCase() !== value.toLowerCase()
  const rankSince = since ?? (changed ? today : null)
  await db.update(students).set({ belt: value, ...(rankSince ? { rankSince } : {}) }).where(eq(students.id, studentId))
  return since ? `rank set, since ${since}` : changed ? 'rank changed today' : 'rank confirmed'
}

export async function deleteMetric(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(studentMetrics).where(eq(studentMetrics.id, id)).returning({ id: studentMetrics.id })
  return rows.length > 0
}
