import { useCallback, useState } from 'react'
import type { Insight } from '@matside/shared'
import type { Api } from '../core/api'
import { InsightRow } from './InsightRow'
import { classInsightsQuery, insightsMissing, openInsights, todayRows, type RowOutcome } from './insightsLogic'
import { usePoll } from './usePoll'

/**
 * Insights for one scope; null while the insights API is not deployed (404): the caller shows nothing.
 * `classId` scopes them to that class (F15); undefined = every class (the Agents inbox).
 */
export function useInsights(api: Api, ms: number, classId?: string | null) {
  return usePoll(async () => {
    try { return (await api.insights(classId === undefined ? { scope: 'all' } : classInsightsQuery(classId))).insights } catch (e) {
      if (insightsMissing(e)) return null
      throw e
    }
  }, ms, [classId])
}

/** Settled-on-this-screen outcomes, so an accepted row keeps showing what was done. */
export function useSettled() {
  const [settled, setSettled] = useState<Record<string, RowOutcome>>({})
  const [kept, setKept] = useState<Insight[]>([])
  /** null = forget the row's local state (an accept that failed goes back to its buttons). */
  const settle = useCallback((i: Insight) => (id: string, o: RowOutcome | null) => {
    setSettled(s => { const { [id]: _drop, ...rest } = s; return o ? { ...rest, [id]: o } : rest })
    if (o && o.kind !== 'dismissed') setKept(k => (k.some(x => x.id === id) ? k : [...k, i]))
  }, [])
  return { settled, kept, settle }
}

/**
 * Today: "From your agents" for the SELECTED class (F15), up to 3 open insights below the plan and actions.
 * Quiet (renders nothing) when there are none; "All classes" opens the instructor-wide inbox.
 */
export function FromAgents({ api, classId, className, onOpenAll }: { api: Api; classId: string; className: string; onOpenAll(): void }) {
  const { data } = useInsights(api, 30_000, classId)
  const { settled, kept, settle } = useSettled()
  if (!data) return null // loading, failed, or the insights API is not there yet
  const rows = todayRows(data, settled, kept)
  if (!rows.length) return <button type="button" className="ideas-all standalone" onClick={onOpenAll}>All classes’ insights ›</button>
  const fresh = openInsights(data).filter(i => !settled[i.id]).length // being accepted doesn't count as new
  return (
    <section className="card ideas-card" aria-labelledby="from-agents">
      <header className="ideas-head">
        <span className="ideas-bulb" aria-hidden="true">💡</span>
        <h2 id="from-agents">From your agents <span className="muted scope">· {className}</span></h2>
        {fresh > 0 && <span className="ideas-count">{fresh} new</span>}
      </header>
      <ul className="ideas">
        {rows.map(i => <InsightRow key={i.id} api={api} insight={i} outcome={settled[i.id] ?? null} onSettled={settle(i)} />)}
      </ul>
      <button type="button" className="ideas-all" onClick={onOpenAll}>All classes’ insights ›</button>
    </section>
  )
}
