import { and, eq, lt } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import type { Db } from '../db/client'
import { operations } from '../db/schema'

/**
 * C1 · idempotency for queued phone/lens work. One row per (instructor, Idempotency-Key):
 * - first request: a pending row is inserted, the work runs, the response is stored and the row marked done;
 * - retry of a done key: the stored response is replayed (Idempotent-Replay: true), nothing runs again;
 * - retry while pending: 409 in_progress (the client keeps the item and retries later);
 * - a failed request deletes its pending row, so the retry runs.
 * Keys are scoped by route: the same opId on /v1/transcribe and /v1/utterance are two operations.
 * neon-http has no interactive transactions, so the response is stored right after the work commits. A pending
 * row older than STALE_MS (the request died mid-way) can be taken over by a retry; work that must not run twice
 * derives its row ids from the key (opEntityId), so a re-run finds what the first run committed.
 */
export const STALE_MS = 5 * 60_000
export const MAX_KEY = 128

export type Claim = { kind: 'run' } | { kind: 'replay'; response: unknown } | { kind: 'in_progress' }

export async function claimOperation(db: Db, instructorId: string, rawKey: string, route: string, now: Date): Promise<Claim> {
  const key = scoped(route, rawKey)
  const [mine] = await db.insert(operations).values({ instructorId, key, route, createdAt: now }).onConflictDoNothing().returning({ key: operations.key })
  if (mine) return { kind: 'run' }
  const [row] = await db.select().from(operations).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key)))
  if (!row) return claimOperation(db, instructorId, rawKey, route, now) // released between the insert and the read
  if (row.status === 'done') return { kind: 'replay', response: row.responseJson }
  const [taken] = await db.update(operations).set({ createdAt: now })
    .where(and(eq(operations.instructorId, instructorId), eq(operations.key, key), eq(operations.status, 'pending'), lt(operations.createdAt, new Date(now.getTime() - STALE_MS))))
    .returning({ key: operations.key })
  return taken ? { kind: 'run' } : { kind: 'in_progress' }
}

export async function completeOperation(db: Db, instructorId: string, rawKey: string, route: string, response: string): Promise<void> {
  const key = scoped(route, rawKey)
  await db.update(operations).set({ status: 'done', responseJson: response }).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key)))
}

export async function releaseOperation(db: Db, instructorId: string, rawKey: string, route: string): Promise<void> {
  const key = scoped(route, rawKey)
  await db.delete(operations).where(and(eq(operations.instructorId, instructorId), eq(operations.key, key), eq(operations.status, 'pending')))
}

const scoped = (route: string, key: string) => `${route}:${key}`

/**
 * A deterministic UUID (RFC 4122 version 5, SHA-1) for the row an operation creates, from (instructor, route, key):
 * a retry after a crash or a 5xx finds the row the first attempt committed instead of creating a second one.
 */
export function opEntityId(instructorId: string, route: string, key: string): string {
  const ns = Buffer.from('6f1a2c3e4b5d4e6f8a9b0c1d2e3f4a5b', 'hex') // CoachLens operations namespace
  const h = createHash('sha1').update(ns).update(`${instructorId}\u0000${route}\u0000${key}`).digest()
  h[6] = (h[6]! & 0x0f) | 0x50
  h[8] = (h[8]! & 0x3f) | 0x80
  const x = h.subarray(0, 16).toString('hex')
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`
}
