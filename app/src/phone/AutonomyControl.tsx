import { useEffect, useRef, useState } from 'react'
import type { AgentTask, Autonomy } from '@matside/shared'
import type { Api } from '../core/api'
import { AUTONOMY_COPY, AUTONOMY_LABEL, autonomyOptions, radioStep, taskLabel } from './agentsLogic'
import { outcomeFor } from './reviewLogic'

/** Auto · Review · Off for one agent, with a sentence on what the chosen mode does. Saves on every tap. */
export function AutonomyControl({ api, task }: { api: Api; task: AgentTask }) {
  const [value, setValue] = useState<Autonomy | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const options = autonomyOptions(task)

  useEffect(() => {
    let live = true
    setValue(null); setErr(null)
    api.settings().then(s => { if (live) setValue(s.autonomy[task]) }).catch(e => { if (live) setErr(outcomeFor(e, 'Loading').text) })
    return () => { live = false }
  }, [api, task])

  async function choose(next: Autonomy) {
    if (busy || next === value) return
    const prev = value
    setBusy(true); setErr(null); setValue(next)
    try { setValue((await api.patchSettings({ autonomy: { [task]: next } })).autonomy[task]) } catch (e) { setValue(prev); setErr(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }

  return (
    <section className="card autonomy" aria-labelledby={`aut-${task}`}>
      <div className="label" id={`aut-${task}`}>How much should {taskLabel(task)} do on its own?</div>
      <div className="seg" role="radiogroup" aria-labelledby={`aut-${task}`} aria-busy={busy}>
        {options.map((m, i) => {
          const on = value === m
          return (
            <button key={m} type="button" role="radio" aria-checked={on} tabIndex={on || (value === null && i === 0) ? 0 : -1}
              ref={el => { refs.current[i] = el }} disabled={value === null && !err} className={`seg-opt${on ? ' on' : ''}${m === 'off' ? ' off' : ''}`}
              onClick={() => { void choose(m) }}
              onKeyDown={e => {
                const j = radioStep(e.key, i, options.length)
                if (j === null) return
                e.preventDefault(); refs.current[j]?.focus(); void choose(options[j]!)
              }}>{AUTONOMY_LABEL[m]}</button>
          )
        })}
      </div>
      <p className="muted seg-copy" aria-live="polite">{value ? AUTONOMY_COPY[task][value] : err ? '' : 'Loading…'}</p>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
