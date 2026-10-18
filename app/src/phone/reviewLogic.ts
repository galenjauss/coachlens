import { ApiError, NetworkError, BadResponseError } from '../core/api'

export type Outcome = { kind: 'gone'; text: string } | { kind: 'error'; text: string }

/** Maps a failed review/student action to UI feedback. 404/409 mean someone already handled it. */
export function outcomeFor(e: unknown, verb = 'Action'): Outcome {
  // 2xx with an unreadable reply: the server did it. Never invite a retry (it would send twice).
  if (e instanceof BadResponseError) return { kind: 'gone', text: 'Done — list refreshed.' }
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

/** F17: urgent items first; otherwise the server's order is kept. Does not mutate. */
export function urgentFirst<T extends { urgent?: boolean }>(items: readonly T[]): T[] {
  return [...items.filter(i => i.urgent), ...items.filter(i => !i.urgent)]
}

type Candidate = { id: string; name: string; nickname: string | null; aliases: string[] }
/** F16: search the note's own class roster by name, nickname or learned alias. */
export function filterCandidates<T extends Candidate>(students: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...students]
  return students.filter(s => [s.name, s.nickname ?? '', ...s.aliases].some(v => v.toLowerCase().includes(q)))
}

/** Why the class roster for an unassigned note can't be shown (batch 2: 409 no_class = captured outside any class). */
export function candidatesError(e: unknown): { text: string; retry: boolean } {
  if (e instanceof ApiError && e.status === 409 && e.message === 'no_class') return { text: 'This note wasn’t captured in a class, so there is no class roster to pick from. Dismiss it, or record it again during class.', retry: false }
  if (e instanceof ApiError && e.status === 404) return { text: 'This note is gone. The list will refresh.', retry: false }
  return { text: `Couldn’t load this class’s roster. ${outcomeFor(e, 'Loading').text}`, retry: true }
}

/** "Signed out 2 other phones" (or that there were none). */
export function revokedNotice(n: number): string {
  if (n <= 0) return 'No other phones were signed in.'
  return `Signed out ${n} other ${n === 1 ? 'phone' : 'phones'}.`
}
