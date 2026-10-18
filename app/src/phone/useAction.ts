import { useCallback, useRef, useState } from 'react'
import { outcomeFor } from './reviewLogic'

/** Runs one async action at a time; surfaces errors inline and "already handled" via onGone. */
export function useAction(onGone: (text: string) => void, refresh: () => void, verb?: string) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const lock = useRef(false)
  const run = useCallback(async (f: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setErr(null)
    try { await f(); refresh() } catch (e) {
      const o = outcomeFor(e, verb)
      if (o.kind === 'gone') { onGone(o.text); refresh() } else setErr(o.text)
    } finally { lock.current = false; setBusy(false) }
  }, [onGone, refresh, verb])
  return { busy, err, run }
}
