import { useId, useRef, useState } from 'react'
import type { DrillDraft, RosterStudent } from '@matside/shared'
import type { Api } from '../core/api'
import { CUE_MAX_CHARS, NAME_MAX_CHARS, clampMinutes, deckErrorOutcome, normalizeItem, type Editable } from './deckLogic'

type Props = {
  api: Api
  drill: Editable
  isNew: boolean
  item: string // mode noun: drill / exercise / activity
  people: string
  roster: RosterStudent[]
  deleteAllowed: boolean
  saving: boolean
  error: string | null
  onSave(d: Editable): void | Promise<void>
  onDelete(): void | Promise<void>
  onBack(): void
}

export function DrillDetail({ api, drill, isNew, item, people, roster, deleteAllowed, saving, error, onSave, onDelete, onBack }: Props) {
  const uid = useId()
  const [d, setD] = useState<Editable>(drill)
  const [cues, setCues] = useState<[string, string]>([drill.cues[0] ?? '', drill.cues[1] ?? ''])
  const [alts, setAlts] = useState<DrillDraft[] | null>(null)
  const [altBusy, setAltBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [mins, setMins] = useState(String(drill.minutes)) // raw text while typing; clamped on blur/save
  const [confirmDel, setConfirmDel] = useState(false)
  const lock = useRef(false)
  const toggle = (id: string) => setD({ ...d, focusStudentIds: d.focusStudentIds.includes(id) ? d.focusStudentIds.filter(x => x !== id) : [...d.focusStudentIds, id] })
  const setCue = (i: 0 | 1, v: string) => setCues(i === 0 ? [v, cues[1]] : [cues[0], v])

  async function loadAlts() {
    if (!d.id || lock.current) return // each call costs real credit: one at a time, only on tap, never retried
    lock.current = true; setAltBusy(true); setErr(null)
    try { setAlts((await api.alternatives(d.id)).alternatives) } catch (e) { setErr(deckErrorOutcome(e, 'alternatives').text) } finally { lock.current = false; setAltBusy(false) }
  }
  function useAlt(a: DrillDraft) {
    setD({ ...d, ...a, id: d.id })
    setMins(String(clampMinutes(a.minutes)))
    setCues([a.cues[0] ?? '', a.cues[1] ?? ''])
  }
  const minsOk = mins.trim() !== '' && Number.isFinite(Number(mins))
  const nameOk = d.name.trim().length > 0
  const save = () => onSave(normalizeItem({ ...d, minutes: clampMinutes(Number(mins)), cues }))

  return (
    <main className="screen">
      <button type="button" className="back" onClick={onBack}>‹ Back to plan</button>
      <h1>{d.name.trim() || `New ${item}`}</h1>
      <div className="sub">{isNew ? `Added by you` : d.rationale || 'Added by you'}</div>
      <section className="card">
        <label className="label" htmlFor={`${uid}n`}>Name</label>
        <input id={`${uid}n`} maxLength={NAME_MAX_CHARS} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
        <label className="label field-gap" htmlFor={`${uid}m`}>Minutes (1–30)</label>
        <input id={`${uid}m`} type="number" inputMode="numeric" min={1} max={30} value={mins} onChange={e => setMins(e.target.value)} onBlur={() => { if (minsOk) setMins(String(clampMinutes(Number(mins)))) }} />
        <div className="label field-gap" id={`${uid}c`}>Cues shown on the lens (up to 2, {CUE_MAX_CHARS} characters each)</div>
        <div role="group" aria-labelledby={`${uid}c`}>
          {([0, 1] as const).map(i => (
            <div key={i} className="cue-field">
              <input aria-label={`Cue ${i + 1}`} maxLength={CUE_MAX_CHARS} placeholder={i === 0 ? 'e.g. knees out' : 'e.g. back tall'} value={cues[i]} onChange={e => setCue(i, e.target.value)} />
              <span className="muted cue-count" aria-hidden="true">{cues[i].length}/{CUE_MAX_CHARS}</span>
            </div>
          ))}
        </div>
        {roster.length > 0 && <>
          <div className="label field-gap" id={`${uid}f`}>Focus {people}</div>
          <div className="chips" role="group" aria-labelledby={`${uid}f`}>
            {roster.map(s => <button key={s.id} type="button" aria-pressed={d.focusStudentIds.includes(s.id)} aria-label={s.name} onClick={() => toggle(s.id)}>{s.name.split(' ')[0]}</button>)}
          </div>
        </>}
      </section>
      {d.id && (
        <section className="card" aria-busy={altBusy}>
          <div className="label">⇄ Alternatives from planner</div>
          {alts?.map((a, i) => (
            <button key={i} type="button" className="alt" onClick={() => useAlt(a)}>
              <b>{a.name} · {a.minutes}m</b>
              <span className="muted">{a.rationale}</span>
            </button>
          ))}
          <button type="button" disabled={altBusy} onClick={loadAlts}>{altBusy ? 'Asking the planner…' : alts ? 'Ask again' : 'Suggest 3 alternatives'}</button>
          {alts && <p className="muted hint-left">Tap one to fill the form, then Save.</p>}
        </section>
      )}
      <div role="alert">{(err ?? error) && <p className="error">{err ?? error}</p>}</div>
      <div className="btns">
        {!isNew && deleteAllowed && (confirmDel
          ? <button type="button" className="danger" disabled={saving} onClick={onDelete}>Confirm delete</button>
          : <button type="button" disabled={saving} onClick={() => setConfirmDel(true)}>Delete</button>)}
        <button type="button" className="primary" disabled={!nameOk || !minsOk || saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {!minsOk && <p className="muted">Enter the minutes (1–30).</p>}
      {!nameOk && <p className="muted">Give the {item} a name to save it.</p>}
      {!isNew && !deleteAllowed && <p className="muted">A plan needs at least one {item}, so this one can’t be deleted.</p>}
    </main>
  )
}
