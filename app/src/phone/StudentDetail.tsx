import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../core/api'
import { outcomeFor, studentOutcome } from './reviewLogic'
import { useAction } from './useAction'
import { usePoll } from './usePoll'

const DRAFT_WAIT_MS = 9000

export function StudentDetailView({ api, id, onBack }: { api: Api; id: string; onBack(): void }) {
  const { data: s, error, reload } = usePoll(async () => { try { return await api.student(id) } catch (e) { throw new Error(studentOutcome(e)) } }, null, [id])
  const [drafting, setDrafting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const onGone = useCallback((t: string) => setNote(t), [])
  const { busy, err, run } = useAction(onGone, reload, 'Send')
  const back = <button type="button" className="back" onClick={onBack}>‹ Back</button>

  if (error && !s) return <main className="screen">{back}<p className="error" role="alert">{error}</p></main>
  if (!s) return <main className="screen">{back}<p className="muted" role="status">Loading…</p></main>
  const rc = s.reportCard
  const open = s.issues.filter(i => i.status === 'open')

  async function draft() {
    if (!s) return
    setNote(null); setDrafting(true)
    try {
      await api.runReportCards([s.id])
      setNote('Drafting… this takes about 10 seconds.')
      timer.current = setTimeout(() => { setDrafting(false); setNote(null); reload() }, DRAFT_WAIT_MS)
    } catch (e) { setDrafting(false); setNote(outcomeFor(e, 'Drafting').text) }
  }
  return (
    <main className="screen">
      {back}
      <h1>{s.name}</h1>
      <div className="sub">{s.belt} · age {s.age} · {s.classCount} classes</div>
      <section className="card" aria-labelledby="sd-work"><div className="label" id="sd-work">Working on</div>
        {open.map(i => <div key={i.tag} className="dot">{i.tag} <span className="pill high">recurring</span></div>)}
        {!open.length && <div className="muted">Nothing flagged.</div>}
      </section>
      <section className="card" aria-labelledby="sd-notes"><div className="label" id="sd-notes">Coach notes</div>
        {s.notes.map((n, i) => <div key={i} className="note"><b>{n.date}</b> · {n.drillName ?? 'class'}: “{n.text}”</div>)}
        {!s.notes.length && <div className="muted">No notes yet.</div>}
      </section>
      <section className="card" aria-labelledby="sd-rc"><div className="label" id="sd-rc">Report card</div>
        {rc ? (
          <>
            <div><b>{rc.month}</b> <span className="pill">{rc.status.replace(/_/g, ' ')}</span></div>
            <div className="rc"><span className="muted">Strengths</span> {rc.content.strengths.join(', ') || '—'}</div>
            <div className="rc"><span className="muted">Working on</span> {rc.content.workingOn.join(', ') || '—'}</div>
            <div className="rc"><span className="muted">Next goal</span> {rc.content.nextGoal}</div>
            <div className="rc"><span className="muted">Attendance</span> {rc.content.attendance}</div>
            {rc.content.coachNotes.map((c, i) => <div key={i} className="rc"><span className="muted">{c.date} · {c.drill}</span> “{c.quote}”</div>)}
            {rc.status === 'pending_review' && (
              <div className="btns"><button type="button" className="primary" disabled={busy} onClick={() => run(() => api.approve(rc.outboxId), 'Report card sent.')}>{busy ? 'Sending…' : 'Send report card'}</button></div>
            )}
          </>
        ) : (
          <div className="btns"><button type="button" disabled={drafting} onClick={draft}>{drafting ? 'Drafting…' : 'Draft report card now'}</button></div>
        )}
        <div aria-live="polite">{note && <p className="notice">{note}</p>}</div>
        {err && <p className="error" role="alert">{err}</p>}
      </section>
    </main>
  )
}
