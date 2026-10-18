import { useCallback, useState } from 'react'
import type { AgentRunDetail } from '@matside/shared'
import type { Api } from '../core/api'
import { AgentBadge } from './AgentBadge'
import { relTime, steeringFor, STEERING_PROMPT, taskLabel } from './agentsLogic'
import { DiffList } from './Review'
import { useAction } from './useAction'
import { usePoll } from './usePoll'

function OutputCard({ r }: { r: AgentRunDetail }) {
  return (
    <section className="card" aria-labelledby="ar-out">
      <div className="label" id="ar-out">Agent output</div>
      <div className="subject">{r.summary}</div>
      <div className="muted">{r.reason}</div>
      {r.outbox && (
        <div className="linked">
          <div className="card-head"><span className="pill">{r.outbox.kind === 'report_card' ? 'Report card' : 'Email'}</span><span className="pill">{r.outbox.status.replace(/_/g, ' ')}</span>{r.outbox.urgent && <span className="pill high">urgent</span>}</div>
          <div className="muted">to {r.outbox.to}</div>
          <div className="subject">{r.outbox.subject}</div>
          <div className="pre muted">{r.outbox.body}</div>
        </div>
      )}
      {r.billing && (
        <div className="linked">
          <div className="card-head"><span className={`pill ${r.billing.urgency === 'high' ? 'high' : ''}`}>Billing · {r.billing.urgency.toUpperCase()}</span><span className="pill">{r.billing.status}</span></div>
          <div className="pre">{r.billing.note}{r.billing.amount != null ? ` · $${r.billing.amount}` : ''}</div>
        </div>
      )}
      {r.diff && (
        <div className="linked">
          <div className="card-head"><span className="pill">Plan change · {r.diff.status}</span></div>
          <DiffList diff={r.diff.diff} />
        </div>
      )}
      {r.note && (
        <div className="linked">
          <div className="card-head"><span className="pill">Note</span>{r.studentName ? <span className="muted">{r.studentName}</span> : <span className="pill warn">unassigned</span>}</div>
          <div className="pre">{r.note.text}</div>
        </div>
      )}
    </section>
  )
}

/** "Tell this agent…" box; every call costs Claude credit, so it never runs on its own and locks while in flight. */
function SteerBox({ api, r, reload }: { api: Api; r: AgentRunDetail; reload(): Promise<void> }) {
  const kind = steeringFor(r)
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const onNotice = useCallback((t: string) => setNotice(t), [])
  const { busy, err, run } = useAction(onNotice, reload, 'Request')
  const roster = usePoll(() => api.students(), null, [], kind === 'reassign')
  if (kind === 'none') return null
  const t = text.trim()

  if (kind === 'reassign' && r.note) {
    const note = r.note
    return (
      <section className="card" aria-labelledby="ar-tell">
        <div className="label" id="ar-tell">Tell this agent…</div>
        <p className="muted">Wrong student? Reassign this note.</p>
        <div className="chips" role="group" aria-label="Assign note to">
          {roster.data?.map(s => (
            <button key={s.id} type="button" disabled={busy} aria-pressed={note.studentId === s.id} aria-label={`Assign to ${s.name}`}
              onClick={() => run(() => api.assignNote(note.id, s.id), `Assigned to ${s.name.split(' ')[0]}.`)}>{s.name}</button>
          ))}
          {!roster.data && <span className="muted" role="status">Loading roster…</span>}
        </div>
        <div aria-live="polite">{notice && <p className="notice">{notice}</p>}</div>
        {err && <p className="error" role="alert">{err}</p>}
      </section>
    )
  }

  const cfg = STEERING_PROMPT[kind as Exclude<typeof kind, 'none' | 'reassign'>]
  const go = () => {
    if (!t) return
    if (kind === 'redraft' && r.outbox) { const id = r.outbox.id; void run(async () => { await api.redraft(id, t); setText('') }, 'Redrafted. Review it in the Review tab.') }
    else if (kind === 'suggest' && r.diff) { const deckId = r.diff.deckId; void run(async () => { await api.suggest(deckId, t); setText('') }, 'New suggestion is waiting in the Review tab.') }
    else if (kind === 'billing_note' && r.billing) { const id = r.billing.id; void run(async () => { await api.noteBilling(id, t); setText('') }, 'Note saved.') }
  }
  return (
    <section className="card" aria-labelledby="ar-tell">
      <div className="label" id="ar-tell">Tell this agent…</div>
      <label className="sr-only" htmlFor="ar-tell-in">Instruction for this agent</label>
      <textarea id="ar-tell-in" rows={3} maxLength={500} value={text} disabled={busy} placeholder={cfg.placeholder} onChange={e => setText(e.target.value)} />
      {kind !== 'billing_note' && <p className="muted hint-left">Uses AI credit. Runs only when you tap.</p>}
      <div aria-live="polite">{notice && <p className="notice">{notice}</p>}</div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" className="primary" disabled={busy || t.length < 2} onClick={go}>{busy ? 'Working…' : cfg.button}</button></div>
    </section>
  )
}

export function AgentRunDetailView({ api, id, onBack, backLabel }: { api: Api; id: string; onBack(): void; backLabel: string }) {
  const { data: r, error, reload } = usePoll(() => api.agentRun(id), null, [id])
  const back = <button type="button" className="back" onClick={onBack}>‹ {backLabel}</button>
  if (error && !r) return <main className="screen">{back}<p className="error" role="alert">{error === 'bad_response' ? 'This run could not be read.' : `Couldn’t load run: ${error}`}</p></main>
  if (!r) return <main className="screen">{back}<p className="muted" role="status">Loading…</p></main>
  return (
    <main className="screen run-detail">
      {back}
      <h1>{r.task ? taskLabel(r.task) : r.agent}</h1>
      <div className="sub"><AgentBadge color={r.color} failed={r.status === 'error'} /> <time dateTime={r.createdAt}>{relTime(r.createdAt)}</time>{r.studentName ? ` · ${r.studentName}` : ''}</div>
      <section className="card youSaid" aria-labelledby="ar-said">
        <div className="label" id="ar-said">You said</div>
        {r.transcript ? <blockquote className="quote">“{r.transcript}”</blockquote> : <div className="muted">No spoken note was recorded for this run{r.trigger ? ` (${r.trigger})` : ''}.</div>}
      </section>
      <OutputCard r={r} />
      <SteerBox key={r.id + (r.outbox?.status ?? '')} api={api} r={r} reload={reload} />
    </main>
  )
}
