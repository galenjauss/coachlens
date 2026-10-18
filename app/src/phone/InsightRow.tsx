import { useState } from 'react'
import type { Insight } from '@matside/shared'
import type { Api } from '../core/api'
import { acceptLabel, isOpen, statusWord, type RowOutcome } from './insightsLogic'
import { outcomeFor } from './reviewLogic'

interface InsightRowProps {
  api: Api
  insight: Insight
  /** What the coach did with it on this screen (overrides the server status until the next load). */
  outcome: RowOutcome | null
  onSettled(id: string, outcome: RowOutcome): void
}

/** One insight: who · title · detail, then Do it / Dismiss, or the outcome inline once it is settled. */
export function InsightRow({ api, insight: i, outcome, onSettled }: InsightRowProps) {
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null)
  const [err, setErr] = useState<string | null>(null)

  async function act(kind: 'accept' | 'dismiss') {
    if (busy) return
    setBusy(kind); setErr(null)
    try {
      if (kind === 'accept') onSettled(i.id, { kind: 'accepted', text: (await api.acceptInsight(i.id)).outcome })
      else { await api.dismissInsight(i.id); onSettled(i.id, { kind: 'dismissed' }) }
    } catch (e) {
      const o = outcomeFor(e, kind === 'accept' ? 'Doing it' : 'Dismissing')
      if (o.kind !== 'gone') setErr(o.text)
      else onSettled(i.id, kind === 'accept' ? { kind: 'accepted', text: 'Already handled' } : { kind: 'dismissed' })
    } finally { setBusy(null) }
  }

  const open = !outcome && isOpen(i)
  const done = outcome?.kind === 'accepted' ? outcome.text : outcome?.kind === 'dismissed' ? 'Dismissed' : statusWord(i.status)
  return (
    <li className={`insight${i.urgency === 'high' ? ' high' : ''}${open ? '' : ' settled'}`}>
      {(i.urgency === 'high' || i.studentName) && (
        <div className="insight-head">
          {i.urgency === 'high' && <span className="insight-now">Now</span>}
          {i.studentName && <span className="insight-who">{i.studentName}</span>}
        </div>
      )}
      <p className="insight-title">{i.title}</p>
      {i.detail && <p className="insight-detail">{i.detail}</p>}
      {open ? (
        <div className="insight-actions">
          {i.actionLabel && <span className="insight-next">Next step: {i.actionLabel}</span>}
          <button type="button" className="insight-do" disabled={busy !== null} onClick={() => { void act('accept') }}
            aria-label={i.actionLabel ? `Do it: ${i.actionLabel}` : 'Got it'}>{busy === 'accept' ? 'Working…' : acceptLabel(i)}</button>
          <button type="button" className="quiet" disabled={busy !== null} onClick={() => { void act('dismiss') }}>{busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}</button>
        </div>
      ) : done && (
        <p className={`insight-outcome${outcome?.kind === 'dismissed' || i.status === 'dismissed' ? ' off' : ''}`} role="status">
          {outcome?.kind === 'dismissed' || (!outcome && i.status === 'dismissed') ? done : `✓ ${done}`}
        </p>
      )}
      {err && <p className="error" role="alert">{err}</p>}
    </li>
  )
}
