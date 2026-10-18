import { useEffect, useState } from 'react'
import type { Api } from '../core/api'
import { addVocabTerm, removeVocabTerm } from './agentsLogic'
import { outcomeFor } from './reviewLogic'

/** Words CoachLens should know (move names, studio jargon). Same chip pattern as AliasEditor; saved on every change. */
export function VocabEditor({ api }: { api: Api }) {
  const [terms, setTerms] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    api.settings().then(s => { if (live) setTerms(s.vocabulary) }).catch(e => { if (live) setErr(outcomeFor(e, 'Loading').text) })
    return () => { live = false }
  }, [api])

  async function save(next: string[], okText: string) {
    if (busy) return false
    setBusy(true); setErr(null); setMsg(null)
    try { setTerms((await api.patchSettings({ vocabulary: next })).vocabulary); setMsg(okText); return true } catch (e) { setErr(outcomeFor(e, 'Saving').text); return false } finally { setBusy(false) }
  }
  async function add() {
    const res = addVocabTerm(terms ?? [], draft)
    if ('error' in res) { setErr(res.error); return }
    if (await save(res.list, `Added “${draft.trim()}”.`)) setDraft('')
  }
  const ready = terms !== null
  return (
    <section className="vocab" aria-labelledby="vocab-h">
      <div className="label" id="vocab-h">Words CoachLens should know</div>
      <p className="muted hint-left">Move names and jargon help it hear and sort what you say.</p>
      <ul className="chips alias-list" aria-label="Custom words">
        {terms?.map(t => (
          <li key={t} className="alias"><span>{t}</span><button type="button" disabled={busy} aria-label={`Remove word ${t}`} onClick={() => { void save(removeVocabTerm(terms, t), `Removed “${t}”.`) }}>×</button></li>
        ))}
        {ready && !terms.length && <li className="muted">No words yet.</li>}
      </ul>
      <form className="row ask" onSubmit={e => { e.preventDefault(); void add() }}>
        <label className="sr-only" htmlFor="vocab-in">Add a word</label>
        <input id="vocab-in" className="grow" value={draft} maxLength={40} disabled={busy || !ready} placeholder="Add a word…" onChange={e => { setDraft(e.target.value); setErr(null) }} />
        <button type="submit" disabled={busy || !ready || !draft.trim()}>{busy ? 'Saving…' : 'Add'}</button>
      </form>
      <div aria-live="polite">{msg && <p className="notice">{msg}</p>}</div>
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
