import { useEffect, useState, type ChangeEvent } from 'react'
import { MODES, type ModeId } from '@matside/shared'
import type { Api } from '../../core/api'
import { cameraBridge, captureWithBridge, prepareFile, readTextFile, type PreparedImage } from './image'
import {
  autoAssign, blankClass, blankStudent, blankWeek, emailSummary, foundHeadline, mergeClasses, mergeStudents, mergeWeeks,
  onboardingErrorText, removeClass, removeRow, renameClass, updateRow, type Draft, type UploadStep,
} from './onboardingLogic'
import { ClassTable, StudentTable, WeekTable } from './tables'

const COPY: Record<UploadStep, { lead: string; placeholder: string; add: string }> = {
  classes: { lead: 'Paste your schedule, upload a CSV, or snap a photo of the timetable.', placeholder: 'Kids · Tue & Thu 5:30pm\nTeens · Wed 6pm', add: 'Add a class' },
  roster: { lead: 'Paste names, upload a CSV export, or snap the sign-in sheet.', placeholder: 'Priya Rao, yellow belt, 8, anita@example.com\nLeo Diaz, white, 7', add: 'Add a person' },
  curriculum: { lead: 'Paste your curriculum notes or snap a page. Week 1 is this week.', placeholder: 'Week 1: Stances — Kata 1\nWeek 2: Blocks — Kata 1, Kata 2', add: 'Add a week' },
}

type Bridge = Awaited<ReturnType<typeof cameraBridge>>

export type DraftUpdate = (f: (d: Draft) => Draft) => void

export function StepUpload({ api, step, mode, draft, update }: { api: Api; step: UploadStep; mode: ModeId; draft: Draft; update: DraftUpdate }) {
  const [text, setText] = useState('')
  const [image, setImage] = useState<PreparedImage | null>(null)
  const [busy, setBusy] = useState<'read' | 'image' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [found, setFound] = useState<string | null>(null)
  const [bridge, setBridge] = useState<Bridge>(null)
  const copy = COPY[step]
  useEffect(() => { let alive = true; void cameraBridge().then(b => { if (alive) setBridge(b) }); return () => { alive = false } }, [])
  // A new step starts with a clean source panel.
  useEffect(() => { setText(''); setImage(null); setErr(null); setFound(null) }, [step])

  async function takeImage(p: Promise<PreparedImage | null>) {
    setBusy('image'); setErr(null)
    try { const img = await p; if (img) setImage(img) } catch (e) { setErr(e instanceof Error ? e.message : 'Couldn’t open that image.') } finally { setBusy(null) }
  }
  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // picking the same file again still fires
    if (!file) return
    if (file.type.startsWith('image/')) return takeImage(prepareFile(file))
    if (file.size > 2_000_000) { setErr('That file is too big. Paste the part you need instead.'); return }
    try { setText(await readTextFile(file)); setErr(null) } catch { setErr('Couldn’t read that file. Try a CSV or TXT.') }
  }

  async function read() {
    setBusy('read'); setErr(null); setFound(null)
    try {
      const r = await api.onboardingExtract({ step, mode, ...(text.trim() ? { text: text.trim() } : {}), ...(image ? { imageBase64: image.base64, mimeType: image.mimeType } : {}) })
      if (r.step === 'classes') {
        update(d => autoAssign({ ...d, classes: mergeClasses(d.classes, r.classes), notes: { ...d.notes, classes: r.notes } }))
        setFound(foundHeadline('classes', r.classes.length, mode))
      } else if (r.step === 'roster') {
        update(d => autoAssign({ ...d, students: mergeStudents(d.students, r.students), notes: { ...d.notes, roster: r.notes } }))
        setFound(`${foundHeadline('roster', r.students.length, mode)}${r.students.length ? ` · ${emailSummary(r.students, mode)}` : ''}`)
      } else if (r.step === 'curriculum') {
        update(d => ({ ...d, weeks: mergeWeeks(d.weeks, r.weeks), notes: { ...d.notes, curriculum: r.notes } }))
        setFound(foundHeadline('curriculum', r.weeks.length, mode))
      }
      setText(''); setImage(null)
    } catch (e) { setErr(onboardingErrorText(e, 'read')) } finally { setBusy(null) }
  }

  const note = draft.notes[step]
  const count = step === 'classes' ? draft.classes.length : step === 'roster' ? draft.students.length : draft.weeks.length
  return (
    <div className="ob-upload">
      <p className="ob-lead">{copy.lead}</p>
      <section className={`ob-source${busy === 'read' ? ' is-reading' : ''}`} aria-label="Your document" aria-busy={busy !== null}>
        <label className="sr-only" htmlFor={`ob-text-${step}`}>Paste text</label>
        <textarea id={`ob-text-${step}`} rows={4} maxLength={20000} value={text} onChange={e => setText(e.target.value)} placeholder={copy.placeholder} disabled={busy === 'read'} />
        {image && (
          <figure className="ob-preview">
            <img src={image.previewUrl} alt="Photo to read" width={72} height={72} />
            <figcaption><b>Photo ready</b><span className="muted">{Math.round(image.bytes / 1024)} KB · resized for upload</span></figcaption>
            <button type="button" className="ob-chip-btn" onClick={() => setImage(null)} disabled={busy === 'read'}>Remove</button>
          </figure>
        )}
        <div className="ob-sources">
          <label className="ob-file"><input type="file" accept=".csv,.txt,.tsv,text/plain,text/csv,image/*" onChange={onFile} disabled={busy !== null} /><span aria-hidden="true">⇪</span> Upload file</label>
          <label className="ob-file"><input type="file" accept="image/*" capture="environment" onChange={onFile} disabled={busy !== null} /><span aria-hidden="true">◉</span> Take photo</label>
          {bridge && <button type="button" className="ob-file-btn" disabled={busy !== null} onClick={() => takeImage(captureWithBridge(bridge))}><span aria-hidden="true">◎</span> Use phone camera</button>}
        </div>
        <button type="button" className="primary ob-read" disabled={busy !== null || (!text.trim() && !image)} onClick={read}>
          {busy === 'read' ? 'Reading…' : busy === 'image' ? 'Preparing photo…' : 'Read with AI'}
        </button>
      </section>

      <div role="status" aria-live="polite" className="ob-live">
        {found && <p className="ob-found"><span className="lens-ring" aria-hidden="true" />{found}</p>}
        {found && note && <p className="muted ob-note">{note}</p>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}

      {count > 0 && <h3 className="ob-table-title">{step === 'classes' ? 'Your classes' : step === 'roster' ? `Your ${MODES[mode].people}` : 'Your weeks'}<span className="muted"> · tap a cell to fix</span></h3>}
      {step === 'classes' && count > 0 && (
        <ClassTable rows={draft.classes}
          onRename={(k, n) => update(d => renameClass(d, k, n))}
          onPatch={(k, p) => update(d => ({ ...d, classes: updateRow(d.classes, k, p) }))}
          onRemove={k => update(d => removeClass(d, k))} />
      )}
      {step === 'roster' && count > 0 && (
        <StudentTable rows={draft.students} mode={mode}
          onPatch={(k, p) => update(d => ({ ...d, students: updateRow(d.students, k, p) }))}
          onRemove={k => update(d => ({ ...d, students: removeRow(d.students, k) }))} />
      )}
      {step === 'curriculum' && count > 0 && (
        <WeekTable rows={draft.weeks} mode={mode}
          onPatch={(k, p) => update(d => ({ ...d, weeks: updateRow(d.weeks, k, p) }))}
          onRemove={k => update(d => ({ ...d, weeks: removeRow(d.weeks, k) }))} />
      )}
      <button type="button" className="ob-add" onClick={() => update(d => (
        step === 'classes' ? autoAssign({ ...d, classes: [...d.classes, blankClass(mode, d.classes.length + 1)] })
          : step === 'roster' ? { ...d, students: [...d.students, blankStudent()] }
            : { ...d, weeks: [...d.weeks, blankWeek(d.weeks)] }
      ))}>+ {copy.add}</button>
    </div>
  )
}
