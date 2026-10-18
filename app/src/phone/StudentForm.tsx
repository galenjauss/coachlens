import { useState } from 'react'
import type { Api } from '../core/api'
import { outcomeFor } from './reviewLogic'
import { studentCreatePayload, studentUpdatePayload, type GuardianDraft, type StudentDraft } from './rosterLogic'
import { usePoll } from './usePoll'

export const emptyStudent: StudentDraft = { name: '', nickname: '', belt: '', classIds: [], guardians: [{ name: '', email: '' }] }

/**
 * F23 · add or edit a student (C3): name, nickname, rank, classes, guardians. Editing sends only what changed;
 * guardians replace the stored list, so they are sent only after the coach edits them.
 */
export function StudentForm({ api, edit, onDone, onCancel }: {
  api: Api
  /** Absent = add. `guardiansKnown` false = the server did not send the current guardians (editing them replaces whatever is stored). */
  edit?: { id: string; draft: StudentDraft; guardiansKnown: boolean }
  onDone(msg: string, id?: string): void
  onCancel(): void
}) {
  const { data: classes } = usePoll(() => api.classes(), null)
  const [d, setD] = useState<StudentDraft>(edit?.draft ?? emptyStudent)
  const [touched, setTouched] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setG = (i: number, g: Partial<GuardianDraft>) => { setTouched(true); setD({ ...d, guardians: d.guardians.map((x, j) => (j === i ? { ...x, ...g } : x)) }) }
  const toggle = (id: string) => setD({ ...d, classIds: d.classIds.includes(id) ? d.classIds.filter(x => x !== id) : [...d.classIds, id] })

  async function save() {
    const p = edit ? studentUpdatePayload(edit.draft, d, { guardiansTouched: touched }) : studentCreatePayload(d)
    if (!p.ok) { setErr(p.error); return }
    setBusy(true); setErr(null)
    try {
      if (edit) {
        if (Object.keys(p.value).length) await api.updateStudent(edit.id, p.value)
        onDone('Saved.')
      } else {
        const created = await api.createStudent(p.value as Parameters<Api['createStudent']>[0])
        onDone(`${created.name} added.`, created.id)
      }
    } catch (e) { setErr(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }
  return (
    <form className="card student-form" aria-label={edit ? 'Edit student' : 'Add a student'} onSubmit={e => { e.preventDefault(); void save() }}>
      <label className="field-gap">Full name<input value={d.name} maxLength={80} autoComplete="off" onChange={e => setD({ ...d, name: e.target.value })} /></label>
      <div className="grid2">
        <label className="field-gap">Nickname<input value={d.nickname} maxLength={40} onChange={e => setD({ ...d, nickname: e.target.value })} /></label>
        <label className="field-gap">Rank<input value={d.belt} maxLength={40} placeholder={edit ? '' : 'white'} onChange={e => setD({ ...d, belt: e.target.value })} /></label>
      </div>
      <fieldset className="field-gap"><legend className="label">Classes</legend>
        {classes?.map(c => (
          <label key={c.id} className="row check-row"><input type="checkbox" className="check" checked={d.classIds.includes(c.id)} onChange={() => toggle(c.id)} /> <span className="grow">{c.name}</span><span className="muted">{c.modeLabel}</span></label>
        )) ?? <span className="muted">Loading classes…</span>}
      </fieldset>
      <fieldset className="field-gap"><legend className="label">Guardians</legend>
        {edit && !edit.guardiansKnown && !touched && <p className="muted">Current guardians aren’t shown here. Anything you enter replaces them.</p>}
        {d.guardians.map((g, i) => (
          <div key={i} className="guardian">
            <input aria-label={`Guardian ${i + 1} name`} placeholder="Name" value={g.name} onChange={e => setG(i, { name: e.target.value })} />
            <input aria-label={`Guardian ${i + 1} email`} placeholder="Email" type="email" inputMode="email" value={g.email} onChange={e => setG(i, { email: e.target.value })} />
            <button type="button" className="quiet" aria-label={`Remove guardian ${i + 1}`} onClick={() => { setTouched(true); setD({ ...d, guardians: d.guardians.filter((_, j) => j !== i) }) }}>Remove</button>
          </div>
        ))}
        <div className="btns"><button type="button" onClick={() => { setTouched(true); setD({ ...d, guardians: [...d.guardians, { name: '', email: '' }] }) }}>Add guardian</button></div>
      </fieldset>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : edit ? 'Save' : 'Add student'}</button></div>
    </form>
  )
}
