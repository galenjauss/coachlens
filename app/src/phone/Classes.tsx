import { useState } from 'react'
import { MODE_IDS, MODES, type ModeId } from '@matside/shared'
import { ApiError, type Api, type ClassRow } from '../core/api'
import { bus } from '../core/bus'
import { outcomeFor } from './reviewLogic'
import { classPayload, classUpdatePayload, WEEKDAYS, type ClassEditDraft } from './rosterLogic'
import { usePoll } from './usePoll'

/** New class: the coach must pick the day (no silent default). Editing: unknown day/time stay unset. */
const blank: ClassEditDraft = { name: '', mode: 'martial_arts', startTime: '', weekday: null }
const draftOf = (c: ClassRow): ClassEditDraft => ({ name: c.name, mode: c.mode, startTime: c.startTime ?? '', weekday: c.weekday ?? null })

function ClassForm({ api, row, onDone, onCancel }: { api: Api; row: ClassRow | null; onDone(msg: string): void; onCancel(): void }) {
  const [d, setD] = useState<ClassEditDraft>(row ? draftOf(row) : blank)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!row && d.weekday === null) { setErr('Pick a day.'); return }
    if (!row && !d.startTime) { setErr('Set a start time.'); return }
    const p = row ? classUpdatePayload(row, d) : classPayload({ ...d, weekday: d.weekday ?? -1 })
    if (!p.ok) { setErr(p.error); return }
    setBusy(true); setErr(null)
    try {
      if (row) { if (Object.keys(p.value).length) await api.updateClass(row.id, p.value) } else await api.createClass(p.value as Parameters<Api['createClass']>[0])
      bus.emit('classChanged', null)
      onDone(row ? 'Class saved.' : 'Class added.')
    } catch (e) { setErr(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }
  return (
    <form className="card" onSubmit={e => { e.preventDefault(); void save() }} aria-label={row ? `Edit ${row.name}` : 'Add a class'}>
      <label className="field-gap">Class name<input value={d.name} maxLength={80} onChange={e => setD({ ...d, name: e.target.value })} /></label>
      <label className="field-gap">Kind
        <select value={d.mode} onChange={e => setD({ ...d, mode: e.target.value as ModeId })}>{MODE_IDS.map(m => <option key={m} value={m}>{MODES[m].label}</option>)}</select>
      </label>
      <div className="grid2">
        <label className="field-gap">Day<select value={d.weekday ?? ''} onChange={e => setD({ ...d, weekday: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="" disabled>{row ? 'Not known · pick to change' : 'Pick a day'}</option>
          {WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select></label>
        <label className="field-gap">Starts<input type="time" value={d.startTime} onChange={e => setD({ ...d, startTime: e.target.value })} /></label>
      </div>
      {row && (row.weekday == null || !row.startTime) && <p className="muted">The server didn’t send this class’s {row.weekday == null ? 'day' : 'start time'}; it stays as it is unless you set it.</p>}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : row ? 'Save class' : 'Add class'}</button></div>
    </form>
  )
}

/** F23 · add, edit and delete classes (C3). */
export function Classes({ api, onBack }: { api: Api; onBack(): void }) {
  const { data, error, reload } = usePoll(() => api.classes(), null)
  const [editing, setEditing] = useState<ClassRow | 'new' | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function remove(c: ClassRow) {
    setErr(null); setConfirm(null)
    try { await api.deleteClass(c.id); setMsg(`${c.name} deleted.`); bus.emit('classChanged', null); await reload() } catch (e) {
      setErr(e instanceof ApiError && e.status === 409 ? `${c.name} has a class running. End it first, then delete.` : outcomeFor(e, 'Deleting').text)
    }
  }
  const done = (m: string) => { setEditing(null); setMsg(m); void reload() }
  return (
    <main className="screen">
      <button type="button" className="back" onClick={onBack}>‹ Back</button>
      <h1>Classes</h1>
      <div className="sub">{data ? `${data.length} ${data.length === 1 ? 'class' : 'classes'}` : 'Loading…'}</div>
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
      {error && <p className="error" role="alert">Couldn’t load classes: {error}</p>}
      {err && <p className="error" role="alert">{err}</p>}
      {editing === 'new' ? <ClassForm api={api} row={null} onDone={done} onCancel={() => setEditing(null)} />
        : <div className="btns tight"><button type="button" className="primary" onClick={() => { setMsg(null); setEditing('new') }}>Add a class</button></div>}
      <ul className="rowlist">
        {data?.map(c => (
          <li key={c.id}>
            {editing !== 'new' && editing?.id === c.id ? <ClassForm api={api} row={c} onDone={done} onCancel={() => setEditing(null)} /> : (
              <div className="card">
                <div className="row"><b className="grow">{c.name}</b><span className="muted">{c.modeLabel}</span></div>
                <div className="muted">{c.weekday != null ? WEEKDAYS[c.weekday] : ''}{c.startTime ? ` · ${c.startTime}` : ''}</div>
                {confirm === c.id ? (
                  <>
                    <p>Delete {c.name}? Its enrollments and saved plans are removed. Students stay on your roster.</p>
                    <div className="btns"><button type="button" onClick={() => setConfirm(null)}>Keep</button><button type="button" className="danger" onClick={() => { void remove(c) }}>Delete class</button></div>
                  </>
                ) : (
                  <div className="btns"><button type="button" onClick={() => { setMsg(null); setEditing(c) }}>Edit</button><button type="button" onClick={() => setConfirm(c.id)}>Delete</button></div>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </main>
  )
}
