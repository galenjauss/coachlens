import { useCallback, useState } from 'react'
import type { DeckDiff, ReviewItem } from '@matside/shared'
import type { Api } from '../core/api'
import { approveAllNotice, outcomeFor, visibleEmailIds } from './reviewLogic'
import { usePoll } from './usePoll'
import { useAction } from './useAction'

export function DiffList({ diff }: { diff: DeckDiff }) {
  const empty = !diff.removed.length && !diff.changed.length && !diff.added.length
  return (
    <ul className="difflist" aria-label="Proposed changes">
      {diff.removed.map(r => <li key={r.drillId} className="drill"><s className="muted">{r.drillId.slice(0, 6)}…</s><span className="pill high">removed · {r.reason}</span></li>)}
      {diff.changed.map(c => <li key={c.drillId} className="drill"><span>{c.after.name} · {c.after.minutes}m</span><span className="pill warn">changed · {c.reason}</span></li>)}
      {diff.added.map((a, i) => <li key={i} className="drill"><span>{a.name} · {a.minutes}m</span><span className="pill ok">added · {a.reason}</span></li>)}
      {empty && <li className="muted">No changes proposed.</li>}
    </ul>
  )
}

type Props = { api: Api; onGone(text: string): void; refresh(): void }
type EmailItem = Extract<ReviewItem, { kind: 'parent_email' | 'report_card' }>

function EmailCard({ api, item, onGone, refresh }: Props & { item: EmailItem }) {
  const [edit, setEdit] = useState(false)
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const { busy, err, run } = useAction(onGone, refresh, 'Send')
  const label = item.kind === 'report_card' ? 'Report card' : 'Parent email'
  return (
    <article className="card" aria-label={`${label} for ${item.studentName}`}>
      <div className="card-head"><span className="pill">{label}</span><span className="muted">{item.studentName} · to {item.to}</span></div>
      {edit ? (
        <>
          <input aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
          <textarea aria-label="Body" rows={8} value={body} onChange={e => setBody(e.target.value)} />
        </>
      ) : (
        <>
          <div className="subject">{subject}</div>
          <div className="muted pre">{body}</div>
        </>
      )}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button type="button" disabled={busy} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        <button type="button" disabled={busy} onClick={() => run(() => api.skip(item.id))}>Skip</button>
        <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.approve(item.id, { subject, body }))}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </article>
  )
}

function BillingCard({ api, item, onGone, refresh }: Props & { item: Extract<ReviewItem, { kind: 'billing' }> }) {
  const [note, setNote] = useState('')
  const { busy, err, run } = useAction(onGone, refresh)
  const trimmed = note.trim()
  return (
    <article className="card" aria-label={`Billing flag for ${item.studentName}`}>
      <div className="card-head"><span className={`pill ${item.urgency === 'high' ? 'high' : ''}`}>Billing flag · {item.urgency.toUpperCase()}</span><span className="muted">{item.studentName}</span></div>
      <div className="pre">{item.note}{item.amount != null ? ` · $${item.amount}` : ''}</div>
      <input aria-label={`Note for ${item.studentName}`} placeholder="Add a note…" value={note} onChange={e => setNote(e.target.value)} />
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button type="button" disabled={busy || !trimmed} onClick={() => run(async () => { await api.noteBilling(item.id, trimmed); setNote('') })}>Save note</button>
        <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.handleBilling(item.id, trimmed || undefined))}>Mark handled</button>
      </div>
    </article>
  )
}

function NoteCard({ api, item, roster, onGone, refresh }: Props & { item: Extract<ReviewItem, { kind: 'unassigned_note' }>; roster: { id: string; name: string }[] }) {
  const { busy, err, run } = useAction(onGone, refresh)
  return (
    <article className="card" aria-label="Unassigned note">
      <div className="card-head"><span className="pill">Unassigned note</span>{item.heard && <span className="muted">heard “{item.heard}”</span>}</div>
      <div className="pre">{item.text}</div>
      <div className="label chips-label">Assign to</div>
      <div className="chips" role="group" aria-label="Assign note to">
        {roster.map(s => <button key={s.id} type="button" disabled={busy} aria-label={`Assign to ${s.name}`} onClick={() => run(() => api.assignNote(item.id, s.id))}>{s.name}</button>)}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" disabled={busy} onClick={() => run(() => api.dismissNote(item.id))}>Dismiss note</button></div>
    </article>
  )
}

function DiffCard({ api, item, onGone, refresh }: Props & { item: Extract<ReviewItem, { kind: 'deck_diff' }> }) {
  const { busy, err, run } = useAction(onGone, refresh)
  return (
    <article className="card" aria-label="Planner suggestion">
      <div className="card-head"><span className="pill">Planner suggestion</span><span className="muted">“{item.requestText}”</span></div>
      <DiffList diff={item.diff} />
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button type="button" disabled={busy} onClick={() => run(() => api.undoDiff(item.id))}>Dismiss</button>
        <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.acceptDiff(item.id, false))}>Accept</button>
      </div>
    </article>
  )
}

export function Review({ api }: { api: Api }) {
  const { data, error, loading, reload } = usePoll(() => api.review(), 5000)
  const { data: roster } = usePoll(() => api.students(), null)
  const { data: today } = usePoll(() => api.today(), null)
  const [notice, setNotice] = useState<string | null>(null)
  const [bulkErr, setBulkErr] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const people = today?.people ?? 'students'
  const onGone = useCallback((t: string) => setNotice(t), [])
  const emailIds = visibleEmailIds(data)

  async function approveAll() {
    if (bulkBusy) return
    setBulkBusy(true); setBulkErr(null); setNotice(null)
    try { setNotice(approveAllNotice(await api.approveAll(emailIds))) } catch (e) { setBulkErr(outcomeFor(e, 'Send all').text) } finally { setBulkBusy(false); reload() }
  }

  return (
    <main className="screen">
      <h1>Review</h1>
      <div className="sub" role="status">{data ? (data.length === 1 ? '1 item' : `${data.length} items`) : loading ? 'Loading…' : ''} · {people} drafts and flags wait here</div>
      {error && <p className="error" role="alert">Couldn’t load review: {error} <button type="button" className="inline" onClick={reload}>Retry</button></p>}
      <div aria-live="polite">{notice && <p className="notice">{notice} <button type="button" className="inline" onClick={() => setNotice(null)}>Dismiss</button></p>}</div>
      {bulkErr && <p className="error" role="alert">{bulkErr}</p>}
      {emailIds.length > 1 && (
        <div className="btns bulk"><button type="button" className="primary" disabled={bulkBusy} onClick={approveAll}>{bulkBusy ? 'Sending…' : `Send all emails (${emailIds.length})`}</button></div>
      )}
      {data?.map(item => {
        const p = { api, onGone, refresh: reload }
        switch (item.kind) {
          case 'parent_email': case 'report_card': return <EmailCard key={item.id} {...p} item={item} />
          case 'billing': return <BillingCard key={item.id} {...p} item={item} />
          case 'unassigned_note': return <NoteCard key={item.id} {...p} item={item} roster={roster ?? []} />
          case 'deck_diff': return <DiffCard key={item.id} {...p} item={item} />
        }
      })}
      {data?.length === 0 && <p className="muted empty">All caught up. Nothing needs you right now.</p>}
    </main>
  )
}
