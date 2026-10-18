import type { AgentTask, AgentTile } from '@matside/shared'
import type { Api } from '../core/api'
import { latestTile, relTime, sortTiles, taskLabel, tileAriaLabel, tileStatus } from './agentsLogic'
import { usePoll } from './usePoll'

export function AgentsTiles({ api, onOpenTopic, onOpenRun }: { api: Api; onOpenTopic(task: AgentTask): void; onOpenRun(id: string, task: AgentTask): void }) {
  const { data, error, loading, reload } = usePoll(() => api.agentsSummary(), 5000)
  const tiles = data ? sortTiles(data) : []
  const latest = data ? latestTile(data) : null
  const total = data?.reduce((n, t) => n + t.counts.today, 0) ?? 0
  return (
    <main className="screen">
      <h1>Agents</h1>
      <div className="sub" role="status">{data ? `${total} ${total === 1 ? 'action' : 'actions'} today · live` : loading ? 'Loading…' : ''}</div>
      {error && <p className="error" role="alert">Couldn’t load agents: {error} <button type="button" className="inline" onClick={reload}>Retry</button></p>}
      {latest?.latest && (
        <button type="button" className={`tile wide ${latest.color}`} onClick={() => onOpenRun(latest.latest!.id, latest.task)} aria-label={`Latest: ${taskLabel(latest.task)}, ${latest.latest.summary}`}>
          <span className="tile-kicker">Latest · {taskLabel(latest.task)} · {relTime(latest.latest.createdAt)}</span>
          <span className="tile-latest">{latest.latest.summary}</span>
        </button>
      )}
      <div className="tiles">
        {tiles.map((t: AgentTile) => (
          <button key={t.task} type="button" className={`tile ${t.color}`} onClick={() => onOpenTopic(t.task)} aria-label={tileAriaLabel(t)}>
            <span className="tile-kicker">{t.label}</span>
            <span className="tile-count" aria-hidden="true">{t.counts.today}</span>
            <span className="tile-status" aria-hidden="true">{tileStatus(t)}</span>
          </button>
        ))}
      </div>
      {data && !tiles.length && <p className="muted empty">No agents have run yet. Speak a note to get started.</p>}
      <p className="muted hint">Red needs you now. Amber waits for review. Green is done.</p>
    </main>
  )
}
