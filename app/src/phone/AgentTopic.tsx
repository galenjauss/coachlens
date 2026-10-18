import type { AgentTask, AgentTaskRun } from '@matside/shared'
import type { Api } from '../core/api'
import { AgentBadge } from './AgentBadge'
import { relTime, taskLabel } from './agentsLogic'
import { usePoll } from './usePoll'

export function AgentTopic({ api, task, onBack, onOpenRun }: { api: Api; task: AgentTask; onBack(): void; onOpenRun(id: string): void }) {
  const { data, error, loading, reload } = usePoll(() => api.agentTask(task), 5000, [task])
  return (
    <main className="screen">
      <button type="button" className="back" onClick={onBack}>‹ Agents</button>
      <h1>{taskLabel(task)}</h1>
      <div className="sub" role="status">{data ? `${data.length} ${data.length === 1 ? 'run' : 'runs'}, newest first` : loading ? 'Loading…' : ''}</div>
      {error && <p className="error" role="alert">Couldn’t load runs: {error} <button type="button" className="inline" onClick={reload}>Retry</button></p>}
      <ul className="rowlist">
        {data?.map((r: AgentTaskRun) => (
          <li key={r.id}>
            <button type="button" className={`runrow ${r.color}`} onClick={() => onOpenRun(r.id)}>
              <span className="runrow-head"><AgentBadge color={r.color} failed={r.status === 'error'} /><time className="muted" dateTime={r.createdAt}>{relTime(r.createdAt)}</time></span>
              <span className="runrow-sum">{r.summary}</span>
              <span className="muted runrow-why">{r.reason}</span>
            </button>
          </li>
        ))}
      </ul>
      {data?.length === 0 && <p className="muted empty">Nothing here yet.</p>}
    </main>
  )
}
