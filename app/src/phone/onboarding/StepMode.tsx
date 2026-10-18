import { useState } from 'react'
import { MODES, type ModeId } from '@matside/shared'
import type { Api } from '../../core/api'
import { MODE_EMOJI } from '../classPref'
import { onboardingErrorText } from './onboardingLogic'

const BLURB: Record<ModeId, string> = {
  martial_arts: 'Belts, forms and drill decks',
  personal_training: 'Clients, programs and session plans',
  tutoring: 'Students, units and lesson plans',
}

type Choice = ModeId | 'other'

export function StepMode({ api, mode, onPick }: { api: Api; mode: ModeId | null; onPick(m: ModeId): void }) {
  const [choice, setChoice] = useState<Choice | null>(mode)
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  function choose(c: Choice) {
    setChoice(c); setErr(null)
    if (c !== 'other') { setReason(null); onPick(c) }
  }
  async function findClosest() {
    setBusy(true); setErr(null)
    try {
      const r = await api.onboardingExtract({ step: 'mode', text: desc.trim() })
      if (r.step === 'mode') { onPick(r.mode); setReason(`Closest fit: ${MODES[r.mode].label}. ${r.reason}`) }
    } catch (e) { setErr(onboardingErrorText(e, 'read')) } finally { setBusy(false) }
  }

  return (
    <fieldset className="ob-fieldset">
      <legend className="sr-only">What do you teach?</legend>
      <div className="ob-tiles">
        {(Object.keys(MODES) as ModeId[]).map(id => (
          <label key={id} className="ob-tile">
            <input type="radio" name="ob-mode" value={id} checked={choice === id} onChange={() => choose(id)} />
            <span className="ob-tile-emoji" aria-hidden="true">{MODE_EMOJI[id]}</span>
            <span className="ob-tile-text"><b>{MODES[id].label}</b><span className="muted">{BLURB[id]}</span></span>
          </label>
        ))}
        <label className="ob-tile">
          <input type="radio" name="ob-mode" value="other" checked={choice === 'other'} onChange={() => choose('other')} />
          <span className="ob-tile-emoji" aria-hidden="true">✳︎</span>
          <span className="ob-tile-text"><b>Something else</b><span className="muted">Describe it and AI picks the closest fit</span></span>
        </label>
      </div>
      {choice === 'other' && (
        <div className="ob-other">
          <label className="label" htmlFor="ob-mode-desc">What do you coach?</label>
          <textarea id="ob-mode-desc" rows={3} maxLength={500} value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Kids’ swim lessons, groups of 6 by level" />
          <div className="btns"><button type="button" className="primary" disabled={desc.trim().length < 3 || busy} onClick={findClosest}>{busy ? 'Finding…' : 'Find my closest fit'}</button></div>
        </div>
      )}
      <div role="status" aria-live="polite" className="ob-live">
        {reason && <p className="ob-found"><span className="lens-ring" aria-hidden="true" />{reason}</p>}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
    </fieldset>
  )
}
