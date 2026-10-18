import { useState } from 'react'
import type { RosterStudent } from '@matside/shared'
import type { Api } from '../core/api'

export function RosterCheckIn({ api, sessionId, roster, people, onDone }: { api: Api; sessionId: string; roster: RosterStudent[]; people: string; onDone(): void }) {
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const toggle = (id: string) => setPresent(p => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function save() {
    try { await api.attendance(sessionId, [...present]); onDone() } catch { setErr('Couldn’t save check-in. Try again.') }
  }
  return (
    <section className="card" aria-label="Roster check-in">
      <div className="label">Tap who's here · {present.size}/{roster.length} {people}</div>
      <div className="grid2">
        {roster.map(s => (
          <button key={s.id} type="button" aria-pressed={present.has(s.id)} className={present.has(s.id) ? 'primary' : ''} onClick={() => toggle(s.id)}>{s.name.split(' ')[0]}</button>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button type="button" onClick={onDone}>Cancel</button><button type="button" className="primary" onClick={save}>Save check-in</button></div>
    </section>
  )
}
