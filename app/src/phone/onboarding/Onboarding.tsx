import './onboarding.css'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { OnboardingCommitResponse } from '@matside/shared'
import { MODES } from '@matside/shared'
import type { Api } from '../../core/api'
import type { KV } from '../../core/storage'
import { autoAssign, buildCommit, canLeaveStep, initialDraft, localToday, onboardingErrorText, restoreDraft, setMode, STEPS, type Draft } from './onboardingLogic'
import { Stepper } from './Stepper'
import { StepBasics } from './StepBasics'
import { StepMode } from './StepMode'
import { StepReview } from './StepReview'
import { StepUpload } from './StepUpload'

export const DRAFT_KEY = 'coachlens.onboardingDraft'

/** Six-step setup quiz. The draft lives on this phone until the coach commits it. */
export function Onboarding({ api, kv, onExit, onDone }: { api: Api; kv: KV; onExit(): void; onDone(): void }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [index, setIndex] = useState(0)
  const [reached, setReached] = useState(0)
  const [errors, setErrors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [done, setDone] = useState<OnboardingCommitResponse | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstRender = useRef(true)

  useEffect(() => { void kv.get(DRAFT_KEY).then(raw => setDraft(restoreDraft(raw)), () => setDraft(initialDraft())) }, [kv])
  // Persist edits so a WebView reload doesn't lose the quiz (best effort).
  useEffect(() => { if (draft && !done) void kv.set(DRAFT_KEY, JSON.stringify(draft)).catch(() => {}) }, [draft, done, kv])
  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return }
    heading.current?.focus()
    document.getElementById('root')?.scrollTo({ top: 0 }) // #root is the scroll container (theme.css)
  }, [index, done])

  const update = useCallback((f: (d: Draft) => Draft) => setDraft(d => (d ? f(d) : d)), [])

  if (!draft) return <main className="screen ob"><p className="muted" role="status">Loading…</p></main>

  const step = STEPS[index]!
  const mode = draft.mode ?? 'martial_arts'
  const go = (i: number) => {
    const next = Math.max(0, Math.min(STEPS.length - 1, i))
    if (STEPS[next]!.id === 'review') update(autoAssign)
    setErrors([]); setSaveErr(null)
    setIndex(next); setReached(r => Math.max(r, next))
  }
  const today = localToday(new Date(), draft.basics.timeZone)

  async function save() {
    if (!draft) return
    const b = buildCommit(autoAssign(draft), today)
    if (!b.ok) { setErrors(b.errors); return }
    setErrors([]); setSaving(true); setSaveErr(null)
    try {
      const r = await api.onboardingCommit(b.commit)
      setDone(r)
      void kv.set(DRAFT_KEY, '').catch(() => {})
    } catch (e) { setSaveErr(onboardingErrorText(e, 'save')) } finally { setSaving(false) }
  }

  if (done) {
    const m = MODES[mode]
    return (
      <main className="screen ob">
        <p className="brand"><span className="lens-ring" aria-hidden="true" />CoachLens</p>
        <h1 ref={heading} tabIndex={-1} className="ob-title">You’re set up.</h1>
        <p className="sub">{draft.basics.schoolName} is ready on your glasses.</p>
        <dl className="ob-tally ob-tally-done">
          <div><dt>Classes</dt><dd>{done.classIds.length}</dd></div>
          <div><dt>{m.people}</dt><dd>{done.studentCount}</dd></div>
          <div><dt>Weeks</dt><dd>{done.weeks}</dd></div>
        </dl>
        <p className="ob-found" role="status"><span className="lens-ring" aria-hidden="true" />
          {done.plansQueued ? `Drafting the first ${m.planUnit.toLowerCase()} for ${done.plansQueued === 1 ? 'your class. It shows' : `each of ${done.plansQueued} classes. They show`} up on Today in a minute.` : 'Saved.'}
        </p>
        <div className="btns"><button type="button" className="primary" onClick={onDone}>Go to Today</button></div>
      </main>
    )
  }

  const isUpload = step.id === 'classes' || step.id === 'roster' || step.id === 'curriculum'
  const stepCount = step.id === 'classes' ? draft.classes.length : step.id === 'roster' ? draft.students.length : step.id === 'curriculum' ? draft.weeks.length : 1
  const optional = step.id === 'roster' || step.id === 'curriculum'
  return (
    <main className="screen ob">
      <header className="ob-head">
        <p className="brand ob-brand"><span className="lens-ring" aria-hidden="true" />Set up CoachLens</p>
        <button type="button" className="ob-exit" onClick={onExit}>Exit<span className="sr-only"> setup (your answers stay on this phone)</span></button>
      </header>
      <Stepper index={index} reached={reached} onJump={go} />
      <section className="ob-card" aria-labelledby="ob-step-title">
        <p className="label">Step {index + 1} of {STEPS.length}</p>
        <h2 id="ob-step-title" ref={heading} tabIndex={-1} className="ob-title">{step.title}</h2>
        {step.id === 'mode' && <StepMode api={api} mode={draft.mode} onPick={m => update(d => setMode(d, m))} />}
        {step.id === 'basics' && <StepBasics basics={draft.basics} onChange={b => update(d => ({ ...d, basics: b }))} />}
        {isUpload && <StepUpload api={api} step={step.id as 'classes' | 'roster' | 'curriculum'} mode={mode} draft={draft} update={update} />}
        {step.id === 'review' && <StepReview draft={draft} mode={mode} update={update} errors={errors} onEdit={go} />}
        {saveErr && <p className="error" role="alert">{saveErr}</p>}
      </section>
      <div className="ob-footer">
        <button type="button" onClick={() => (index === 0 ? onExit() : go(index - 1))}>{index === 0 ? 'Not now' : 'Back'}</button>
        {step.id === 'review'
          ? <button type="button" className="primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save everything'}</button>
          : <button type="button" className="primary" disabled={!canLeaveStep(step.id, draft) || (step.id === 'classes' && stepCount === 0)} onClick={() => go(index + 1)}>
              {optional && stepCount === 0 ? 'Skip for now' : 'Next'}
            </button>}
      </div>
    </main>
  )
}
