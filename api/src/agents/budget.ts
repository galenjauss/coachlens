import { sql } from 'drizzle-orm'
import type { Db } from '../db/client'
import { llmUsage, llmUsageInstructor } from '../db/schema'
import { currentInstructorId } from '../http/context'
import { localDate } from '../logic/dates'

export interface Budget { take(): Promise<void> }

export class BudgetExceededError extends Error {
  constructor() {
    super('Daily AI budget reached')
    this.name = 'BudgetExceededError'
  }
}

/** No cap (evals, local scripts). */
export const noBudget: Budget = { async take() {} }

/**
 * Daily AI-call cap stored in llm_usage, keyed by the local day in `tz`.
 * Counts before the call (failed calls still count) with one atomic upsert-increment.
 */
export function dbBudget(db: Db, cap: number, tz: string, now: () => Date, instructorCap: number = cap): Budget {
  if (!Number.isFinite(cap) || cap < 0) throw new Error(`invalid AI daily cap: ${cap}`)
  return {
    async take() {
      const day = localDate(now(), tz)
      // S2: the request's instructor has their own sub-cap, checked first so one coach cannot spend everyone's day.
      const ins = currentInstructorId()
      if (ins) {
        const [mine] = await db.insert(llmUsageInstructor).values({ instructorId: ins, day, calls: 1 })
          .onConflictDoUpdate({ target: [llmUsageInstructor.instructorId, llmUsageInstructor.day], set: { calls: sql`${llmUsageInstructor.calls} + 1` } })
          .returning({ calls: llmUsageInstructor.calls })
        if (!mine || mine.calls > instructorCap) throw new BudgetExceededError()
      }
      const [row] = await db.insert(llmUsage).values({ day, calls: 1 })
        .onConflictDoUpdate({ target: llmUsage.day, set: { calls: sql`${llmUsage.calls} + 1` } })
        .returning({ calls: llmUsage.calls })
      if (!row || row.calls > cap) throw new BudgetExceededError()
    },
  }
}
