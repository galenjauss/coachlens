import { useState } from 'react'
import type { Api } from '../core/api'
import { usePeopleLabel } from './kvContext'
import { cap, outcomeFor } from './reviewLogic'
import { StudentDetailView } from './StudentDetail'
import { usePoll } from './usePoll'

export function Students({ api }: { api: Api }) {
  const { data, error, loading, reload } = usePoll(() => api.students(), null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const people = usePeopleLabel(api) // from the stored class's mode, never api.today()
  if (open) return <StudentDetailView api={api} id={open} onBack={() => setOpen(null)} />

  async function runAll() {
    if (busy) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.runReportCards()
      setMsg(`Report card agent is drafting ${r.started} ${r.started === 1 ? 'card' : 'cards'}. They’ll appear in Review shortly.`)
    } catch (e) { setErr(outcomeFor(e, 'Drafting').text) } finally { setBusy(false) }
  }
  return (
    <main className="screen">
      <h1>{cap(people)}</h1>
      <div className="sub">{data ? `${data.length} on your roster` : loading ? 'Loading…' : ''}</div>
      <div className="btns tight"><button type="button" disabled={busy} onClick={runAll}>{busy ? 'Starting…' : 'Draft monthly report cards now'}</button></div>
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
      {err && <p className="error" role="alert">{err}</p>}
      {error && <p className="error" role="alert">Couldn’t load {people}: {error} <button type="button" className="inline" onClick={reload}>Retry</button></p>}
      <ul className="rowlist">
        {data?.map(s => (
          <li key={s.id}>
            <button type="button" className="card rowbtn" onClick={() => setOpen(s.id)}>
              <span className="grow">{s.name}{s.nickname ? <span className="muted"> “{s.nickname}”</span> : null}</span><span className="muted">{s.belt} ›</span>
            </button>
          </li>
        ))}
      </ul>
      {data?.length === 0 && <p className="muted empty">No {people} on the roster yet.</p>}
    </main>
  )
}
