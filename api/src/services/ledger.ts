import { and, eq, inArray } from 'drizzle-orm'
import type { Db } from '../db/client'
import { actionLedger, attendance, drills, issues } from '../db/schema'

/**
 * C2 action ledger writers: small helpers the utterance pipeline calls where an action changes existing state.
 * Each records what Undo needs (kind, entity, before, after). Plain inserts tagged with utterance_id need no row.
 */

export type AttendanceBefore = { status: 'present' | 'absent'; source: 'voice' | 'phone' | 'backstop' } | null

/** Records each student's attendance before this utterance first changes it (later changes keep the first "before"). */
export async function recordAttendanceBefore(db: Db, utteranceId: string | null | undefined, sessionId: string, studentIds: string[]): Promise<void> {
  if (!utteranceId || !studentIds.length) return
  const entity = (sid: string) => `${sessionId}:${sid}`
  const [rows, seen] = await Promise.all([
    db.select().from(attendance).where(and(eq(attendance.sessionId, sessionId), inArray(attendance.studentId, studentIds))),
    db.select({ entityId: actionLedger.entityId }).from(actionLedger)
      .where(and(eq(actionLedger.utteranceId, utteranceId), eq(actionLedger.kind, 'attendance'), inArray(actionLedger.entityId, studentIds.map(entity)))),
  ])
  const done = new Set(seen.map(s => s.entityId))
  const fresh = studentIds.filter(id => !done.has(entity(id)))
  if (!fresh.length) return
  await db.insert(actionLedger).values(fresh.map(studentId => {
    const r = rows.find(x => x.studentId === studentId)
    const before: AttendanceBefore = r ? { status: r.status, source: r.source } : null
    return { utteranceId, kind: 'attendance' as const, entityId: entity(studentId), before }
  }))
}

export type RankState = { belt: string; rankSince: string | null }
export async function recordRank(db: Db, utteranceId: string | null | undefined, studentId: string, before: RankState, after: RankState): Promise<void> {
  if (!utteranceId) return
  await db.insert(actionLedger).values({ utteranceId, kind: 'rank', entityId: studentId, before, after })
}

/** Opens a recurring issue and records it, so Undo can remove it. */
export async function openIssue(db: Db, utteranceId: string, v: typeof issues.$inferInsert): Promise<void> {
  const [row] = await db.insert(issues).values(v).returning({ id: issues.id })
  await db.insert(actionLedger).values({ utteranceId, kind: 'issue', entityId: row!.id, after: { studentId: v.studentId, tag: v.tag } })
}

/** Inserts a live drill at `position`, shifting later drills down, and records both so Undo can restore the order. */
export async function addLiveDrill(db: Db, utteranceId: string, deckId: string, position: number, v: Omit<typeof drills.$inferInsert, 'deckId' | 'position'>): Promise<void> {
  const existing = await db.select({ id: drills.id, position: drills.position }).from(drills).where(eq(drills.deckId, deckId))
  const shifted = existing.filter(x => x.position >= position)
  for (const d of shifted) await db.update(drills).set({ position: d.position + 1 }).where(eq(drills.id, d.id))
  const [row] = await db.insert(drills).values({ ...v, deckId, position }).returning({ id: drills.id })
  await db.insert(actionLedger).values({ utteranceId, kind: 'drill_added', entityId: row!.id, before: { shifted }, after: { name: v.name, deckId } })
}
