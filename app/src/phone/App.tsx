import { useEffect, useState } from 'react'
import type { AgentTask } from '@matside/shared'
import { bus } from '../core/bus'
import { KEYS } from '../core/storage'
import { Agents } from './Agents'
import { DeckEditor } from './DeckEditor'
import { Onboarding } from './onboarding/Onboarding'
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
  const [setup, setSetup] = useState(false)
  /** Agents opened from Today's "All insights": which task to open, and a nonce that remounts Agents there. */
  const [agentsOpen, setAgentsOpen] = useState<{ task: AgentTask | null; n: number }>({ task: null, n: 0 })
  useEffect(() => { void kv.get(KEYS.token).then(t => setPaired(Boolean(t)), () => setPaired(false)) }, [kv])
  // A 401 anywhere (or "Re-pair this phone") means the token is no longer valid: clear it and pair again.
  useEffect(() => bus.on('unauthorized', () => {
    void kv.set(KEYS.token, '').catch(e => console.warn('[pair] could not clear the token', e))
    setDeckId(null); setSetup(false); setPaired(false)
  }), [kv])
  // Warm the serverless instance on open and on every return to the app; cold starts are slow. Failure is irrelevant.
  useEffect(() => {
    const ping = () => { void api.health().catch(() => {}) }
    const onVisible = () => { if (document.visibilityState === 'visible') ping() }
    ping()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [api])
  // Once paired, open the setup quiz automatically while the school has no classes yet.
  useEffect(() => {
    if (paired !== true) return
    let alive = true
    void api.onboardingStatus().then(s => { if (alive && s.needsOnboarding) setSetup(true) }, () => {})
    return () => { alive = false }
  }, [paired, api])
  const { data: queue } = usePoll(() => api.review(), 20000, [], paired === true)
  const pending = queue?.length ?? 0
  if (paired === null) return null
  if (!paired) return <Pairing api={api} kv={kv} onPaired={() => setPaired(true)} />
  if (setup) return <Onboarding api={api} kv={kv} onExit={() => setSetup(false)} onDone={() => { setSetup(false); setTab('today') }} />
  if (deckId) return <DeckEditor api={api} deckId={deckId} onClose={() => setDeckId(null)} />
  return (
    <>
      {tab === 'today' && <Today api={api} kv={kv} onOpenDeck={setDeckId} onSetup={() => setSetup(true)}
        onOpenInsights={() => { setAgentsOpen(a => ({ task: 'insights', n: a.n + 1 })); setTab('agents') }} />}
      {tab === 'agents' && <Agents key={agentsOpen.n} api={api} initialTask={agentsOpen.task} />}
      {tab === 'review' && <Review api={api} />}
      {tab === 'students' && <Students api={api} />}
      <nav className="tabs" aria-label="CoachLens">
        {TABS.map(t => (
          <button key={t} type="button" aria-current={tab === t ? 'page' : undefined} onClick={() => { if (t === 'agents' && tab !== 'agents') setAgentsOpen(a => ({ ...a, task: null })); setTab(t) }}>{t[0]!.toUpperCase() + t.slice(1)}{t === 'review' && pending > 0 && <><span className="badge" aria-hidden="true">{pending}</span><span className="sr-only"> ({pending} pending)</span></>}</button>
        ))}
      </nav>
    </>
  )
}
