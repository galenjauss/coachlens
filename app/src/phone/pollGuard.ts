/**
 * At most one call in flight: while one is pending, further calls are skipped (return null). Used for
 * poll ticks — a slow first plan draft (15–30 s) must not start duplicate drafts every 15 s.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> | null {
  let pending = false
  return () => {
    if (pending) return null
    pending = true
    return fn().finally(() => { pending = false })
  }
}

/** Drops only out-of-order older responses: a response applies iff it is newer than the last applied one. */
export function createSeqGuard() {
  let issued = 0
  let lastApplied = 0
  return {
    next: () => ++issued,
    accept(n: number): boolean { if (n > lastApplied) { lastApplied = n; return true } return false },
  }
}
