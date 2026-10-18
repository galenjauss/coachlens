import { useCallback, useState } from 'react'
import type { Insight } from '@matside/shared'
import type { Api } from '../core/api'
import { InsightRow } from './InsightRow'
import { insightsMissing, openInsights, todayRows, type RowOutcome } from './insightsLogic'
import { usePoll } from './usePoll'

/** Insights for one scope; null while the insights API is not deployed (404): the caller shows nothing. */
export function useInsights(api: Api, ms: number) {
  return usePoll(async () => {
    try { return (await api.insights({ scope: 'all' })).insights } catch (e) {
      if (insightsMissing(e)) return null
      throw e
    }
  }, ms)
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

/** Today: "From your agents", up to 3 open insights above the plan. Quiet (renders nothing) when there are none. */
export function FromAgents({ api, onOpenAll }: { api: Api; onOpenAll(): void }) {
  const { data } = useInsights(api, 30_000)
  const { settled, kept, settle } = useSettled()
  if (!data) return null // loading, failed, or the insights API is not there yet
  const rows = todayRows(data, settled, kept)
  if (!rows.length) return null
  const fresh = openInsights(data).filter(i => !settled[i.id]).length // being accepted doesn't count as new
  return (
    <section className="card ideas-card" aria-labelledby="from-agents">
      <header className="ideas-head">
        <span className="ideas-bulb" aria-hidden="true">💡</span>
        <h2 id="from-agents">From your agents</h2>
        {fresh > 0 && <span className="ideas-count">{fresh} new</span>}
      </header>
      <ul className="ideas">
        {rows.map(i => <InsightRow key={i.id} api={api} insight={i} outcome={settled[i.id] ?? null} onSettled={settle(i)} />)}
      </ul>
      <button type="button" className="ideas-all" onClick={onOpenAll}>All insights ›</button>
    </section>
  )
}
