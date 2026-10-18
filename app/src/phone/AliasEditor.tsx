import { useState } from 'react'
import type { Api } from '../core/api'
import { addAlias, removeAlias } from './agentsLogic'
import { outcomeFor } from './reviewLogic'
import { usePoll } from './usePoll'

/** Nicknames the voice matcher also recognizes. Saved to the server on every change. */
export function AliasEditor({ api, studentId, firstName }: { api: Api; studentId: string; firstName: string }) {
  const { data: roster, error } = usePoll(() => api.students(), null, [studentId])
  const [saved, setSaved] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const aliases = saved ?? roster?.find(s => s.id === studentId)?.aliases ?? []
  const ready = roster !== null || saved !== null

  async function save(next: string[], okText: string) {
    if (busy) return
    setBusy(true); setErr(null); setMsg(null)
    try { const r = await api.patchStudentAliases(studentId, next); setSaved(r.aliases); setMsg(okText); return true } catch (e) { setErr(outcomeFor(e, 'Saving').text); return false } finally { setBusy(false) }
  }
  async function add() {
    const res = addAlias(aliases, draft)
    if ('error' in res) { setErr(res.error); return }
    if (await save(res.list, `Added “${draft.trim()}”.`)) setDraft('')
  }
  return (
    <section className="card" aria-labelledby="sd-alias">
      <div className="label" id="sd-alias">Also called</div>
      <p className="muted hint-left">Nicknames help the agents hear who you mean.</p>
      {error && !ready && <p className="error" role="alert">Couldn’t load nicknames: {error}</p>}
      <ul className="chips alias-list" aria-label={`Nicknames for ${firstName}`}>
        {aliases.map(a => (
          <li key={a} className="alias"><span>{a}</span><button type="button" disabled={busy} aria-label={`Remove nickname ${a}`} onClick={() => save(removeAlias(aliases, a), `Removed “${a}”.`)}>×</button></li>
        ))}
        {ready && !aliases.length && <li className="muted">No nicknames yet.</li>}
      </ul>
      <form className="row ask" onSubmit={e => { e.preventDefault(); void add() }}>
        <label className="sr-only" htmlFor="alias-in">Add a nickname for {firstName}</label>
        <input id="alias-in" className="grow" value={draft} maxLength={40} disabled={busy || !ready} placeholder="Add a nickname…" onChange={e => { setDraft(e.target.value); setErr(null) }} />
        <button type="submit" disabled={busy || !ready || !draft.trim()}>{busy ? 'Saving…' : 'Add'}</button>
      </form>
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
