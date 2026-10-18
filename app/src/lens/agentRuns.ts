import type { UtteranceRun } from '../core/api'

/** Short lens labels (≤ 9 chars: the right column is narrow) for the agents an utterance can start. */
const LABELS: Record<string, string> = {
  router: 'sorted', progress: 'logged', billing: 'billing', attendance: 'roll call',
  add_drill: 'drill', parent_email: 'email', planner: 'plan', report_card: 'report',
}
const label = (agent: string) => LABELS[agent] ?? agent.replace(/_/g, ' ').slice(0, 9)

export const RUNS_POLL_MS = 2000
export const RUNS_MAX_MS = 30_000
const MAX_LINES = 5

/**
 * The agents this utterance should end up with. The router always runs; the deferred ones are
 * announced by the card lines. This matches the wording built in api/src/logic/cardLines.ts
 * (`linesFor`): "parent note … drafting" (urgent / explicit request → parent_email) and
 * "→ added to next deck" / "√ Planner: next deck suggestion queued" (→ planner). Keep both in sync.
 */
export function expectedAgents(cardLines: string[]): string[] {
  const text = cardLines.join('\n').toLowerCase()
  const out = ['router']
  if (text.includes('parent note')) out.push('parent_email')
  if (text.includes('planner') || text.includes('next deck')) out.push('planner')
  return out
}

/** True once every expected agent has reported a run. */
export function runsDone(runs: UtteranceRun[], cardLines: string[]): boolean {
  const seen = new Set(runs.map(r => r.agent))
  return expectedAgents(cardLines).every(a => seen.has(a))
}

/**
 * Right column of the card, ASCII markers (the firmware font may lack √/✗): one line per agent
 * (latest run wins), `ok` done, `x` failed, `..` still expected while polling, `?` expected but never
 * reported before polling stopped. Before the first poll: a working line. Without the endpoint: the
 * server's card lines.
 */
export function progressLines(card: { lines: string[]; runs: UtteranceRun[] | null; runsFinal: boolean }): string[] {
  if (card.runs === null) return card.runsFinal ? card.lines.slice(0, MAX_LINES) : ['… working']
  const latest = new Map<string, UtteranceRun>()
  for (const r of card.runs) latest.set(r.agent, r)
  const lines = [...latest.values()].map(r => `${r.status === 'error' ? 'x' : 'ok'} ${label(r.agent)}`)
  for (const a of expectedAgents(card.lines)) if (!latest.has(a)) lines.push(`${card.runsFinal ? '?' : '..'} ${label(a)}`)
  return lines.length ? lines.slice(0, MAX_LINES) : ['(no agent runs)']
}
