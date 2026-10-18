import { useCallback, useEffect, useRef, useState } from 'react'

export function usePoll<T>(fn: () => Promise<T>, ms: number | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    const load = () => fnRef.current().then(d => { if (alive) { setData(d); setError(null) } }, e => { if (alive) setError(e instanceof Error ? e.message : 'Failed') })
    void load()
    const id = ms ? setInterval(load, ms) : null
    return () => { alive = false; if (id) clearInterval(id) }
  }, [ms, tick, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload }
}
