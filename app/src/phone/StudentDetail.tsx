import { useCallback, useEffect, useRef, useState } from 'react'
import type { Api } from '../core/api'
import { AliasEditor } from './AliasEditor'
import { StudentProfile } from './StudentProfile'
import { StudentMetrics } from './StudentMetrics'
import { StudentForm } from './StudentForm'
import { outcomeFor, studentOutcome } from './reviewLogic'
import { useAction } from './useAction'
import { usePoll } from './usePoll'

const DRAFT_WAIT_MS = 9000

export function StudentDetailView({ api, id, onBack, onDeleted }: { api: Api; id: string; onBack(): void; onDeleted(name: string): void }) {
  const { data: s, error, reload } = usePoll(async () => { try { return await api.student(id) } catch (e) { throw new Error(studentOutcome(e)) } }, null, [id])
  const [drafting, setDrafting] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const onGone = useCallback((t: string) => setNote(t), [])
  const { busy, err, run } = useAction(onGone, reload, 'Send')
  const back = <button type="button" className="back" onClick={onBack}>‹ Back</button>
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delErr, setDelErr] = useState<string | null>(null)

  if (error && !s) return <main className="screen">{back}<p className="error" role="alert">{error}</p></main>
  if (!s) return <main className="screen">{back}<p className="muted" role="status">Loading…</p></main>
  const rc = s.reportCard
  const open = s.issues.filter(i => i.status === 'open')

  async function remove() {
    if (!s) return
    setDelBusy(true); setDelErr(null)
    try { await api.deleteStudent(s.id); onDeleted(s.name) } catch (e) { setDelErr(outcomeFor(e, 'Deleting').text); setDelBusy(false) }
  }
  const editDraft = {
    name: s.name, nickname: s.nickname ?? '', belt: s.belt, classIds: s.classIds ?? [],
    guardians: s.guardians?.length ? s.guardians.map(g => ({ name: g.name, email: g.email })) : [{ name: '', email: '' }],
  }

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
      <div className="sub">{s.belt}{s.age !== null ? ` · age ${s.age}` : ''} · {s.classCount} classes</div>
      {editing
        ? <StudentForm api={api} edit={{ id: s.id, draft: editDraft, guardiansKnown: s.guardians !== undefined }} onCancel={() => setEditing(false)} onDone={m => { setEditing(false); setNote(m); reload() }} />
        : <div className="btns tight"><button type="button" onClick={() => setEditing(true)}>Edit details and guardians</button></div>}
      <StudentProfile api={api} s={s} onSaved={reload} />
      <StudentMetrics api={api} studentId={s.id} metrics={s.metrics} onChanged={reload} />
      <AliasEditor api={api} studentId={s.id} firstName={s.name.split(' ')[0] ?? s.name} />
      <section className="card" aria-labelledby="sd-work"><div className="label" id="sd-work">Working on</div>
        {/* An open issue is a focus area, not a verdict (batch 1 keeps praise and improvement out of it). */}
        {open.map(i => <div key={i.tag} className="dot">{i.tag} <span className="pill warn">open focus</span></div>)}
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
      <section className="card danger-zone" aria-labelledby="sd-delete"><div className="label" id="sd-delete">Delete student</div>
        {!confirmDelete
          ? <div className="btns"><button type="button" onClick={() => setConfirmDelete(true)}>Delete {s.name.split(' ')[0]}…</button></div>
          : <>
              <p>This permanently deletes {s.name} and their data: notes, metrics, attendance, guardians and class enrollments. It can’t be undone.</p>
              <div className="btns"><button type="button" disabled={delBusy} onClick={() => setConfirmDelete(false)}>Keep</button><button type="button" className="danger" disabled={delBusy} onClick={() => { void remove() }}>{delBusy ? 'Deleting…' : 'Delete for good'}</button></div>
            </>}
        {delErr && <p className="error" role="alert">{delErr}</p>}
      </section>
    </main>
  )
}
