import { ApiError, NetworkError } from '../core/api'

export type Outcome = { kind: 'gone'; text: string } | { kind: 'error'; text: string }

/** Maps a failed review/student action to UI feedback. 404/409 mean someone already handled it. */
export function outcomeFor(e: unknown, verb = 'Action'): Outcome {
  if (e instanceof ApiError) {
    if (e.status === 404 || e.status === 409) return { kind: 'gone', text: 'Already handled — list refreshed.' }
    if (e.status === 502) return { kind: 'error', text: 'Sending failed. The draft is still here, so you can try again.' }
    if (e.status === 401 || e.status === 403) return { kind: 'error', text: 'Session expired. Re-pair this phone from Today.' }
    return { kind: 'error', text: `${verb} failed (${e.message}).` }
  }
  if (e instanceof NetworkError) return { kind: 'error', text: 'No connection. Check your signal and try again.' }
  return { kind: 'error', text: `${verb} failed. Try again.` }
}

export function studentOutcome(e: unknown): string {
  if (e instanceof ApiError && e.status === 404) return 'Student not found.'
  return outcomeFor(e, 'Loading').text
}

type Kinded = { id: string; kind: string }

/** Ids of the emails the instructor can actually see: only these may be bulk-approved. */
export function visibleEmailIds(items: readonly Kinded[] | null | undefined): string[] {
  return (items ?? []).filter(i => i.kind === 'parent_email' || i.kind === 'report_card').map(i => i.id)
}

/** Bulk-send candidates: visible emails minus any the instructor edited or is editing (those go individually). */
export function bulkEmailIds(items: readonly Kinded[] | null | undefined, dirty: ReadonlySet<string>): string[] {
  return visibleEmailIds(items).filter(id => !dirty.has(id))
}

export function approveAllNotice(r: { sent: number; failed: number }): string {
  if (r.failed > 0) return `Sent ${r.sent}, ${r.failed} failed. Failed drafts stay in the list.`
  return `Sent ${r.sent}.`
}

export function cap(s: string): string { return s ? s[0]!.toUpperCase() + s.slice(1) : s }
