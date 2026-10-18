import { eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { pairAttempts } from '../db/schema'

/**
 * S1 · pairing brute-force limits, counted in the database so every instance shares them and parallel requests are
 * counted (one atomic upsert per attempt, recorded BEFORE the code lookup).
 * - Per client IP: at most IP_LIMIT failed attempts per window. A blocked IP is refused before the lookup; other
 *   IPs are unaffected (no instance-wide lockout).
 * - Per code prefix: failures spread across many IPs on similar guesses are refused too, but a code that matches
 *   is never refused by this shared bucket.
 */
export const PAIR_WINDOW_MS = 10 * 60_000
export const IP_LIMIT = 10
export const PREFIX_LIMIT = 30

/** The client IP, from Vercel's own headers only (x-forwarded-for is client-controlled and ignored). */
export function clientIp(header: (name: string) => string | undefined): string {
  const raw = header('x-vercel-forwarded-for') ?? header('x-real-ip')
  return raw?.split(',')[0]?.trim() || 'local'
}

/** Adds one attempt to the bucket (a new window starts once the old one expired) and returns the count. */
export async function bump(db: Db, bucket: string, now: Date): Promise<number> {
  const since = new Date(now.getTime() - PAIR_WINDOW_MS)
  const [row] = await db.insert(pairAttempts).values({ bucket, count: 1, windowStart: now })
    .onConflictDoUpdate({
      target: pairAttempts.bucket,
      set: {
        count: sql`case when ${pairAttempts.windowStart} < ${since} then 1 else ${pairAttempts.count} + 1 end`,
        windowStart: sql`case when ${pairAttempts.windowStart} < ${since} then ${now} else ${pairAttempts.windowStart} end`,
      },
    }).returning({ count: pairAttempts.count })
  return row?.count ?? 1
}

/** A successful pairing does not count against its IP. */
export async function unbump(db: Db, bucket: string): Promise<void> {
  await db.update(pairAttempts).set({ count: sql`greatest(${pairAttempts.count} - 1, 0)` }).where(eq(pairAttempts.bucket, bucket))
}

export const prefixBucket = (code: string) => `prefix:${code.trim().slice(0, 3).toLowerCase()}`
