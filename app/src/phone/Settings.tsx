import { useEffect, useState } from 'react'
import { DEFAULT_RANK_REVIEW, type RankReviewSettings } from '@matside/shared'
import type { Api } from '../core/api'
import type { KV } from '../core/storage'
import { Classes } from './Classes'
import { rePair } from './kvContext'
import { outcomeFor, revokedNotice } from './reviewLogic'
import { parseStatus, readDisplayMode, writeDisplayMode, type DisplayMode } from './settingsLogic'
import { usePoll } from './usePoll'

/** C6: the lens display policy. Quiet is the default. */
function DisplayModeToggle({ kv }: { kv: KV }) {
  const [mode, setMode] = useState<DisplayMode | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { void readDisplayMode(kv).then(setMode) }, [kv])
  async function pick(m: DisplayMode) {
    setErr(null)
    try { await writeDisplayMode(kv, m); setMode(m) } catch { setErr('Couldn’t save this on the phone. Try again.') }
  }
  return (
    <section className="card" aria-labelledby="set-display">
      <div className="label" id="set-display">Lens display</div>
      <div className="btns" role="radiogroup" aria-label="Lens display">
        <button type="button" role="radio" aria-checked={mode === 'quiet'} aria-pressed={mode === 'quiet'} onClick={() => { void pick('quiet') }}>Quiet</button>
        <button type="button" role="radio" aria-checked={mode === 'standard'} aria-pressed={mode === 'standard'} onClick={() => { void pick('standard') }}>Standard</button>
      </div>
      <p className="muted hint-left">{mode === 'standard'
        ? 'The drill, timer and next student stay on the lens until you nod it off. Result cards stay until tapped.'
        : 'In class the lens goes dark 8 s after anything changes, and results close after 6 s. Nod or tap to wake; a tap always starts a note.'}</p>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}

/** C5 / F20: what the server can do right now. */
function ServerStatus({ api }: { api: Api }) {
  const { data, error } = usePoll(() => api.status(), 60_000)
  const s = data ? parseStatus(data) : null
  return (
    <section className="card" aria-labelledby="set-status">
      <div className="label" id="set-status">Server status</div>
      {s ? s.lines.map((l, i) => <div key={i} className={i > 0 ? 'warn-line' : ''}>{l}</div>) : <div className="muted">{error ? 'Status unavailable.' : 'Loading…'}</div>}
    </section>
  )
}

/** F10 (batch 1): the school's thresholds for the rank-review reminder. */
function RankReview({ api }: { api: Api }) {
  const { data, reload } = usePoll(() => api.settings(), null)
  const [draft, setDraft] = useState<RankReviewSettings | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setDraft(data.rankReview ?? DEFAULT_RANK_REVIEW) }, [data])
  if (!draft) return null
  const num = (k: 'minDaysAtRank' | 'minAttendance' | 'attendanceWindowDays', label: string, min: number, max: number) => (
    <label className="field-gap">{label}
      <input type="number" inputMode="numeric" min={min} max={max} value={draft[k]} onChange={e => setDraft({ ...draft, [k]: Math.max(min, Math.min(max, Number(e.target.value) || 0)) })} />
    </label>
  )
  async function save() {
    if (!draft || busy) return
    setBusy(true); setMsg(null)
    try { await api.patchSettings({ rankReview: draft }); setMsg('Saved.'); await reload() } catch (e) { setMsg(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }
  return (
    <section className="card" aria-labelledby="set-rank">
      <div className="label" id="set-rank">Rank review reminder</div>
      <p className="muted">A reminder to review a student for their next rank, never a judgement. Set what your school requires.</p>
      {num('minDaysAtRank', 'Days at current rank', 0, 3650)}
      {num('minAttendance', 'Classes attended (minimum)', 0, 200)}
      {num('attendanceWindowDays', 'Counted over the last N days', 7, 56)}
      <label className="row field-gap"><input type="checkbox" className="check" checked={draft.requireNoOpenIssues} onChange={e => setDraft({ ...draft, requireNoOpenIssues: e.target.checked })} /> No open focus areas</label>
      <div className="btns"><button type="button" className="primary" disabled={busy} onClick={() => { void save() }}>{busy ? 'Saving…' : 'Save thresholds'}</button></div>
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
    </section>
  )
}

/** F18 / C4: revoke this phone's token on the server, then forget it here. */
function Unpair({ api, kv }: { api: Api; kv: KV }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function unpair() {
    setBusy(true); setErr(null)
    try { await api.unpair() } catch (e) {
      // 401 = already revoked: fine. Anything else: the token may still be valid on the server; say so.
      const status = (e as { status?: number }).status
      if (status !== 401) { setBusy(false); setErr(`Couldn’t reach the server to revoke this phone (${outcomeFor(e).text}) Try again, or unpair anyway.`); return }
    }
    await rePair(kv)
  }
  return (
    <section className="card" aria-labelledby="set-unpair">
      <div className="label" id="set-unpair">This phone</div>
      {!confirm
        ? <div className="btns"><button type="button" onClick={() => setConfirm(true)}>Unpair this phone</button></div>
        : <>
            <p>Unpairing signs this phone out on the server too. You’ll need the pairing code to use it again.</p>
            <div className="btns">
              <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className="danger" disabled={busy} onClick={() => { void unpair() }}>{busy ? 'Unpairing…' : 'Unpair'}</button>
            </div>
            {err && <><p className="error" role="alert">{err}</p><div className="btns"><button type="button" onClick={() => { void rePair(kv) }}>Unpair anyway (this phone only)</button></div></>}
          </>}
    </section>
  )
}

/** C4 (batch 2): sign out every other phone paired to this account; this one stays signed in. */
function SignOutOthers({ api }: { api: Api }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function revoke() {
    setBusy(true); setErr(null); setMsg(null)
    try { const r = await api.revokeOtherTokens(); setMsg(revokedNotice(r.revoked)); setConfirm(false) } catch (e) {
      setErr(`Other phones are still signed in. ${outcomeFor(e, 'Signing out').text}`)
    } finally { setBusy(false) }
  }
  return (
    <section className="card" aria-labelledby="set-others">
      <div className="label" id="set-others">Other phones</div>
      {!confirm
        ? <div className="btns"><button type="button" onClick={() => { setMsg(null); setErr(null); setConfirm(true) }}>Sign out other phones</button></div>
        : <>
            <p>Every other phone paired to your account is signed out and will need the pairing code again. This phone stays signed in.</p>
            <div className="btns">
              <button type="button" disabled={busy} onClick={() => setConfirm(false)}>Cancel</button>
              <button type="button" className="danger" disabled={busy} onClick={() => { void revoke() }}>{busy ? 'Signing out…' : 'Sign out others'}</button>
            </div>
          </>}
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}

export function Settings({ api, kv, onClose }: { api: Api; kv: KV; onClose(): void }) {
  const [classes, setClasses] = useState(false)
  if (classes) return <Classes api={api} onBack={() => setClasses(false)} />
  return (
    <main className="screen">
      <button type="button" className="back" onClick={onClose}>‹ Back</button>
      <h1>Settings</h1>
      <DisplayModeToggle kv={kv} />
      <section className="card"><div className="row"><span className="grow">Classes and schedules</span><button type="button" className="quiet" onClick={() => setClasses(true)}>Manage ›</button></div></section>
      <RankReview api={api} />
      <ServerStatus api={api} />
      <Unpair api={api} kv={kv} />
      <SignOutOthers api={api} />
    </main>
  )
}
