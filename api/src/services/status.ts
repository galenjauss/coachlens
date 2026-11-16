import type { DegradedReason, StatusResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { meterUsage } from '../agents/budget'
import { currentInstructorId } from '../http/context'
import { localDate } from '../logic/dates'
import { getAutonomy } from './settings'
import { canSendMail, isSelfServe } from './accounts'

/**
 * Degraded-mode status (C5): Anthropic calls made today against the configured cap (the same llm_usage counter the
 * budget increments, failed calls included), whether speech-to-text has a key, and the parent-email mode.
 */
export async function getStatus(deps: Deps): Promise<StatusResponse> {
  const day = localDate(deps.now(), deps.env.timeZone)
  // S2: the caller's own calls and cap; the deployment-wide total only shows as exhaustion, never as a count.
  const ins = currentInstructorId()
  // A self-serve account reads its own pool (see agents/budget.ts Pool).
  const pub = Boolean(ins && deps.env.publicAi && await isSelfServe(deps.db, ins))
  const usage = await meterUsage(deps.db, 'ai', day, ins, pub ? 'public' : 'operator')
  const aiCallsToday = usage.mine
  const globalCap = pub ? deps.env.publicAi!.cap : deps.env.aiDailyCap ?? null
  const ownCap = pub ? deps.env.publicAi!.instructorCap : deps.env.aiInstructorDailyCap ?? globalCap
  const aiDailyCap = globalCap === null ? null : Math.min(globalCap, ownCap ?? globalCap)
  const globalLeft = globalCap === null ? null : Math.max(0, globalCap - usage.all)
  const ownLeft = aiDailyCap === null ? null : Math.max(0, aiDailyCap - aiCallsToday)
  const remaining = ownLeft === null ? null : Math.min(ownLeft, globalLeft ?? ownLeft)
  const exhausted = remaining !== null && remaining <= 0
  const sttConfigured = deps.env.sttConfigured ?? true
  const degradedReasons: DegradedReason[] = [...(exhausted ? ['ai_budget_reached' as const] : []), ...(sttConfigured ? [] : ['speech_to_text_unconfigured' as const])]
  return {
    aiCallsToday, aiDailyCap, sttConfigured,
    mailMode: await getAutonomy(deps.db, 'parent_email'),
    mailSends: await canSendMail(deps, ins),
    degraded: degradedReasons.length > 0,
    degradedReasons,
    aiCallsRemaining: remaining,
    aiCallsCounted: 'anthropic',
    day,
  }
}
