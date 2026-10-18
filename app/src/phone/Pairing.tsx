import { useState, type FormEvent } from 'react'
import type { Api } from '../core/api'
import { ApiError } from '../core/api'
import { bus } from '../core/bus'
import { KEYS, type KV } from '../core/storage'

export function Pairing({ api, kv, onPaired }: { api: Api; kv: KV; onPaired(): void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const { token } = await api.pair(code.trim())
      try { await kv.set(KEYS.token, token) } catch { setErr('Couldn’t save on this phone. Try again.'); return }
      bus.emit('paired', undefined)
      onPaired()
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? 'That code didn’t match.' : 'Can’t reach CoachLens. Check your connection.')
    } finally { setBusy(false) }
  }
  return (
    <main className="screen pairing">
      <p className="brand"><span className="lens-ring" aria-hidden="true" />CoachLens</p>
      <h1>Coach heads-up.<br />Hands free.</h1>
      <p className="sub">Enter your pairing code to connect this phone and your glasses.</p>
      <form onSubmit={submit}>
        <label className="label" htmlFor="code">Pairing code</label>
        <input id="code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} placeholder="000000" />
        {err && <p className="error" role="alert">{err}</p>}
        <div className="btns"><button type="submit" className="primary" disabled={!code.trim() || busy}>{busy ? 'Pairing…' : 'Pair'}</button></div>
      </form>
    </main>
  )
}
