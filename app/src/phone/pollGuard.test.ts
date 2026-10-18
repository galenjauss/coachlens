import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeqGuard, singleFlight } from './pollGuard'

describe('createSeqGuard', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('applies responses when latency (250ms) exceeds the poll interval (100ms)', async () => {
    const g = createSeqGuard()
    const applied: number[] = []
    const fetchIt = () => { const n = g.next(); return new Promise<void>(r => setTimeout(r, 250)).then(() => { if (g.accept(n)) applied.push(n) }) }
    const id = setInterval(fetchIt, 100)
    fetchIt()
    await vi.advanceTimersByTimeAsync(1000)
    clearInterval(id)
    expect(applied.length).toBeGreaterThan(3)
  })

  it('drops an older response that lands after a newer one', () => {
    const g = createSeqGuard()
    const a = g.next(), b = g.next()
    expect(g.accept(b)).toBe(true)
    expect(g.accept(a)).toBe(false)
  })
})

describe('singleFlight (usePoll in-flight guard)', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  it('a slow fetch (30 s) plus 3 poll ticks (every 15 s... here 5 s) → exactly 1 request in flight', async () => {
    let inFlight = 0, maxInFlight = 0, calls = 0
    const slow = () => { calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight); return new Promise<void>(r => setTimeout(() => { inFlight -= 1; r() }, 30_000)) }
    const guarded = singleFlight(slow)
    void guarded() // the initial load
    const id = setInterval(() => { void guarded() }, 5_000)
    await vi.advanceTimersByTimeAsync(15_000) // 3 ticks while the first is pending
    expect(calls).toBe(1)
    expect(maxInFlight).toBe(1)
    await vi.advanceTimersByTimeAsync(20_000) // first settles at 30 s; the next tick (35 s) may start one
    expect(calls).toBe(2)
    expect(maxInFlight).toBe(1)
    clearInterval(id)
  })
  it('frees the slot after a failure', async () => {
    const f = vi.fn(async () => { throw new Error('x') })
    const g = singleFlight(f)
    await g()?.catch(() => {})
    await g()?.catch(() => {})
    expect(f).toHaveBeenCalledTimes(2)
  })
})
