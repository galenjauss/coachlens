import { useState } from 'react'
import type { Api } from '../core/api'
import type { StudentMetric } from '@matside/shared'
import { groupMetrics, isoDate, parseCustomField, reading, signedDelta } from './metricsLogic'
import { outcomeFor } from './reviewLogic'

const EMPTY = { key: '', value: '', num: '', unit: '' }

export function StudentMetrics({ api, studentId, metrics, onChanged }: { api: Api; studentId: string; metrics: StudentMetric[]; onChanged(): void }) {
  const groups = groupMetrics(metrics.filter(m => m.key !== 'rank'))
  const [open, setOpen] = useState<string | null>(null)
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function act(f: () => Promise<unknown>) {
    if (busy) return
    setBusy(true); setErr(null)
    try { await f(); onChanged() } catch (e) { setErr(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }
  async function add() {
    const p = parseCustomField(draft)
    if (!p.ok) { setErr(p.error); return }
    await act(async () => { await api.addMetric(studentId, p.body); setDraft(EMPTY) })
  }
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => { setDraft(d => ({ ...d, [k]: e.target.value })); setErr(null) }

  return (
    <section className="card" aria-labelledby="sd-metrics">
      <div className="label" id="sd-metrics">Metrics</div>
      {!groups.length && <p className="muted">Nothing logged yet. Say “Maria hit 225 on deadlift” or add a field below.</p>}
      <ul className="metrics">
        {groups.map(g => (
          <li key={g.key} className="metric">
            <button type="button" className="metric-head" aria-expanded={open === g.key} onClick={() => setOpen(open === g.key ? null : g.key)}>
              <span className="metric-name">{g.label}</span>
              <span className={`metric-now${g.best ? ' best' : ''}`}>{reading(g.latest)}</span>
              {g.delta !== null && <span className={`metric-delta ${g.delta > 0 ? 'up' : g.delta < 0 ? 'down' : ''}`}>{g.best ? 'PR ' : ''}{signedDelta(g.delta)}</span>}
              {g.spark && <span className="spark" aria-label={`${g.history.length} readings`}>{g.spark}</span>}
            </button>
            {open === g.key && (
              <ul className="metric-history">
                {g.history.map(h => (
                  <li key={h.id}>
                    <span className="muted">{isoDate(h.recordedAt)}</span>
                    <span className="grow">{h.value !== reading(h) ? `${h.value} · ` : ''}{reading(h)}</span>
                    <button type="button" className="quiet danger" disabled={busy} aria-label={`Delete ${g.label} ${reading(h)} from ${isoDate(h.recordedAt)}`} onClick={() => act(() => api.deleteMetric(h.id))}>Delete</button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <form className="metric-add" onSubmit={e => { e.preventDefault(); void add() }}>
        <div className="label">Add a custom field</div>
        <div className="metric-add-grid">
          <label className="sr-only" htmlFor="mf-key">Field name</label>
          <input id="mf-key" placeholder="Name (mile time)" value={draft.key} maxLength={40} disabled={busy} onChange={set('key')} />
          <label className="sr-only" htmlFor="mf-value">Value</label>
          <input id="mf-value" placeholder="Value (optional)" value={draft.value} maxLength={80} disabled={busy} onChange={set('value')} />
          <label className="sr-only" htmlFor="mf-num">Number</label>
          <input id="mf-num" placeholder="Number" inputMode="decimal" value={draft.num} disabled={busy} onChange={set('num')} />
          <label className="sr-only" htmlFor="mf-unit">Unit</label>
          <input id="mf-unit" placeholder="Unit" value={draft.unit} maxLength={12} disabled={busy} onChange={set('unit')} />
        </div>
        <div className="btns"><button type="submit" className="primary" disabled={busy || !draft.key.trim()}>{busy ? 'Saving…' : 'Add field'}</button></div>
      </form>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
