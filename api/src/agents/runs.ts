import { agentRuns } from '../db/schema'
import type { Deps } from '../deps'

export async function withRun<T>(
  deps: Deps,
  meta: { agent: string; trigger: string; sessionId: string | null },
  fn: () => Promise<{ result: T; summary: string; reason: string; output?: unknown }>,
): Promise<T | null> {
  const t0 = Date.now()
  try {
    const r = await fn()
    await deps.db.insert(agentRuns).values({ ...meta, summary: r.summary, reason: r.reason, output: r.output ?? null, status: 'ok', ms: Date.now() - t0 })
    return r.result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[agent:${meta.agent}]`, message)
    await deps.db.insert(agentRuns).values({ ...meta, summary: message.slice(0, 300), reason: 'error', output: null, status: 'error', ms: Date.now() - t0 })
    return null
  }
}
