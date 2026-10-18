import { useEffect, useRef, useState } from 'react'
import { ApiError, type Api } from '../core/api'
import { bus } from '../core/bus'
import type { KV } from '../core/storage'
import { ClassPicker } from './ClassPicker'
import { MotionToggle } from './ImuDebug'
import { rePair } from './kvContext'
import { CLASS_ID_KEY, MODE_EMOJI } from './classPref'
import { RosterCheckIn } from './RosterCheckIn'
import { SetupEntry } from './onboarding/SetupEntry'
import { usePoll } from './usePoll'

export function Today({ api, kv, onOpenDeck, onSetup }: { api: Api; kv: KV; onOpenDeck(deckId: string): void; onSetup(): void }) {
  const [classId, setClassId] = useState<string | null | undefined>(undefined) // undefined = KV not read yet
  const [checkIn, setCheckIn] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)
  const classRef = useRef<string | null | undefined>(undefined)
  classRef.current = classId
  useEffect(() => {
    void kv.get(CLASS_ID_KEY).then(v => setClassId(v || null), () => setClassId(null))
    // A storage read that never answers must not leave Today on "Loading…": fall back to the default class.
    const t = setTimeout(() => setClassId(c => (c === undefined ? null : c)), 3000)
    return () => clearTimeout(t)
  }, [kv])

  function clearStoredClass() {
    setClassId(null)
    void kv.set(CLASS_ID_KEY, '').catch(() => {}).then(() => bus.emit('classChanged', null))
  }
  const { data: t, error, loading, reload } = usePoll(
    async () => {
      try { return await api.today(classId ?? undefined) } catch (e) {
        if (e instanceof ApiError && e.status === 404 && classId && classRef.current === classId) clearStoredClass() // stale class: fall back to default (effect reloads)
        throw e
      }
    },
    15000,
    [classId],
    classId !== undefined,
  )
  useEffect(() => bus.on('sessionChanged', () => reload()), [reload])
  useEffect(() => bus.on('classChanged', id => setClassId(id)), []) // follow a class picked on the lens (swipe on home)

  async function pick(id: string) {
    setActionErr(null)
    try { await kv.set(CLASS_ID_KEY, id) } catch { setActionErr('Couldn’t save your class choice on this phone.'); return }
    setClassId(id); setCheckIn(false)
    bus.emit('classChanged', id)
  }
  const picker = <ClassPicker api={api} value={classId ?? t?.classId ?? null} loading={loading} onChange={pick} />
  const banner = error && <p className="error" role="alert">Couldn’t load today: {error}</p>

  if (!t) return (
    <main className="screen">
      {picker}{banner}
      {actionErr && <p className="error" role="alert">{actionErr}</p>}
      {error
        ? <div className="btns"><button type="button" onClick={reload}>Retry</button><button type="button" onClick={() => { void rePair(kv) }}>Re-pair this phone</button></div>
        : <p className="muted" role="status">Loading…</p>}
      {error && <SetupEntry onOpen={onSetup} />}
    </main>
  )

  async function openCheckIn() {
    if (!t) return
    setActionErr(null)
    try {
      if (!t.sessionId) { const s = await api.startSession(t.classId); bus.emit('sessionChanged', s.sessionId) }
      setCheckIn(true)
    } catch { setActionErr('Couldn’t start check-in. Try again.') }
  }
  const mins = t.deck.drills.reduce((n, d) => n + d.minutes, 0)
  return (
    <main className="screen">
      {picker}
      {banner}
      <span className={`mode mode-${t.mode}`}>{MODE_EMOJI[t.mode]} {t.modeLabel}</span>
      <h1>Today</h1>
      <div className="sub">{t.className} · {t.startTime} · {t.roster.length} {t.people}{t.sessionId ? ' · in progress' : ''}</div>
      <section className="card"><div className="label">{t.weeklyLabel}</div><b>{t.theme}</b>
        <div className="muted">{t.itemsDueLabel}: {t.formsDue.join(', ') || '—'}</div></section>
      <section className="card"><div className="label">Focus (from your notes)</div>
        {t.focus.length ? t.focus.map(f => <div key={f.label} className="dot">{f.label}</div>) : <div className="muted">No open focus areas.</div>}
      </section>
      <section className="card tappable" role="button" tabIndex={0} aria-label={`${t.planUnit}, edit`} onClick={() => onOpenDeck(t.deck.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenDeck(t.deck.id) } }}>
        <div className="row"><b className="grow">{t.planUnit}</b><span className="muted">{t.deck.drills.length} items · {mins} min · edit ›</span></div>
        {t.deck.drills.slice(0, 4).map(d => <div className="drill" key={d.id}><span>{d.name}</span><span className="muted">{d.minutes}m</span></div>)}
      </section>
      {checkIn && t.sessionId
        ? <RosterCheckIn api={api} sessionId={t.sessionId} roster={t.roster} people={t.people} onDone={() => { setCheckIn(false); reload() }} />
        : <>
            <div className="btns"><button type="button" onClick={openCheckIn}>Roster check-in</button><button type="button" className="primary" onClick={() => bus.emit('startClass', undefined)}>Start on glasses</button></div>
            <p className="muted hint">Tap your temple to talk anytime</p>
          </>}
      {actionErr && <p className="error" role="alert">{actionErr}</p>}
      <SetupEntry onOpen={onSetup} />
      <MotionToggle kv={kv} />
    </main>
  )
}
