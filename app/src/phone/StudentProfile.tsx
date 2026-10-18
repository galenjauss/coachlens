import { useState } from 'react'
import type { Api } from '../core/api'
import type { StudentDetail } from '@matside/shared'
import { outcomeFor } from './reviewLogic'

const DOTS = /([●○]+)/

/** A brief line; attendance dots get their own colors so the streak reads at a glance. */
function BriefLine({ line }: { line: string }) {
  const parts = line.split(DOTS)
  return <>{parts.map((p, i) => (DOTS.test(p) && i % 2 === 1
    ? <span key={i} className="dots" aria-label={`${[...p].filter(c => c === '●').length} of ${[...p].length} present`}>{[...p].map((c, j) => <span key={j} className={c === '●' ? 'on' : 'off'}>{c}</span>)}</span>
    : <span key={i}>{p}</span>))}</>
}

/** Profile: the same brief the lens shows, plus the editable rank and when it began. */
export function StudentProfile({ api, s, onSaved }: { api: Api; s: StudentDetail; onSaved(): void }) {
  const [editing, setEditing] = useState(false)
  const [belt, setBelt] = useState(s.belt)
  const [since, setSince] = useState(s.rankSince ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [head, ...rest] = s.brief.lines

  async function save() {
    if (busy) return
    const b = belt.trim()
    if (!b) { setErr('Rank can’t be empty.'); return }
    setBusy(true); setErr(null)
    try {
      await api.patchStudentRank(s.id, { belt: b, rankSince: since || null })
      setEditing(false); onSaved()
    } catch (e) { setErr(outcomeFor(e, 'Saving').text) } finally { setBusy(false) }
  }
  return (
    <section className="card profile" aria-labelledby="sd-profile">
      <div className="label" id="sd-profile">Profile</div>
      {head && <div className="profile-head">{head}</div>}
      <ul className="profile-lines">{rest.map((l, i) => <li key={i}><BriefLine line={l} /></li>)}</ul>
      {!editing ? (
        <div className="rank-row">
          <span className="muted">Rank</span><b>{s.belt}</b>
          <span className="muted grow">{s.rankSince ? `since ${s.rankSince}` : 'start date not set'}</span>
          <button type="button" className="quiet" onClick={() => { setBelt(s.belt); setSince(s.rankSince ?? ''); setEditing(true) }}>Edit</button>
        </div>
      ) : (
        <form className="rank-edit" onSubmit={e => { e.preventDefault(); void save() }}>
          <label htmlFor="rank-in" className="label">Rank</label>
          <input id="rank-in" value={belt} maxLength={40} disabled={busy} onChange={e => { setBelt(e.target.value); setErr(null) }} />
          <label htmlFor="rank-since" className="label">Rank since</label>
          <input id="rank-since" type="date" value={since} disabled={busy} onChange={e => setSince(e.target.value)} />
          <div className="btns"><button type="button" disabled={busy} onClick={() => { setEditing(false); setErr(null) }}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save rank'}</button></div>
        </form>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </section>
  )
}
