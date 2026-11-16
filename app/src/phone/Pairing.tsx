import { useState, type FormEvent } from 'react'
import type { Api } from '../core/api'
import { ApiError } from '../core/api'
import { bus } from '../core/bus'
import { KEYS, type KV } from '../core/storage'

/** What went wrong, in the coach's words. */
export function pairingError(e: unknown, viaCode: boolean): string {
  if (e instanceof ApiError && e.status === 401 && viaCode) return 'That code didn’t match.'
  if (e instanceof ApiError && e.status === 429) return 'Too many tries. Wait a few minutes, then try again.'
  if (e instanceof ApiError && e.status === 503 && e.message === 'signups_paused') return 'New sign-ups are paused for today. Try again tomorrow.'
  return 'Can’t reach CoachLens. Check your connection.'
}

/**
 * First screen. "Get started" makes a new private account in one tap (no email, no code); a coach who already has an
 * account adds this phone with the pairing code from Settings on their other phone.
 */
export function Pairing({ api, kv, onPaired }: { api: Api; kv: KV; onPaired(): void }) {
  const [withCode, setWithCode] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function connect(get: () => Promise<{ token: string }>, viaCode: boolean) {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const { token } = await get()
      try { await kv.set(KEYS.token, token) } catch { setErr('Couldn’t save on this phone. Try again.'); return }
      bus.emit('paired', undefined)
      onPaired()
    } catch (e) {
      setErr(pairingError(e, viaCode))
    } finally { setBusy(false) }
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    void connect(() => api.pair(code.trim()), true)
  }

  return (
    <main className="screen pairing">
      <p className="brand"><span className="lens-ring" aria-hidden="true" />CoachLens</p>
      <h1>Coach heads-up.<br />Eyes on the class.</h1>
      {withCode ? (
        <form onSubmit={submit}>
          <p className="sub">Already use CoachLens on another phone? Enter the pairing code from Settings there.</p>
          <label className="label" htmlFor="code">Pairing code</label>
          <input id="code" autoCapitalize="none" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="Your code" />
          {err && <p className="error" role="alert">{err}</p>}
          <div className="btns"><button type="submit" className="primary" disabled={!code.trim() || busy}>{busy ? 'Pairing…' : 'Pair'}</button></div>
          <button type="button" className="text-link" onClick={() => { setWithCode(false); setErr(null) }}>Back</button>
        </form>
      ) : (
        <>
          <p className="sub">Speak notes about your students during class. CoachLens files them and drafts the follow-up.</p>
          {err && <p className="error" role="alert">{err}</p>}
          <div className="btns"><button type="button" className="primary" disabled={busy} onClick={() => void connect(() => api.signup(), false)}>{busy ? 'Setting up…' : 'Get started'}</button></div>
          <button type="button" className="text-link" onClick={() => { setWithCode(true); setErr(null) }}>I have a pairing code</button>
          <p className="muted fine">Your account is private: only phones you pair can see it. Next, add your classes.</p>
        </>
      )}
    </main>
  )
}
