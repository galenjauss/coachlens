import type { AgentRunLinks } from '@matside/shared'
import { agentRuns } from '../db/schema'
import type { Deps } from '../deps'

export interface RunMeta {
  agent: string
  trigger: string
  sessionId: string | null
  /** The utterance that started this run, so the lens can poll its progress. */
  utteranceId?: string | null
  /** Items this run touched, known up front (the run's result can add more). */
  links?: AgentRunLinks
}

export interface RunResult<T> { result: T; summary: string; reason: string; output?: unknown; links?: AgentRunLinks }

const merged = (a?: AgentRunLinks, b?: AgentRunLinks): AgentRunLinks | null => {
  const l = { ...a, ...b }
  return Object.keys(l).length ? l : null
}

export async function withRun<T>(deps: Deps, meta: RunMeta, fn: () => Promise<RunResult<T>>): Promise<T | null> {
  const t0 = Date.now()
  const base = { agent: meta.agent, trigger: meta.trigger, sessionId: meta.sessionId, utteranceId: meta.utteranceId ?? null }
  try {
    const r = await fn()
    await deps.db.insert(agentRuns).values({ ...base, links: merged(meta.links, r.links), summary: r.summary, reason: r.reason, output: r.output ?? null, status: 'ok', ms: Date.now() - t0 })
    return r.result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[agent:${meta.agent}]`, message)
    await deps.db.insert(agentRuns).values({ ...base, links: merged(meta.links), summary: message.slice(0, 300), reason: 'error', output: null, status: 'error', ms: Date.now() - t0 })
    return null
  }
}
