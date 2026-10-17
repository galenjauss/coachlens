// Per-instance fixed window. Good enough for one instructor; Fluid Compute reuses instances.
const hits = new Map<string, { n: number; reset: number }>()
export function allow(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const h = hits.get(key)
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true }
  h.n++
  return h.n <= limit
}
