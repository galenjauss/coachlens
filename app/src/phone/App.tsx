import { useEffect, useState } from 'react'
import { API_URL } from '../config'
import { KEYS } from '../core/storage'
import { Agents } from './Agents'
import type { PhoneDeps } from './mount'
import { Pairing } from './Pairing'
import { Review } from './Review'
import { Students } from './Students'
import { Today } from './Today'
import { usePoll } from './usePoll'

type Tab = 'today' | 'review' | 'agents' | 'students'
const TABS: Tab[] = ['today', 'review', 'agents', 'students']

export function App({ api, kv }: PhoneDeps) {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [deckId, setDeckId] = useState<string | null>(null)
  useEffect(() => { void kv.get(KEYS.token).then(t => setPaired(Boolean(t)), () => setPaired(false)) }, [kv])
  // Warm the serverless instance; cold starts are slow. Failure is irrelevant.
  useEffect(() => { void fetch(`${API_URL}/health`).catch(() => {}) }, [])
  const { data: queue } = usePoll(() => api.review(), 20000, [], paired === true)
  const pending = queue?.length ?? 0
  if (paired === null) return null
  if (!paired) return <Pairing api={api} kv={kv} onPaired={() => setPaired(true)} />
  return (
    <>
      {tab === 'today' && <Today api={api} kv={kv} onOpenDeck={setDeckId} />}
      {tab === 'agents' && <Agents api={api} />}
      {tab === 'review' && <Review api={api} />}
      {tab === 'students' && <Students api={api} />}
      <nav className="tabs" aria-label="CoachLens">
        {TABS.map(t => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}{t === 'review' && pending > 0 && <span className="badge" aria-label={`${pending} pending`}>{pending}</span>}</button>
        ))}
      </nav>
      {deckId && <div hidden>{deckId}</div>}
    </>
  )
}
