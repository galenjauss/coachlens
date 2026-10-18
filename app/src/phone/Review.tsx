import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeckDiff, ReviewItem } from '@matside/shared'
import type { Api } from '../core/api'
import { approveAllNotice, bulkEmailIds, outcomeFor, visibleEmailIds } from './reviewLogic'
import { usePoll } from './usePoll'
import { useAction } from './useAction'

export function DiffList({ diff, names }: { diff: DeckDiff; names?: Record<string, string> }) {
  const empty = !diff.removed.length && !diff.changed.length && !diff.added.length
  return (
    <ul className="difflist" aria-label="Proposed changes">
      {diff.removed.map(r => <li key={r.drillId} className="drill"><s className="muted">{names?.[r.drillId] ?? `${r.drillId.slice(0, 6)}…`}</s><span className="pill high">removed · {r.reason}</span></li>)}
      {diff.changed.map(c => <li key={c.drillId} className="drill"><span>{c.after.name} · {c.after.minutes}m</span><span className="pill warn">changed · {c.reason}</span></li>)}
      {diff.added.map((a, i) => <li key={i} className="drill"><span>{a.name} · {a.minutes}m</span><span className="pill ok">added · {a.reason}</span></li>)}
      {empty && <li className="muted">No changes proposed.</li>}
    </ul>
  )
}

type Props = { api: Api; onGone(text: string): void; refresh(): void | Promise<unknown>; locked?: boolean }
type EmailItem = Extract<ReviewItem, { kind: 'parent_email' | 'report_card' }>

function EmailCard({ api, item, onGone, refresh, locked, onDirty }: Props & { item: EmailItem; onDirty(id: string, dirty: boolean): void }) {
  const [edit, setEdit] = useState(false)
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const { busy, err, run } = useAction(onGone, refresh, 'Send')
  const label = item.kind === 'report_card' ? 'Report card' : 'Email'
  const subjectRef = useRef<HTMLInputElement>(null)
  const dirty = edit || subject !== item.subject || body !== item.body
  useEffect(() => { onDirty(item.id, dirty) }, [item.id, dirty, onDirty])
  useEffect(() => () => onDirty(item.id, false), [item.id, onDirty])
  useEffect(() => { if (edit) subjectRef.current?.focus() }, [edit])
  const off = busy || locked
  const empty = !subject.trim() || !body.trim()
  return (
    <article className="card" aria-label={`${label} for ${item.studentName}`}>
      <div className="card-head"><span className="pill">{label}</span><span className="muted">{item.studentName} · to {item.to}</span></div>
      {edit ? (
        <>
          <input ref={subjectRef} aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} />
          <textarea aria-label="Body" rows={8} value={body} onChange={e => setBody(e.target.value)} />
        </>
      ) : (
        <>
          <div className="subject">{subject}</div>
          <div className="muted pre">{body}</div>
        </>
      )}
      {empty && edit && <p className="error" role="alert">Subject and body can’t be empty.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button type="button" disabled={off} aria-pressed={edit} onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        <button type="button" disabled={off} onClick={() => run(() => api.skip(item.id), 'Skipped.')}>Skip</button>
        <button type="button" className="primary" disabled={off || empty} onClick={() => run(() => api.approve(item.id, { subject, body }), 'Sent.')}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </article>
  )
}

function BillingCard({ api, item, onGone, refresh, locked }: Props & { item: Extract<ReviewItem, { kind: 'billing' }> }) {
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
        <button type="button" disabled={busy || locked || !trimmed} onClick={() => run(async () => { await api.noteBilling(item.id, trimmed); setNote('') }, 'Note saved.')}>Save note</button>
        <button type="button" className="primary" disabled={busy || locked} onClick={() => run(() => api.handleBilling(item.id, trimmed || undefined), 'Marked handled.')}>Mark handled</button>
      </div>
    </article>
  )
}

function NoteCard({ api, item, roster, onGone, refresh, locked }: Props & { item: Extract<ReviewItem, { kind: 'unassigned_note' }>; roster: { id: string; name: string }[] }) {
  const { busy, err, run } = useAction(onGone, refresh)
  return (
    <article className="card" aria-label="Unassigned note">
      <div className="card-head"><span className="pill">Unassigned note</span>{item.heard && <span className="muted">heard “{item.heard}”</span>}</div>
      <div className="pre">{item.text}</div>
      <div className="label chips-label">Assign to</div>
      <div className="chips" role="group" aria-label="Assign note to">
        {roster.map(s => <button key={s.id} type="button" disabled={busy || locked} aria-label={`Assign to ${s.name}`} onClick={() => run(() => api.assignNote(item.id, s.id), `Assigned to ${s.name.split(' ')[0]}.`)}>{s.name}</button>)}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" disabled={busy || locked} onClick={() => run(() => api.dismissNote(item.id), 'Note dismissed.')}>Dismiss note</button></div>
    </article>
  )
}

function DiffCard({ api, item, onGone, refresh, locked }: Props & { item: Extract<ReviewItem, { kind: 'deck_diff' }> }) {
  const { busy, err, run } = useAction(onGone, refresh)
  return (
    <article className="card" aria-label="Planner suggestion">
      <div className="card-head"><span className="pill">Planner suggestion</span><span className="muted">“{item.requestText}”</span></div>
      <DiffList diff={item.diff} />
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button type="button" disabled={busy || locked} onClick={() => run(() => api.undoDiff(item.id), 'Suggestion dismissed.')}>Dismiss</button>
        <button type="button" className="primary" disabled={busy || locked} onClick={() => run(() => api.acceptDiff(item.id, false), 'Plan updated.')}>Accept</button>
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
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set())
  const onDirty = useCallback((id: string, d: boolean) => setDirty(prev => {
    if (prev.has(id) === d) return prev
    const next = new Set(prev); if (d) next.add(id); else next.delete(id); return next
  }), [])
  const allEmails = visibleEmailIds(data)
  const emailIds = bulkEmailIds(data, dirty)
  const excluded = allEmails.length - emailIds.length

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
        <div className="btns bulk"><button type="button" className="primary" disabled={bulkBusy} onClick={approveAll}>{bulkBusy ? 'Sending…' : `Send ${emailIds.length} unedited emails`}</button></div>
      )}
      {excluded > 0 && <p className="muted" id="bulk-hint">Edited emails are sent individually.</p>}
      {data?.map(item => {
        const p = { api, onGone, refresh: reload, locked: bulkBusy }
        switch (item.kind) {
          case 'parent_email': case 'report_card': return <EmailCard key={item.id} {...p} item={item} onDirty={onDirty} />
          case 'billing': return <BillingCard key={item.id} {...p} item={item} />
          case 'unassigned_note': return <NoteCard key={item.id} {...p} item={item} roster={roster ?? []} />
          case 'deck_diff': return <DiffCard key={item.id} {...p} item={item} />
        }
      })}
      {data?.length === 0 && <p className="muted empty">All caught up. Nothing needs you right now.</p>}
    </main>
  )
}
