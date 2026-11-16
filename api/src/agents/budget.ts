import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { llmUsage, llmUsageInstructor } from '../db/schema'
import { currentInstructorId } from '../http/context'
import { localDate } from '../logic/dates'

export interface Budget { take(): Promise<void> }

export class BudgetExceededError extends Error {
  constructor(readonly meter: Meter = 'ai') {
    super(meter === 'ai' ? 'Daily AI budget reached' : `Daily ${meter} budget reached`)
    this.name = 'BudgetExceededError'
  }
}

/** No cap (evals, local scripts). */
export const noBudget: Budget = { async take() {} }

/**
 * What a daily counter counts. Each meter shares the llm_usage / llm_usage_instructor tables under its own key
 * prefix on `day` ("2026-11-16" for AI calls, "stt:2026-11-16" for transcriptions, "signup:…" for new accounts),
 * so no migration is needed and the AI rows keep their existing keys.
 */
export type Meter = 'ai' | 'stt' | 'signup'
export const meterKey = (meter: Meter, day: string, pool: Pool = 'operator'): string =>
  `${pool === 'public' ? 'pub:' : ''}${meter === 'ai' ? '' : `${meter}:`}${day}`

/**
 * Whose money a call spends. Operator accounts (the demo coach, schools the operator set up) and public self-serve
 * accounts have separate daily pools, so a handful of new sign-ups can never use up the operator's day.
 */
export type Pool = 'operator' | 'public'
export interface Caps { cap: number; instructorCap: number }

/** Adds one to the deployment-wide counter for today and returns the new count. */
async function bumpGlobal(db: Db, key: string): Promise<number> {
  const [row] = await db.insert(llmUsage).values({ day: key, calls: 1 })
    .onConflictDoUpdate({ target: llmUsage.day, set: { calls: sql`${llmUsage.calls} + 1` } })
    .returning({ calls: llmUsage.calls })
  return row?.calls ?? Number.POSITIVE_INFINITY
}

async function bumpInstructor(db: Db, instructorId: string, key: string): Promise<number> {
  const [row] = await db.insert(llmUsageInstructor).values({ instructorId, day: key, calls: 1 })
    .onConflictDoUpdate({ target: [llmUsageInstructor.instructorId, llmUsageInstructor.day], set: { calls: sql`${llmUsageInstructor.calls} + 1` } })
    .returning({ calls: llmUsageInstructor.calls })
  return row?.calls ?? Number.POSITIVE_INFINITY
}

export interface MeterOptions {
  meter: Meter; cap: number; instructorCap?: number; tz: string; now: () => Date
  /** Caps for self-serve accounts' own pool, and how to tell such an account; absent = one pool for everyone. */
  publicPool?: Caps & { isPublic(instructorId: string): Promise<boolean> }
}

/**
 * A daily cap keyed by the local day in `tz`. Counts before the work (failed work still counts) with one atomic
 * upsert-increment. The request's instructor has their own sub-cap, checked first, so one account cannot spend
 * everyone's day; the deployment-wide cap is the hard ceiling on what a day can cost.
 */
export function dailyMeter(db: Db, o: MeterOptions): Budget {
  const operator: Caps = { cap: o.cap, instructorCap: o.instructorCap ?? o.cap }
  for (const c of [operator, ...(o.publicPool ? [o.publicPool] : [])]) {
    if (!Number.isFinite(c.cap) || c.cap < 0) throw new Error(`invalid ${o.meter} daily cap: ${c.cap}`)
    if (!Number.isFinite(c.instructorCap) || c.instructorCap < 0) throw new Error(`invalid ${o.meter} per-instructor cap: ${c.instructorCap}`)
  }
  return {
    async take() {
      const day = localDate(o.now(), o.tz)
      const ins = currentInstructorId()
      const pool: Pool = ins && o.publicPool && await o.publicPool.isPublic(ins) ? 'public' : 'operator'
      const caps = pool === 'public' ? o.publicPool! : operator
      const key = meterKey(o.meter, day, pool)
      if (ins && await bumpInstructor(db, ins, key) > caps.instructorCap) throw new BudgetExceededError(o.meter)
      if (await bumpGlobal(db, key) > caps.cap) throw new BudgetExceededError(o.meter)
    },
  }
}

/** Daily Anthropic-call cap (kept for existing callers). */
export function dbBudget(db: Db, cap: number, tz: string, now: () => Date, instructorCap: number = cap, publicPool?: MeterOptions['publicPool']): Budget {
  return dailyMeter(db, { meter: 'ai', cap, instructorCap, tz, now, publicPool })
}

/** Today's count for a meter: the caller's own, and the deployment-wide total. */
export async function meterUsage(db: Db, meter: Meter, day: string, instructorId: string | null, pool: Pool = 'operator'): Promise<{ mine: number; all: number }> {
  const key = meterKey(meter, day, pool)
  const [all] = await db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.day, key))
  const [mine] = instructorId
    ? await db.select({ calls: llmUsageInstructor.calls }).from(llmUsageInstructor)
      .where(and(eq(llmUsageInstructor.instructorId, instructorId), eq(llmUsageInstructor.day, key)))
    : []
  return { mine: mine?.calls ?? 0, all: all?.calls ?? 0 }
}
