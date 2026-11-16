import { eq, lt, sql } from 'drizzle-orm'
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
/** New accounts one client IP may create per window (a classroom or a family can share an IP). */
export const SIGNUP_IP_LIMIT = 5

let warnedNoIp = false
/**
 * The client IP, from Vercel's own headers only (x-forwarded-for is client-controlled and ignored). Null when
 * neither is present (hosting outside Vercel): the per-IP limit is then skipped rather than putting every client
 * in one bucket that would lock the whole instance out; the per-prefix bucket still applies.
 */
export function clientIp(header: (name: string) => string | undefined): string | null {
  const ip = (header('x-vercel-forwarded-for') ?? header('x-real-ip'))?.split(',')[0]?.trim()
  if (ip) return ip
  if (!warnedNoIp) {
    warnedNoIp = true
    console.warn('[pair] no trusted client-IP header (x-vercel-forwarded-for / x-real-ip): per-IP pairing limit skipped')
  }
  return null
}

/** Drops counters whose window ended (called from the daily cron and, now and then, from bump). */
export async function prunePairAttempts(db: Db, now: Date): Promise<number> {
  const rows = await db.delete(pairAttempts).where(lt(pairAttempts.windowStart, new Date(now.getTime() - PAIR_WINDOW_MS))).returning({ bucket: pairAttempts.bucket })
  return rows.length
}
export const PRUNE_EVERY = 50

/** Adds one attempt to the bucket (a new window starts once the old one expired) and returns the count. */
export async function bump(db: Db, bucket: string, now: Date, prune = Math.random() < 1 / PRUNE_EVERY): Promise<number> {
  if (prune) await prunePairAttempts(db, now)
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

/** Sign-up bucket for a client IP: IPv4 as is, IPv6 by its /64 (one host or network controls a whole /64). */
export function signupIpKey(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head, tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const full = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${full.slice(0, 4).map(g => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

export const prefixBucket = (code: string) => `prefix:${code.trim().slice(0, 3).toLowerCase()}`
