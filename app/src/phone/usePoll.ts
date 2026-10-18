import { useCallback, useEffect, useRef, useState } from 'react'
import { createSeqGuard, singleFlight } from './pollGuard'

/** Polls `fn` every `ms` (paused while the page is hidden). Stale responses never overwrite newer ones. */
export function usePoll<T>(fn: () => Promise<T>, ms: number | null, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const guard = useRef(createSeqGuard())
  const waiters = useRef<Array<() => void>>([])
  const flush = () => { const w = waiters.current; waiters.current = []; w.forEach(f => f()) }
  /** Triggers a reload; the promise resolves once that reload has settled. */
  const reload = useCallback(() => new Promise<void>(res => { waiters.current.push(res); setTick(t => t + 1) }), [])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => {
      const mine = guard.current.next()
      return fnRef.current().then(
        d => { if (alive && guard.current.accept(mine)) { setData(d); setError(null); setLoading(false) } },
        e => { if (alive && guard.current.accept(mine)) { setError(e instanceof Error ? e.message : 'Failed'); setLoading(false) } },
      ).finally(flush)
    }
    // One load in flight at a time: ticks skip while the first (or any) load is still pending, so a slow
    // load (a 15–30 s first plan draft vs a 15 s poll) never stacks duplicate requests.
    const tickLoad = singleFlight(load)
    setLoading(true)
    void tickLoad()
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => { if (ms && id === null) id = setInterval(() => { void tickLoad() }, ms) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVis = () => { if (document.hidden) stop(); else { void tickLoad(); start() } }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; flush(); stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [ms, tick, enabled, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload }
}
