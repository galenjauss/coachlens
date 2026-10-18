import type { Insight } from '@matside/shared'
import { ApiError } from '../core/api'

/** The insights API is not deployed yet (404): every insight surface shows nothing. */
export const insightsMissing = (e: unknown): boolean => e instanceof ApiError && e.status === 404

/** Still waiting on the coach (accepted, dismissed and auto-done ones are settled). */
export const isOpen = (i: Pick<Insight, 'status'>): boolean => i.status === 'new'

/** Open insights, high urgency first; ties keep the server's order (newest first). Does not mutate. */
export function openInsights(list: readonly Insight[]): Insight[] {
  return list.filter(isOpen).map((i, n) => ({ i, n })).sort((a, b) => urgencyRank(a.i) - urgencyRank(b.i) || a.n - b.n).map(x => x.i)
}
const urgencyRank = (i: Pick<Insight, 'urgency'>) => (i.urgency === 'high' ? 0 : 1)

/** The full list (Agents → Insights): open ones first (high first), then the settled history, newest first. */
export function sortInsights(list: readonly Insight[]): Insight[] {
  const settled = list.filter(i => !isOpen(i)).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return [...openInsights(list), ...settled]
}

/** What the coach did (or the agent did on its own), shown in place of the buttons. */
export const STATUS_WORD: Record<string, string> = { accepted: 'Done', dismissed: 'Dismissed', auto_done: 'Done by the agent' }
export const statusWord = (status: string): string => STATUS_WORD[status] ?? ''

/** The accept button: "Do it" when the agent has a next step, "Got it" when the insight is just news. */
export const acceptLabel = (i: Pick<Insight, 'actionLabel'>): string => (i.actionLabel ? 'Do it' : 'Got it')

/** Local outcome of a row on this screen: the accept result stays inline until the screen is left. */
export type RowOutcome = { kind: 'accepted'; text: string } | { kind: 'dismissed' }

/**
 * Today's "From your agents" rows: rows settled on this screen keep their place (the outcome shows
 * inline), then the open insights, up to `max`. Dismissed rows leave. Does not mutate.
 */
export function todayRows(list: readonly Insight[], settled: Readonly<Record<string, RowOutcome>>, kept: readonly Insight[], max = 3): Insight[] {
  const accepted = kept.filter(i => settled[i.id]?.kind === 'accepted')
  const open = openInsights(list).filter(i => !settled[i.id])
  return [...accepted, ...open].slice(0, max)
}
