import { and, eq, lt } from 'drizzle-orm'
import type { Db } from '../db/client'
import { operations } from '../db/schema'

/**
 * C1 · idempotency for queued phone/lens work. One row per (instructor, Idempotency-Key):
 * - first request: a pending row is inserted, the work runs, the response is stored and the row marked done;
 * - retry of a done key: the stored response is replayed (Idempotent-Replay: true), nothing runs again;
 * - retry while pending: 409 in_progress (the client keeps the item and retries later);
 * - a failed request deletes its pending row, so the retry runs.
 * neon-http has no interactive transactions, so the response is stored right after the work commits. A pending
 * row older than STALE_MS (the request died mid-way) can be taken over by a retry.
 */
export const STALE_MS = 5 * 60_000
export const MAX_KEY = 128

export type Claim = { kind: 'run' } | { kind: 'replay'; response: unknown } | { kind: 'in_progress' }

export async function claimOperation(db: Db, instructorId: string, key: string, route: string, now: Date): Promise<Claim> {
  const [mine] = await db.insert(operations).values({ instructorId, key, route, createdAt: now }).onConflictDoNothing().returning({ key: operations.key })
  if (mine) return { kind: 'run' }
  const [row] = await db.select().from(operations).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key)))
  if (!row) return claimOperation(db, instructorId, key, route, now) // released between the insert and the read
  if (row.status === 'done') return { kind: 'replay', response: row.responseJson }
  const [taken] = await db.update(operations).set({ createdAt: now })
    .where(and(eq(operations.instructorId, instructorId), eq(operations.key, key), eq(operations.status, 'pending'), lt(operations.createdAt, new Date(now.getTime() - STALE_MS))))
    .returning({ key: operations.key })
  return taken ? { kind: 'run' } : { kind: 'in_progress' }
}

export async function completeOperation(db: Db, instructorId: string, key: string, response: string): Promise<void> {
  await db.update(operations).set({ status: 'done', responseJson: response }).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key)))
}

export async function releaseOperation(db: Db, instructorId: string, key: string): Promise<void> {
  await db.delete(operations).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key), eq(operations.status, 'pending')))
}
