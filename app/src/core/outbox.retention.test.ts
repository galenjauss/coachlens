import { describe, expect, it, vi } from 'vitest'
import { ApiError, NetworkError } from './api'
import { bus } from './bus'
import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, Outbox, backoffMs, retryText } from './outbox'
import { memoryKV } from './storage'

const form = { sessionId: 's', drillId: null, mode: 'note' as const, audioB64: null, text: 'Priya guard up' }
const res = (id: string) => ({ utteranceId: id, transcript: 'hi', cardLines: [], coverage: { covered: 0, present: 0 }, nextStudent: null, disambiguation: null })
const clock = () => { const c = { t: 1_000_000, now: () => c.t }; return c }

describe('F07 · the outbox never silently drops a queued note', () => {
  it('audit repro: five HTTP 429 responses leave the item retained (none dropped, none failed)', async () => {
    const c = clock()
    const ob = new Outbox(memoryKV(), c.now)
    const a = await ob.enqueue(form)
    for (let i = 0; i < 5; i++) {
      const r = await ob.flush(async () => { throw new ApiError(429, 'rate_limited') })
      expect(r.retrying.get(a.id)).toBe('rate_limited')
      expect(r.failed.size).toBe(0)
      c.t += MAX_BACKOFF_MS + 1
    }
    const [kept] = await ob.list()
    expect(kept).toMatchObject({ id: a.id, attempts: 5, lastError: 'rate_limited' })
    expect(await ob.failed()).toEqual([])
  })

  it('every temporary failure keeps the item: 5xx, network, 401, 409 in_progress', async () => {
    const c = clock()
    for (const [err, why] of [[new ApiError(503, 'x'), 'server'], [new NetworkError('offline'), 'offline'], [new ApiError(401, 'unauthorized'), 'unpaired'], [new ApiError(409, 'in_progress'), 'in_progress']] as const) {
      const ob = new Outbox(memoryKV(), c.now)
      const a = await ob.enqueue(form)
      for (let i = 0; i < 8; i++) { await ob.flush(async () => { throw err }); c.t += MAX_BACKOFF_MS + 1 }
      expect((await ob.list()).map(x => x.id)).toEqual([a.id])
      expect((await ob.list())[0]!.lastError).toBe(why)
    }
  })

  it('respects Retry-After: the head waits until then, and a flush before that sends nothing', async () => {
    const c = clock()
    const ob = new Outbox(memoryKV(), c.now)
    await ob.enqueue(form)
    const e = new ApiError(429, 'rate_limited', 30_000)
    await ob.flush(async () => { throw e })
    expect((await ob.list())[0]!.nextAttemptAt).toBe(c.t + 30_000)
    let calls = 0
    c.t += 29_000
    const early = await ob.flush(async i => { calls++; return res(i.id) })
    expect(calls).toBe(0)
    expect(early.remaining).toBe(1)
    c.t += 1_001
    const late = await ob.flush(async i => { calls++; return res(i.id) })
    expect(calls).toBe(1)
    expect(late.remaining).toBe(0)
  })

  it('backs off exponentially (2 s, 4 s, 8 s …, capped) without Retry-After; network failures are not counted', async () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([BASE_BACKOFF_MS, BASE_BACKOFF_MS * 2, BASE_BACKOFF_MS * 4, BASE_BACKOFF_MS * 8])
    expect(backoffMs(30)).toBe(MAX_BACKOFF_MS)
    const c = clock()
    const ob = new Outbox(memoryKV(), c.now)
    await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(500, 'x') })
    expect((await ob.list())[0]!.nextAttemptAt).toBe(c.t + BASE_BACKOFF_MS)
    c.t += BASE_BACKOFF_MS
    await ob.flush(async () => { throw new ApiError(500, 'x') })
    expect((await ob.list())[0]!.nextAttemptAt).toBe(c.t + BASE_BACKOFF_MS * 2)
    const ob2 = new Outbox(memoryKV(), c.now)
    await ob2.enqueue(form)
    await ob2.flush(async () => { throw new NetworkError('offline') })
    expect((await ob2.list())[0]).toMatchObject({ attempts: 0, lastError: 'offline' })
    expect((await ob2.list())[0]!.nextAttemptAt).toBeUndefined()
  })

  it("a forced flush (the coach's Retry) ignores the backoff", async () => {
    const c = clock()
    const ob = new Outbox(memoryKV(), c.now)
    const a = await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(429, 'x', 60_000) })
    const r = await ob.flush(async i => res(i.id), { force: true })
    expect(r.results.has(a.id)).toBe(true)
  })

  it('only permanent invalid input (400/413/422) goes to the failed store, with its reason; the queue carries on', async () => {
    for (const [status, reason] of [[400, /rejected/], [413, /too large/], [422, /rejected this note/]] as const) {
      const ob = new Outbox(memoryKV())
      const a = await ob.enqueue(form)
      const b = await ob.enqueue({ ...form, text: 'two' })
      const r = await ob.flush(async i => { if (i.id === a.id) throw new ApiError(status, 'validation'); return res(i.id) })
      expect(r.failed.get(a.id)?.reason).toMatch(reason)
      expect(r.results.has(b.id)).toBe(true)
      const [f] = await ob.failed()
      expect(f).toMatchObject({ id: a.id, form: { text: 'Priya guard up' }, failure: { status } })
    }
  })

  it('a 409 that is not in_progress is not retried forever: failed store (kept)', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    const r = await ob.flush(async () => { throw new ApiError(409, 'session_ended') })
    expect(r.failed.has(a.id)).toBe(true)
    expect((await ob.failed()).length).toBe(1)
  })

  it('a C1 replay (same opId already done on the server) is a success: the item leaves the queue', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(409, 'in_progress') }, { force: true })
    const r = await ob.flush(async i => res(i.id), { force: true }) // the stored response, Idempotent-Replay: true
    expect(r.results.get(a.id)?.utteranceId).toBe(a.id)
    expect(r.remaining).toBe(0)
  })

  it('retryFailed puts a failed note back (same id = same idempotency key); discardFailed is the only delete; counts are announced', async () => {
    const counts: number[] = []
    const off = bus.on('outboxFailedChanged', n => counts.push(n))
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(400, 'bad') })
    expect(await ob.retryFailed(a.id)).toBe(true)
    expect((await ob.list()).map(i => i.id)).toEqual([a.id])
    await ob.flush(async () => { throw new ApiError(400, 'bad') })
    expect(await ob.discardFailed(a.id)).toBe(true)
    expect(await ob.failed()).toEqual([])
    expect(await ob.retryFailed(a.id)).toBe(false)
    off()
    expect(counts).toEqual([1, 0, 1, 0])
  })

  it('reason text names the real failure, never "didn\'t catch that"', () => {
    for (const r of ['offline', 'rate_limited', 'server', 'unpaired', 'in_progress', 'app_error'] as const) expect(retryText(r)).not.toMatch(/catch/i)
    expect(retryText('rate_limited')).toMatch(/busy/i)
  })
})

describe('review round 1 · storage budget (#1) and re-pair (#7)', () => {
  it('a transcript replaces the audio; a note with both never stores the audio', async () => {
    const kv = memoryKV()
    const ob = new Outbox(kv)
    const a = await ob.enqueue({ ...form, text: null, audioB64: 'A'.repeat(5000) })
    expect((await kv.get('matside.outbox'))!.length).toBeGreaterThan(5000)
    await ob.swap(a.id, { ...form, text: 'heard', audioB64: 'A'.repeat(5000) })
    expect((await ob.list())[0]!.form).toMatchObject({ text: 'heard', audioB64: null })
    expect((await kv.get('matside.outbox'))!.length).toBeLessThan(1000)
  })

  it('over budget, enqueue rejects with OutboxFullError and writes nothing; usage is announced for the 70% warning', async () => {
    const { OutboxFullError } = await import('./outbox')
    const usages: number[] = []
    const off = bus.on('outboxUsage', u => usages.push(u.fraction))
    const ob = new Outbox(memoryKV(), Date.now, 10_000)
    await ob.enqueue({ ...form, text: null, audioB64: 'A'.repeat(7_000) })
    expect(usages.at(-1)).toBeGreaterThan(0.7)
    expect(await ob.wouldOverflow(3_000)).toBe(true)
    await expect(ob.enqueue({ ...form, text: null, audioB64: 'B'.repeat(7_000) })).rejects.toBeInstanceOf(OutboxFullError)
    expect(await ob.count()).toBe(1) // the stored note is untouched; nothing was evicted
    await expect(ob.enqueue({ ...form, text: 'short text note' })).resolves.toBeDefined() // small text notes still fit
    off()
  })

  it('a failed note keeps only its transcript when it has one; Discard is the only thing that frees its space', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue({ ...form, text: null, audioB64: 'A'.repeat(2000) })
    await ob.flush(async () => { throw new ApiError(413, 'too_large') })
    expect((await ob.failed())[0]!.form.audioB64).toBe('A'.repeat(2000)) // no transcript: the audio is the note, kept
    expect(await ob.discardFailed(a.id)).toBe(true)
    expect((await ob.usage()).bytes).toBeLessThan(100)
  })

  it('an offline retry with nothing new does not rewrite the queue', async () => {
    const writes: string[] = []
    const base = memoryKV()
    const kv = { get: base.get, set: async (k: string, v: string) => { writes.push(k); await base.set(k, v) } }
    const ob = new Outbox(kv)
    await ob.enqueue(form)
    await ob.flush(async () => { throw new NetworkError('offline') })
    const n = writes.length
    await ob.flush(async () => { throw new NetworkError('offline') })
    expect(writes.length).toBe(n)
  })

  it('resetBackoff clears every wait (after re-pairing), so the next flush sends at once', async () => {
    const c = clock()
    const ob = new Outbox(memoryKV(), c.now)
    await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(401, 'unauthorized') })
    await ob.flush(async () => { throw new ApiError(401, 'unauthorized') })
    expect((await ob.list())[0]!.nextAttemptAt).toBeGreaterThan(c.t)
    expect(await ob.resetBackoff()).toBe(1)
    const r = await ob.flush(async i => res(i.id))
    expect(r.remaining).toBe(0)
  })
})

describe('review round 1 · #6 phone-only Retry', () => {
  it('without a lens, outboxRetry flushes the outbox (forced) with the item id as the idempotency key', async () => {
    const { wirePhoneOnlyRetry } = await import('./sendItem')
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    await ob.flush(async () => { throw new ApiError(429, 'x', 60_000) })
    const utterance = vi.fn(async (_p: unknown, o: { opId?: string }) => res(o.opId!))
    const off = wirePhoneOnlyRetry(ob, { utterance } as never)
    bus.emit('outboxRetry', undefined)
    await vi.waitFor(async () => expect(await ob.count()).toBe(0))
    expect(utterance.mock.calls[0]![1]).toEqual({ opId: a.id })
    off()
  })
})
