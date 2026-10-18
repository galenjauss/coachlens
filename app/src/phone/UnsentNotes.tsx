import { useCallback, useEffect, useState } from 'react'
import { bus } from '../core/bus'
import type { Outbox } from '../core/outbox'
import { storageWarning, unsentRows, unsentSummary, useFailedCount, useOutboxCount, useOutboxUsage, type UnsentRow } from './outboxLogic'

/**
 * F07 · Unsent notes: what is waiting to send (and the real reason), and what the server rejected (kept
 * until the coach retries or discards it). Nothing here is ever deleted without a Discard tap.
 */
export function UnsentNotes({ outbox }: { outbox: Outbox }) {
  const queued = useOutboxCount()
  const failed = useFailedCount()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<UnsentRow[]>([])
  const [confirm, setConfirm] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const usage = useOutboxUsage()
  const warning = storageWarning(usage)
  /** "Sending…" feedback after Retry / Send now until the counts change (or 8 s pass). */
  const [sending, setSending] = useState(false)
  useEffect(() => { setSending(false) }, [queued, failed])
  useEffect(() => { if (!sending) return; const t = setTimeout(() => setSending(false), 8000); return () => clearTimeout(t) }, [sending])
  const sendNow = () => { setSending(true); bus.emit('outboxRetry', undefined) }
  const load = useCallback(async () => {
    try { setRows(unsentRows(await outbox.list(), await outbox.failed())); setErr(null) } catch { setErr('Couldn’t read the notes saved on this phone.') }
  }, [outbox])
  useEffect(() => { if (open) void load() }, [open, queued, failed, load])
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => { void load() }, 5000) // the retry reason changes while the lens retries
    return () => clearInterval(t)
  }, [open, load])

  const summary = unsentSummary(queued, failed)
  if (!summary) return warning ? <p className="queued has-failed" role="alert">{warning}</p> : null
  async function retry(r: UnsentRow) {
    if (r.kind === 'failed') await outbox.retryFailed(r.id).catch(() => setErr('Couldn’t re-queue that note.'))
    sendNow() // send now, ignoring the backoff
    void load()
  }
  async function discard(id: string) {
    setConfirm(null)
    await outbox.discardFailed(id).catch(() => setErr('Couldn’t discard that note.'))
    void load()
  }
  return (
    <section className={`queued unsent ${failed ? 'has-failed' : ''}`} aria-labelledby="unsent-head">
      <div className="row">
        <span className="grow" id="unsent-head" role="status">{sending ? 'Sending…' : summary}</span>
        <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Unsent notes'}</button>
        {!open && queued > 0 && <button type="button" disabled={sending} onClick={sendNow}>Retry now</button>}
      </div>
      {warning && <p role="alert">{warning}</p>}
      {open && (
        <ul className="rowlist unsent-list">
          {rows.map(r => (
            <li key={r.id} className="unsent-row">
              <div><span className={`pill ${r.kind === 'failed' ? 'high' : 'warn'}`}>{r.kind === 'failed' ? 'Not sent' : 'Waiting'}</span><span className="muted">{r.when}</span></div>
              <div className="pre">{r.preview}</div>
              <div className="muted">{r.reason}</div>
              {confirm === r.id ? (
                <div className="btns"><span className="grow">Delete this note for good?</span>
                  <button type="button" onClick={() => setConfirm(null)}>Keep</button>
                  <button type="button" className="danger" onClick={() => { void discard(r.id) }}>Discard</button></div>
              ) : (
                <div className="btns">
                  {r.canRetry && <button type="button" onClick={() => { void retry(r) }}>{r.kind === 'failed' ? 'Retry' : 'Send now'}</button>}
                  {r.canDiscard && <button type="button" onClick={() => setConfirm(r.id)}>Discard</button>}
                </div>
              )}
            </li>
          ))}
          {!rows.length && <li className="muted">Nothing waiting.</li>}
        </ul>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
