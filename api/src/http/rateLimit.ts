// Per-instance fixed window. Good enough for one instructor; Fluid Compute reuses instances.
const hits = new Map<string, { n: number; reset: number }>()
export function allow(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const h = hits.get(key)
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true }
  h.n++
  return h.n <= limit
}

export function resetRateLimits(): void { hits.clear() }

// Failure-only counters: check with isBlocked, bump with recordFailure.
export function isBlocked(key: string, limit: number, now = Date.now()): boolean {
  const h = hits.get(key)
  return !!h && h.reset >= now && h.n >= limit
}
export function recordFailure(key: string, windowMs: number, now = Date.now()): void {
  const h = hits.get(key)
  if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs })
  else h.n++
}
