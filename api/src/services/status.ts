import { eq } from 'drizzle-orm'
import type { DegradedReason, StatusResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { llmUsage } from '../db/schema'
import { localDate } from '../logic/dates'

/**
 * Degraded-mode status for the wearer: Anthropic calls used and left today against the configured cap (the same
 * llm_usage counter the budget increments, failed calls included) and whether speech-to-text has a key.
 */
export async function getStatus(deps: Deps): Promise<StatusResponse> {
  const day = localDate(deps.now(), deps.env.timeZone)
  const [row] = await deps.db.select({ calls: llmUsage.calls }).from(llmUsage).where(eq(llmUsage.day, day))
  const usedToday = row?.calls ?? 0
  const dailyCap = deps.env.aiDailyCap ?? null
  const exhausted = dailyCap !== null && usedToday >= dailyCap
  const sttConfigured = deps.env.sttConfigured ?? true
  const degraded: DegradedReason[] = [...(exhausted ? ['ai_budget_reached' as const] : []), ...(sttConfigured ? [] : ['speech_to_text_unconfigured' as const])]
  return {
    ai: { counts: 'anthropic_calls', day, dailyCap, usedToday, remainingToday: dailyCap === null ? null : Math.max(0, dailyCap - usedToday), exhausted },
    stt: { configured: sttConfigured },
    degraded,
  }
}
