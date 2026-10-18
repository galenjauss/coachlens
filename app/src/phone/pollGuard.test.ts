import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSeqGuard } from './pollGuard'

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
