import { useCallback, useEffect, useRef, useState } from 'react'
import { createSeqGuard } from './pollGuard'

/** Polls `fn` every `ms` (paused while the page is hidden). Stale responses never overwrite newer ones. */
export function usePoll<T>(fn: () => Promise<T>, ms: number | null, deps: unknown[] = [], enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const guard = useRef(createSeqGuard())
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = () => {
      const mine = guard.current.next()
      return fnRef.current().then(
        d => { if (alive && guard.current.accept(mine)) { setData(d); setError(null); setLoading(false) } },
        e => { if (alive && guard.current.accept(mine)) { setError(e instanceof Error ? e.message : 'Failed'); setLoading(false) } },
      )
    }
    setLoading(true)
    void load()
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => { if (ms && id === null) id = setInterval(load, ms) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVis = () => { if (document.hidden) stop(); else { void load(); start() } }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVis)
    return () => { alive = false; stop(); document.removeEventListener('visibilitychange', onVis) }
  }, [ms, tick, enabled, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload }
}
