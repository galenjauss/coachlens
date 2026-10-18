import { eq } from 'drizzle-orm'
import type { DegradedReason, StatusResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { llmUsage } from '../db/schema'
import { localDate } from '../logic/dates'
import { getAutonomy } from './settings'

/**
 * Degraded-mode status (C5): Anthropic calls made today against the configured cap (the same llm_usage counter the
 * budget increments, failed calls included), whether speech-to-text has a key, and the parent-email mode.
 */
export async function getStatus(deps: Deps): Promise<StatusResponse> {
  const day = localDate(deps.now(), deps.env.timeZone)
  const [row] = await deps.db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.day, day))
  const aiCallsToday = row?.calls ?? 0
  const aiDailyCap = deps.env.aiDailyCap ?? null
  const exhausted = aiDailyCap !== null && aiCallsToday >= aiDailyCap
  const sttConfigured = deps.env.sttConfigured ?? true
  const degradedReasons: DegradedReason[] = [...(exhausted ? ['ai_budget_reached' as const] : []), ...(sttConfigured ? [] : ['speech_to_text_unconfigured' as const])]
  return {
    aiCallsToday, aiDailyCap, sttConfigured,
    mailMode: await getAutonomy(deps.db, 'parent_email'),
    degraded: degradedReasons.length > 0,
    degradedReasons,
    aiCallsRemaining: aiDailyCap === null ? null : Math.max(0, aiDailyCap - aiCallsToday),
    aiCallsCounted: 'anthropic',
    day,
  }
}
