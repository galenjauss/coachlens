import type { Api } from '../core/api'
import { useInsights, useSettled } from './FromAgents'
import { InsightRow } from './InsightRow'
import { openInsights, sortInsights } from './insightsLogic'

/** Agents → Insights: every insight, open ones first (accept or dismiss), then what was already handled. */
export function InsightsList({ api }: { api: Api }) {
  const { data, error, loading, reload } = useInsights(api, 15_000)
  const { settled, settle } = useSettled()
  if (loading && !data) return <p className="muted" role="status">Loading…</p>
  if (error && !data) return <p className="error" role="alert">Couldn’t load insights: {error} <button type="button" className="inline" onClick={() => { void reload() }}>Retry</button></p>
  const all = data ? sortInsights(data) : []
  if (!all.length) return <p className="muted empty">Nothing noticed yet. Agents add insights here as patterns show up in your notes.</p>
  const open = openInsights(all).filter(i => !settled[i.id]).length
  return (
    <section className="card ideas-card" aria-labelledby="all-insights">
      <header className="ideas-head">
        <span className="ideas-bulb" aria-hidden="true">💡</span>
        <h2 id="all-insights">{open ? `${open} waiting on you` : 'All caught up'}</h2>
      </header>
      <ul className="ideas">
        {all.map(i => <InsightRow key={i.id} api={api} insight={i} outcome={settled[i.id] ?? null} onSettled={settle(i)} />)}
      </ul>
    </section>
  )
}
