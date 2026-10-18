import { useEffect, useState } from 'react'
import { bus } from '../core/bus'
import { knownOutboxCount } from '../core/outbox'

/** Today banner text for notes waiting in the outbox; null when none. */
export function queuedBanner(count: number): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? 'note' : 'notes'} waiting to send`
}

/** Live outbox count (starts from the last announced count; follows `outboxChanged`). */
export function useOutboxCount(): number {
  const [count, setCount] = useState(knownOutboxCount)
  useEffect(() => bus.on('outboxChanged', setCount), [])
  return count
}
