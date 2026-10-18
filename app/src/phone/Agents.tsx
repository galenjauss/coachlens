import type { Api } from '../core/api'
import { usePoll } from './usePoll'

const LABEL: Record<string, string> = { router: 'Router agent', progress: 'Progress agent', parent_email: 'Parent email agent', planner: 'Planner agent', billing: 'Billing agent', attendance: 'Attendance', report_card: 'Report card agent', mailer: 'Mailer' }
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function Agents({ api }: { api: Api }) {
  const { data, error } = usePoll(() => api.feed(), 2000)
  return (
    <main className="screen">
      <h1>Agents at work</h1>
      <div className="sub" aria-live="polite">{data ? `${data.length} recent actions · live` : 'Loading…'}</div>
      {error && <p className="error" role="alert">{error}</p>}
      {data?.map(r => (
        <article key={r.id} className={`feed ${r.status === 'error' ? 'error' : ''}`}>
          <div className="row"><b className="grow">{LABEL[r.agent] ?? r.agent}</b><time className="muted" dateTime={r.createdAt}>{time(r.createdAt)}</time></div>
          <div>{r.summary}</div>
          <div className="muted">{r.reason}</div>
        </article>
      ))}
    </main>
  )
}
