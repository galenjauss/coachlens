import { and, eq } from 'drizzle-orm'
import type { DegradedReason, StatusResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { llmUsage, llmUsageInstructor } from '../db/schema'
import { currentInstructorId } from '../http/context'
import { localDate } from '../logic/dates'
import { getAutonomy } from './settings'

/**
 * Degraded-mode status (C5): Anthropic calls made today against the configured cap (the same llm_usage counter the
 * budget increments, failed calls included), whether speech-to-text has a key, and the parent-email mode.
 */
export async function getStatus(deps: Deps): Promise<StatusResponse> {
  const day = localDate(deps.now(), deps.env.timeZone)
  // S2: the caller's own calls and cap; the deployment-wide total only shows as exhaustion, never as a count.
  const ins = currentInstructorId()
  const [all] = await deps.db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.day, day))
  const [mine] = ins ? await deps.db.select({ calls: llmUsageInstructor.calls }).from(llmUsageInstructor)
    .where(and(eq(llmUsageInstructor.instructorId, ins), eq(llmUsageInstructor.day, day))) : []
  const aiCallsToday = mine?.calls ?? 0
  const globalCap = deps.env.aiDailyCap ?? null
  const aiDailyCap = globalCap === null ? null : Math.min(globalCap, deps.env.aiInstructorDailyCap ?? globalCap)
  const globalLeft = globalCap === null ? null : Math.max(0, globalCap - (all?.calls ?? 0))
  const ownLeft = aiDailyCap === null ? null : Math.max(0, aiDailyCap - aiCallsToday)
  const remaining = ownLeft === null ? null : Math.min(ownLeft, globalLeft ?? ownLeft)
  const exhausted = remaining !== null && remaining <= 0
  const sttConfigured = deps.env.sttConfigured ?? true
  const degradedReasons: DegradedReason[] = [...(exhausted ? ['ai_budget_reached' as const] : []), ...(sttConfigured ? [] : ['speech_to_text_unconfigured' as const])]
  return {
    aiCallsToday, aiDailyCap, sttConfigured,
    mailMode: await getAutonomy(deps.db, 'parent_email'),
    degraded: degradedReasons.length > 0,
    degradedReasons,
    aiCallsRemaining: remaining,
    aiCallsCounted: 'anthropic',
    day,
  }
}
