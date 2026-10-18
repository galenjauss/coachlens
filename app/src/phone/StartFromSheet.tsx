import { useEffect, useRef, useState } from 'react'
import type { ClassSummary, ReplaceSource } from '@matside/shared'
import type { Api } from '../core/api'
import { replaceConfirmText, START_OPTIONS, type StartKey } from './deckLogic'

type Step = { at: 'options' } | { at: 'classes'; classes: ClassSummary[] | null } | { at: 'confirm'; source: ReplaceSource; label: string }

/**
 * In-flow "Start from…" panel (no fixed overlay: the app scrolls inside #root). Picking a starting point always goes through a confirm step.
 * `onReplace` performs the replace and resolves true when the server accepted it.
 */
export function StartFromSheet({ api, classId, itemCount, busy, error, onReplace, onClose }: {
  api: Api; classId: string; itemCount: number; busy: boolean; error: string | null
  onReplace(source: ReplaceSource): Promise<boolean>; onClose(): void
}) {
  const [step, setStep] = useState<Step>({ at: 'options' })
  const [local, setLocal] = useState<string | null>(null)
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => { head.current?.focus() }, [step.at])

  const pick = async (key: StartKey) => {
    setLocal(null)
    if (key === 'copy') {
      setStep({ at: 'classes', classes: null })
      try { setStep({ at: 'classes', classes: (await api.classes()).filter(c => c.id !== classId) }) } catch { setLocal('Couldn’t load classes. Check your connection.'); setStep({ at: 'options' }) }
      return
    }
    const label = START_OPTIONS.find(o => o.key === key)!.label
    setStep({ at: 'confirm', source: key, label })
  }
  const pickClass = (c: ClassSummary) => {
    setLocal(null)
    setStep({ at: 'confirm', source: { classId: c.id }, label: `${c.name}’s plan` })
  }
  const onKeyDown = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose() }

  return (
    <section className="card startfrom" aria-labelledby="startfrom-h" onKeyDown={onKeyDown}>
      <div className="startfrom-head">
        <h2 id="startfrom-h" ref={head} tabIndex={-1}>{step.at === 'classes' ? 'Pick a class' : step.at === 'confirm' ? 'Replace this plan?' : 'Start from…'}</h2>
        <button type="button" className="inline" disabled={busy} onClick={onClose}>Close</button>
      </div>
      {step.at === 'options' && (
        <ul className="startfrom-list">
          {START_OPTIONS.map(o => (
            <li key={o.key}><button type="button" className="startfrom-opt" disabled={busy} onClick={() => void pick(o.key)}><b>{o.label}</b><span className="muted">{o.hint}</span></button></li>
          ))}
        </ul>
      )}
      {step.at === 'classes' && (
        step.classes === null ? <p className="muted" role="status">Loading classes…</p>
          : step.classes.length === 0 ? <p className="muted">No other classes yet.</p>
            : <ul className="startfrom-list">{step.classes.map(c => (
              <li key={c.id}><button type="button" className="startfrom-opt" disabled={busy} onClick={() => pickClass(c)}><b>{c.name}</b><span className="muted">{c.modeLabel}</span></button></li>
            ))}</ul>
      )}
      {step.at === 'confirm' && (
        <>
          <p>{replaceConfirmText(itemCount, step.label)}</p>
          <div className="btns">
            <button type="button" disabled={busy} onClick={() => setStep({ at: 'options' })}>Back</button>
            <button type="button" className="primary" disabled={busy} onClick={() => void onReplace(step.source).then(ok => { if (ok) onClose() })}>{busy ? 'Replacing…' : 'Replace plan'}</button>
          </div>
        </>
      )}
      {step.at === 'classes' && <div className="btns"><button type="button" disabled={busy} onClick={() => setStep({ at: 'options' })}>Back</button></div>}
      <div role="alert">{(local ?? error) && <p className="error">{local ?? error}</p>}</div>
    </section>
  )
}
