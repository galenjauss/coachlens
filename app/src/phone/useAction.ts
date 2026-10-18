import { useCallback, useRef, useState } from 'react'
import { outcomeFor } from './reviewLogic'

/** Runs one async action at a time; busy stays on until the refresh settles. Errors show inline, "already handled" via onNotice. */
export function useAction(onNotice: (text: string) => void, refresh: () => void | Promise<unknown>, verb?: string) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const lock = useRef(false)
  const run = useCallback(async (f: () => Promise<unknown>, okText?: string) => {
    if (lock.current) return
    lock.current = true; setBusy(true); setErr(null)
    try {
      await f()
      if (okText) onNotice(okText)
      await refresh()
    } catch (e) {
      const o = outcomeFor(e, verb)
      if (o.kind === 'gone') { onNotice(o.text); await refresh() } else setErr(o.text)
    } finally { lock.current = false; setBusy(false) }
  }, [onNotice, refresh, verb])
  return { busy, err, run }
}
