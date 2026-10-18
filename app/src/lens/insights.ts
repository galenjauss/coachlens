import type { Insight } from '@matside/shared'
import type { LensState } from './state'

/** Insights still worth surfacing: dismissed or accepted ones are done. */
const live = (i: Insight): boolean => i.status !== 'dismissed' && i.status !== 'accepted'

/**
 * The one insight a single slot shows (lobby, wrap-up): with `sinceMs`, ones created since then (this
 * session) come first; then high urgency; ties keep the server's order.
 */
export function topInsight(list: readonly Insight[], sinceMs: number | null = null): Insight | null {
  const score = (i: Insight) => (sinceMs !== null && Date.parse(i.createdAt) >= sinceMs ? 0 : 2) + (i.urgency === 'high' ? 0 : 1)
  return list.filter(live).reduce<Insight | null>((best, i) => (!best || score(i) < score(best) ? i : best), null)
}

/** From the in-class poll: the high-urgency items not surfaced yet this session, in the server's order. */
export function freshInsights(s: Pick<LensState, 'insightKnown'>, list: readonly Insight[]): Insight[] {
  return list.filter(i => live(i) && i.urgency === 'high' && !s.insightKnown.includes(i.id))
}

/** Every in-class insight surface cleared (a new session starts, or class is over). */
export const NO_INSIGHTS: Pick<LensState, 'insightBanner' | 'insightUnseen' | 'insightKnown' | 'insightDetail'> = {
  insightBanner: null, insightUnseen: [], insightKnown: [], insightDetail: null,
}
