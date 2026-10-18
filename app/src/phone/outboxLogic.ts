import { useEffect, useState } from 'react'
import { bus } from '../core/bus'
import { OUTBOX_WARN_FRACTION, knownFailedCount, knownOutboxCount, knownOutboxUsage, retryText, type FailedItem, type OutboxItem } from '../core/outbox'

/** Today banner text for notes waiting in the outbox; null when none. */
export function queuedBanner(count: number): string | null {
  if (count <= 0) return null
  return `${count} ${count === 1 ? 'note' : 'notes'} waiting to send`
}

/** Both stores in one line (F07): waiting to send, and rejected (kept until retried or discarded). */
export function unsentSummary(queued: number, failed: number): string | null {
  const notSent = failed > 0 ? `${failed} ${failed === 1 ? 'note' : 'notes'} not sent` : null
  if (queued <= 0) return notSent
  const q = queuedBanner(queued)!
  return failed > 0 ? `${q} · ${failed} not sent` : q
}

export type UnsentRow = { id: string; kind: 'queued' | 'failed'; when: string; preview: string; reason: string; canRetry: boolean; canDiscard: boolean }

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
function preview(i: OutboxItem): string {
  const what = i.form.text ? `“${i.form.text.length > 80 ? `${i.form.text.slice(0, 79)}…` : i.form.text}”` : 'Voice note'
  return i.form.mode === 'attendance' ? `Roll call · ${what}` : what
}

/**
 * Unsent notes panel rows: queued ones (with the true reason they wait; they retry on their own, Retry
 * sends now) then failed ones (the server's rejection reason; Retry re-queues, Discard deletes).
 */
export function unsentRows(queued: readonly OutboxItem[], failed: readonly FailedItem[]): UnsentRow[] {
  return [
    ...queued.map(i => ({ id: i.id, kind: 'queued' as const, when: time(i.createdAt), preview: preview(i), reason: retryText(i.lastError), canRetry: true, canDiscard: false })),
    ...failed.map(i => ({ id: i.id, kind: 'failed' as const, when: time(i.createdAt), preview: preview(i), reason: i.failure.reason, canRetry: true, canDiscard: true })),
  ]
}

/** Live outbox count (starts from the last announced count; follows `outboxChanged`). */
export function useOutboxCount(): number {
  const [count, setCount] = useState(knownOutboxCount)
  useEffect(() => bus.on('outboxChanged', setCount), [])
  return count
}

/** Live failed-store count (follows `outboxFailedChanged`). */
export function useFailedCount(): number {
  const [count, setCount] = useState(knownFailedCount)
  useEffect(() => bus.on('outboxFailedChanged', setCount), [])
  return count
}

/** Live storage use of the unsent-notes stores (fraction of the budget). */
export function useOutboxUsage(): number {
  const [f, setF] = useState(() => knownOutboxUsage().fraction)
  useEffect(() => bus.on('outboxUsage', u => setF(u.fraction)), [])
  return f
}

/** F07 / review #1: warn from 70 % of the budget; at 100 % new voice notes are refused on the lens. */
export function storageWarning(fraction: number): string | null {
  if (fraction >= 1) return 'Unsent notes are full: new voice notes can’t be saved. Send or discard notes below.'
  if (fraction >= OUTBOX_WARN_FRACTION) return `Unsent notes are ${Math.round(fraction * 100)}% full. Send or discard some soon.`
  return null
}
