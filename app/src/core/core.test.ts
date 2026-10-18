import { describe, it, expect, vi } from 'vitest'
import { pcmToWav, toB64, fromB64 } from './wav'
import { Outbox } from './outbox'
import { memoryKV } from './storage'
import { ApiError, NetworkError, createApi } from './api'
import { Recorder } from './audio'

const form = { sessionId: 's', drillId: null, mode: 'note' as const, audioB64: null, text: 'hi' }
const res = (id: string) => ({ utteranceId: id, transcript: 'hi', cardLines: [], coverage: { covered: 0, present: 0 }, nextStudent: null, disambiguation: null })

describe('wav', () => {
  it('writes a 44-byte RIFF header for 16k mono s16le', () => {
    const wav = pcmToWav([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    const v = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint16(34, true)).toBe(16)
    expect(v.getUint32(40, true)).toBe(4)
    expect([...wav.slice(44)]).toEqual([1, 2, 3, 4])
  })
  it('base64 round-trips', () => {
    const u = new Uint8Array([0, 255, 7, 128])
    expect([...fromB64(toB64(u))]).toEqual([...u])
  })
})

describe('outbox', () => {
  it('persists, sends in order, and keeps items on network failure', async () => {
    const kv = memoryKV()
    const ob = new Outbox(kv)
    const a = await ob.enqueue(form)
    const b = await ob.enqueue({ ...form, text: 'two' })
    const r1 = await new Outbox(kv).flush(async () => { throw new NetworkError('offline') })
    expect(r1.remaining).toBe(2)
    const sent: string[] = []
    const r2 = await new Outbox(kv).flush(async i => { sent.push(i.id); return res(i.id) })
    expect(sent).toEqual([a.id, b.id])
    expect(r2.results.get(a.id)?.utteranceId).toBe(a.id)
    expect(r2.remaining).toBe(0)
  })
  it('a bad reply after a 2xx (BadResponseError) counts as DELIVERED: removed, never retried', async () => {
    const { BadResponseError } = await import('./api')
    const kv = memoryKV()
    const ob = new Outbox(kv)
    const a = await ob.enqueue(form)
    const b = await ob.enqueue({ ...form, text: 'two' })
    const calls: string[] = []
    const r = await ob.flush(async i => { calls.push(i.id); if (i.id === a.id) throw new BadResponseError(); return res(i.id) })
    expect(r.delivered.has(a.id)).toBe(true)
    expect(r.results.has(a.id)).toBe(false)
    expect(r.dropped.has(a.id)).toBe(false)
    expect(r.results.has(b.id)).toBe(true) // the queue carried on
    expect(r.remaining).toBe(0)
    await ob.flush(async i => { calls.push(i.id); return res(i.id) })
    expect(calls).toEqual([a.id, b.id]) // a was sent exactly once
  })
  it('drops items on 4xx and records the status', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    const r = await ob.flush(async () => { throw new ApiError(422, 'empty_transcript') })
    expect(r.dropped.get(a.id)).toBe(422)
    expect(r.remaining).toBe(0)
  })
  it('gives up after 5 server errors', async () => {
    const ob = new Outbox(memoryKV())
    await ob.enqueue(form)
    for (let i = 0; i < 5; i++) await ob.flush(async () => { throw new ApiError(500, 'x') })
    expect((await ob.list()).length).toBe(0)
  })
  it('keeps items on 429', async () => {
    const ob = new Outbox(memoryKV())
    await ob.enqueue(form)
    const r = await ob.flush(async () => { throw new ApiError(429, 'rate_limited') })
    expect(r.remaining).toBe(1)
    expect(r.dropped.size).toBe(0)
    expect((await ob.list())[0]!.attempts).toBe(1)
  })
  it('keeps items on 401', async () => {
    const ob = new Outbox(memoryKV())
    await ob.enqueue(form)
    const r = await ob.flush(async () => { throw new ApiError(401, 'unauthorized') })
    expect(r.remaining).toBe(1)
    expect(r.dropped.size).toBe(0)
  })
  it('keeps an item enqueued while a flush is awaiting a slow send', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const flushing = ob.flush(async i => { await gate; return res(i.id) })
    await new Promise(r => setTimeout(r, 5))
    const b = await ob.enqueue({ ...form, text: 'late' })
    release()
    const r = await flushing
    expect(r.results.has(a.id)).toBe(true)
    // b was not lost: the flush picked it up after the slow send (and removed it), never overwritten
    expect(r.results.has(b.id)).toBe(true)
    expect(await ob.list()).toEqual([])
    // and with a send that fails, an item enqueued mid-flush stays in the list
    const c = await ob.enqueue(form)
    let rel2!: () => void
    const g2 = new Promise<void>(r2 => { rel2 = r2 })
    const f2 = ob.flush(async () => { await g2; throw new NetworkError('offline') })
    await new Promise(r2 => setTimeout(r2, 5))
    const d = await ob.enqueue(form)
    rel2()
    await f2
    expect((await ob.list()).map(i => i.id)).toEqual([c.id, d.id])
  })
  it('keeps both of two concurrent enqueues, in call order', async () => {
    const ob = new Outbox(memoryKV())
    const [a, b] = await Promise.all([ob.enqueue(form), ob.enqueue({ ...form, text: 'two' })])
    expect((await ob.list()).map(i => i.id)).toEqual([a.id, b.id])
  })
  it('drops a poison item after 5 unknown errors and proceeds to the next', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    const b = await ob.enqueue({ ...form, text: 'two' })
    for (let i = 0; i < 5; i++) await ob.flush(async () => { throw new Error('zod blew up') })
    expect((await ob.list()).map(i => i.id)).toEqual([b.id])
    const r = await ob.flush(async i => res(i.id))
    expect(r.results.has(b.id)).toBe(true)
    expect(a.id).not.toBe(b.id)
  })
})

describe('outbox persistence failure', () => {
  it('still returns results when kv.set throws while removing after a successful send', async () => {
    const inner = memoryKV()
    let fail = false
    const kv = { get: inner.get, set: async (k: string, v: string) => { if (fail) { fail = false; throw new Error('disk full') } return inner.set(k, v) } }
    const ob = new Outbox(kv)
    const a = await ob.enqueue(form)
    fail = true
    const r = await ob.flush(async i => res(i.id))
    expect(r.results.get(a.id)?.utteranceId).toBe(a.id)
    expect(r.remaining).toBe(1)
  })
})

const JSON_HDR = { 'content-type': 'application/json; charset=utf-8' }

describe('api bad responses', () => {
  const mk = (resp: Response) => createApi('http://x', async () => null, (() => Promise.resolve(resp)) as unknown as typeof fetch)
  it('maps a schema failure on 2xx to ApiError 502', async () => {
    const api = mk(new Response(JSON.stringify({ nope: 1 }), { status: 200, headers: JSON_HDR }))
    await expect(api.today()).rejects.toMatchObject({ status: 502, message: 'bad_response' })
  })
  it('a non-JSON 2xx (captive-portal HTML, empty, wrong content-type) is a retryable NetworkError, never "delivered"', async () => {
    const { NonJsonResponseError, BadResponseError } = await import('./api')
    const cases = [
      new Response('<html>Sign in to Wi-Fi</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      new Response('', { status: 200, headers: JSON_HDR }),
      new Response('<html>', { status: 200, headers: JSON_HDR }), // claims JSON, isn't
      new Response('{"nope":1}', { status: 200, headers: { 'content-type': 'text/html' } }), // JSON-ish body from a proxy page
    ]
    for (const r of cases) {
      const e = await mk(r).today().catch(x => x)
      expect(e).toBeInstanceOf(NonJsonResponseError)
      expect(e).toBeInstanceOf(NetworkError)
      expect(e).not.toBeInstanceOf(BadResponseError)
    }
  })
  it('the outbox keeps a note whose reply was captive-portal HTML (not delivered, not dropped, not counted)', async () => {
    const kv = memoryKV()
    const ob = new Outbox(kv)
    const a = await ob.enqueue(form)
    const api = mk(new Response('<html>portal</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    const r = await ob.flush(i => api.utterance({ sessionId: i.form.sessionId, drillId: i.form.drillId, mode: i.form.mode, text: i.form.text, audio: null }))
    expect(r.delivered.has(a.id)).toBe(false)
    expect(r.dropped.has(a.id)).toBe(false)
    expect((await ob.list()).map(i => [i.id, i.attempts])).toEqual([[a.id, 0]])
  })
  it('a JSON 2xx with the wrong shape is still BadResponseError (delivered): the outbox removes it', async () => {
    const ob = new Outbox(memoryKV())
    const a = await ob.enqueue(form)
    const api = mk(new Response('{"nope":1}', { status: 200, headers: JSON_HDR }))
    const r = await ob.flush(i => api.utterance({ sessionId: i.form.sessionId, drillId: i.form.drillId, mode: i.form.mode, text: i.form.text, audio: null }))
    expect(r.delivered.has(a.id)).toBe(true)
    expect(await ob.list()).toEqual([])
  })
  it('survives a literal null error body', async () => {
    const api = mk(new Response('null', { status: 500 }))
    await expect(api.today()).rejects.toMatchObject({ status: 500 })
  })
})

describe('api insights', () => {
  const mk = (body: unknown, seen: { url: string; method: string }[]) => createApi('http://x', async () => null, ((url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? 'GET' })
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: JSON_HDR }))
  }) as unknown as typeof fetch)
  const item = { id: 'i1', kind: 'returning_student', studentId: 's1', studentName: 'Jake Ross', classId: 'c1', title: "Jake's back after 3 missed", detail: 'Missed 3 classes in a row', urgency: 'high', status: 'new', createdAt: '2026-10-20T00:00:00Z', actionLabel: 'Draft welcome email' }
  it('GET /v1/insights builds the query from the set params only', async () => {
    const seen: { url: string; method: string }[] = []
    await expect(mk({ insights: [item] }, seen).insights({ scope: 'class', sessionId: 'se 1' })).resolves.toEqual({ insights: [item] })
    await mk({ insights: [] }, seen).insights()
    expect(seen.map(s => s.url)).toEqual(['http://x/v1/insights?scope=class&sessionId=se+1', 'http://x/v1/insights'])
  })
  it('accept and dismiss POST to the insight', async () => {
    const seen: { url: string; method: string }[] = []
    await expect(mk({ ok: true, outcome: 'Email drafted for review' }, seen).acceptInsight('i/1')).resolves.toEqual({ ok: true, outcome: 'Email drafted for review' })
    await expect(mk({ ok: true }, seen).dismissInsight('i1')).resolves.toEqual({ ok: true })
    expect(seen).toEqual([{ url: 'http://x/v1/insights/i%2F1/accept', method: 'POST' }, { url: 'http://x/v1/insights/i1/dismiss', method: 'POST' }])
  })
})

describe('api.utteranceRuns', () => {
  const mk = (resp: Response, seen: string[] = []) => createApi('http://x', async () => null, ((url: string) => { seen.push(url); return Promise.resolve(resp) }) as unknown as typeof fetch)
  it('parses the runs list from GET /v1/utterances/:id/runs', async () => {
    const seen: string[] = []
    const runs = [{ agent: 'router', summary: 'sorted', status: 'ok', createdAt: '2026-10-20T00:00:00Z' }]
    await expect(mk(new Response(JSON.stringify(runs), { status: 200, headers: JSON_HDR }), seen).utteranceRuns('u 1')).resolves.toEqual(runs)
    expect(seen).toEqual(['http://x/v1/utterances/u%201/runs'])
  })
  it('404 (endpoint not deployed yet) → null; other errors throw; bad shape → 502', async () => {
    await expect(mk(new Response('{"error":"not_found"}', { status: 404 })).utteranceRuns('u')).resolves.toBeNull()
    await expect(mk(new Response('{}', { status: 500 })).utteranceRuns('u')).rejects.toMatchObject({ status: 500 })
    await expect(mk(new Response('[{"agent":1}]', { status: 200, headers: JSON_HDR })).utteranceRuns('u')).rejects.toMatchObject({ status: 502 })
  })
})

describe('recorder', () => {
  it('resets recording when audioControl rejects, and start rejects', async () => {
    const r = new Recorder({ audioControl: async () => { throw new Error('bt down') } })
    await expect(r.start()).rejects.toThrow('bt down')
    expect(r.recording).toBe(false)
  })
  it('resets recording when audioControl returns false', async () => {
    const r = new Recorder({ audioControl: async () => false })
    await expect(r.start()).rejects.toThrow()
    expect(r.recording).toBe(false)
  })
  it('start while recording is a no-op and keeps chunks', async () => {
    const r = new Recorder({ audioControl: async () => true })
    await r.start()
    r.push(new Uint8Array([1, 2]))
    await r.start()
    r.push(new Uint8Array([3, 4]))
    const big = new Uint8Array(16000 * 2)
    r.push(big)
    const res = await r.stop()
    expect([...res.wav!.slice(44, 48)]).toEqual([1, 2, 3, 4])
  })
  it('after the switch: fresh buffer, late glasses chunks dropped, phone chunks kept (sources never mix)', async () => {
    const r = new Recorder({ audioControl: async () => true })
    await r.start()
    r.push(new Uint8Array([9, 9]), 'glasses')
    r.push(new Uint8Array([8, 8]), 'phone') // wrong source before the switch: dropped
    expect(r.bytes).toBe(2)
    await r.switchToPhone()
    expect(r.bytes).toBe(0)
    r.push(new Uint8Array(100), 'glasses') // late glasses chunk: ignored
    expect(r.bytes).toBe(0)
    const phone = new Uint8Array(16000 * 2); phone[0] = 7
    r.push(phone, 'phone')
    const res = await r.stop()
    expect(res.bytes).toBe(32000)
    expect(res.wav![44]).toBe(7) // the WAV starts with phone audio, no glasses bytes
  })
  it('if the phone mic is refused, the glasses mic is re-opened and nothing is switched', async () => {
    const calls: unknown[][] = []
    const r = new Recorder({ audioControl: async (...a: unknown[]) => { calls.push(a); return a[1] !== 'phone' } })
    await r.start()
    expect(await r.switchToPhone()).toBe(false)
    expect(r.source).toBe('glasses')
    expect(calls).toEqual([[true, 'glasses'], [false], [true, 'phone'], [true, 'glasses']])
  })
  it('stop says why nothing is sent: no_audio (0 bytes) vs too_short (< 0.4 s)', async () => {
    const r = new Recorder({ audioControl: async () => true })
    await r.start()
    expect(await r.stop()).toEqual({ wav: null, bytes: 0, reason: 'no_audio' })
    await r.start()
    r.push(new Uint8Array(1000))
    expect(await r.stop()).toEqual({ wav: null, bytes: 1000, reason: 'too_short' })
  })
  it('switchToPhone opens the phone mic once; bytes reflect arriving audio', async () => {
    const calls: unknown[][] = []
    const r = new Recorder({ audioControl: async (...a: unknown[]) => { calls.push(a); return true } })
    await r.start()
    expect(r.bytes).toBe(0)
    expect(await r.switchToPhone()).toBe(true)
    expect(await r.switchToPhone()).toBe(false)
    expect(r.source).toBe('phone')
    expect(calls).toEqual([[true, 'glasses'], [false], [true, 'phone']]) // glasses mic closed BEFORE the phone mic opens
    r.push(new Uint8Array(3200))
    expect(r.bytes).toBe(3200)
  })
})

describe('imu readout flag (KV)', () => {
  it('?imu=1/0 wins and is saved; otherwise the saved value; write saves and tells the bus', async () => {
    const { readImuDebug, writeImuDebug, IMU_DEBUG_KEY } = await import('./imuDebug')
    const { memoryKV } = await import('./storage')
    const { bus } = await import('./bus')
    const kv = memoryKV()
    expect(await readImuDebug(kv, '')).toBe(false)
    expect(await readImuDebug(kv, '?imu=1')).toBe(true)
    expect(await readImuDebug(kv, '')).toBe(true)
    expect(await readImuDebug(kv, '?imu=0')).toBe(false)
    const seen: boolean[] = []
    const off = bus.on('imuDebug', on => seen.push(on))
    try { await writeImuDebug(kv, true) } finally { off() }
    expect(await kv.get(IMU_DEBUG_KEY)).toBe('1')
    expect(seen).toEqual([true])
  })
})

describe('api errors', () => {
  it('schema failure on a 2xx is a BadResponseError (ApiError 502, delivered)', async () => {
    const { BadResponseError } = await import('./api')
    const api = createApi('http://x', async () => null, (() => Promise.resolve(new Response('{"nope":1}', { status: 200, headers: JSON_HDR }))) as unknown as typeof fetch)
    const e = await api.today().catch(x => x)
    expect(e).toBeInstanceOf(BadResponseError)
    expect(e).toMatchObject({ status: 502, delivered: true })
  })
  it('401 tells the app to re-pair (bus unauthorized), except on /pair itself', async () => {
    const { bus } = await import('./bus')
    const seen: number[] = []
    const off = bus.on('unauthorized', () => seen.push(1))
    try {
      const api = createApi('http://x', async () => 't', (() => Promise.resolve(new Response('{"error":"bad token"}', { status: 401 }))) as unknown as typeof fetch)
      await expect(api.today()).rejects.toMatchObject({ status: 401 })
      expect(seen).toHaveLength(1)
      await expect(api.pair('000000')).rejects.toMatchObject({ status: 401 })
      expect(seen).toHaveLength(1)
    } finally { off() }
  })
  it('a request that never answers fails with NetworkError("timeout") instead of loading forever', async () => {
    vi.useFakeTimers()
    try {
      const { REQUEST_TIMEOUT_MS } = await import('./api')
      const hang = ((_u: string, init: RequestInit) => new Promise((_r, rej) => { init.signal?.addEventListener('abort', () => rej(new Error('aborted'))) })) as unknown as typeof fetch
      const p = createApi('http://x', async () => null, hang).today().catch(e => e)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      const e = await p
      expect(e).toBeInstanceOf(NetworkError)
      expect(e.message).toBe('timeout')
    } finally { vi.useRealTimers() }
  })
})

describe('selectMic (dual-mic pick on stop)', () => {
  it('glasses when they have ≥ 0.4 s, else phone; glasses again when the phone has nothing', async () => {
    const { selectMic, MIN_BYTES } = await import('./audio')
    expect(selectMic(MIN_BYTES, 99_999)).toBe('glasses')
    expect(selectMic(MIN_BYTES + 1, 0)).toBe('glasses')
    expect(selectMic(MIN_BYTES - 1, 1)).toBe('phone')
    expect(selectMic(0, 50_000)).toBe('phone')
    expect(selectMic(100, 0)).toBe('glasses') // too short either way: the glasses reason stays
    expect(selectMic(0, 0)).toBe('glasses')
  })

  it('dual recorder buffers both sources and releases both mics', async () => {
    const calls: unknown[][] = []
    const r = new Recorder({ audioControl: async (...a: unknown[]) => { calls.push(a); return true } }, { dual: true })
    await r.start()
    r.push(new Uint8Array(100).fill(1), 'glasses')
    r.push(new Uint8Array(20_000).fill(2), 'phone')
    expect([r.bytesFrom('glasses'), r.bytesFrom('phone'), r.bytes]).toEqual([100, 20_000, 20_100])
    const out = await r.stop()
    expect(r.source).toBe('phone')
    expect(out.wav?.[44]).toBe(2)
    expect(calls).toEqual([[true, 'glasses'], [true, 'phone'], [false, 'glasses'], [false, 'phone'], [false]])
  })

  it('dual recorder still records when only one mic opens; fails when neither does', async () => {
    const glassesOnly = new Recorder({ audioControl: async (on: boolean, src?: string) => !(on && src === 'phone') }, { dual: true })
    await glassesOnly.start()
    expect(glassesOnly.recording).toBe(true)
    const none = new Recorder({ audioControl: async (on: boolean) => !on }, { dual: true })
    await expect(none.start()).rejects.toThrow('mic unavailable')
    expect(none.recording).toBe(false)
  })
})

describe('outbox count + change events', () => {
  it('count() and outboxChanged follow enqueue, delivery and drops', async () => {
    const { bus } = await import('./bus')
    const { knownOutboxCount } = await import('./outbox')
    const seen: number[] = []
    const off = bus.on('outboxChanged', n => seen.push(n))
    try {
      const o = new Outbox(memoryKV())
      expect(await o.count()).toBe(0)
      await o.enqueue(form)
      await o.enqueue(form)
      expect(await o.count()).toBe(2)
      expect(knownOutboxCount()).toBe(2)
      let first = true
      await o.flush(async i => { if (first) { first = false; throw new ApiError(400, 'bad') } return res(i.id) })
      expect(await o.count()).toBe(0)
      expect(seen).toEqual([1, 2, 1, 0])
      expect(knownOutboxCount()).toBe(0)
    } finally { off() }
  })

  it('an offline flush keeps the items and announces nothing', async () => {
    const { bus } = await import('./bus')
    const o = new Outbox(memoryKV())
    await o.enqueue(form)
    const seen: number[] = []
    const off = bus.on('outboxChanged', n => seen.push(n))
    try {
      await o.flush(async () => { throw new NetworkError('offline') })
      expect(await o.count()).toBe(1)
      expect(seen).toEqual([])
    } finally { off() }
  })
})

describe('outbox hold + swap (transcript-first)', () => {
  it('a held head is not sent by a concurrent flush, and holds back the items behind it (order kept)', async () => {
    const o = new Outbox(memoryKV())
    const held = await o.enqueue(form, { holdUntil: Date.now() + 60_000 })
    await o.enqueue(form)
    const send = vi.fn(async (i: { id: string }) => res(i.id))
    const r = await o.flush(send)
    expect(send).not.toHaveBeenCalled()
    expect(r.remaining).toBe(2)
    expect((await o.list())[0]).toMatchObject({ id: held.id, holdUntil: expect.any(Number) })
  })

  it('an expired hold is sent (e.g. after a kill and restart)', async () => {
    const o = new Outbox(memoryKV())
    const item = await o.enqueue(form, { holdUntil: Date.now() - 1 })
    const r = await o.flush(async i => res(i.id))
    expect([...r.results.keys()]).toEqual([item.id])
    expect(await o.count()).toBe(0)
  })

  it('swap replaces the form and releases the hold; unhold just releases; both are false once the item is gone', async () => {
    const o = new Outbox(memoryKV())
    const audio = { ...form, audioB64: 'AAAA', text: null }
    const a = await o.enqueue(audio, { holdUntil: Date.now() + 60_000 })
    const b = await o.enqueue(audio, { holdUntil: Date.now() + 60_000 })
    expect(await o.swap(a.id, { ...audio, audioB64: null, text: 'Priya guard up' })).toBe(true)
    expect(await o.unhold(b.id)).toBe(true)
    const [x, y] = await o.list()
    expect(x).toEqual({ id: a.id, createdAt: a.createdAt, attempts: 0, form: { ...audio, audioB64: null, text: 'Priya guard up' } })
    expect(y).toEqual({ id: b.id, createdAt: b.createdAt, attempts: 0, form: audio })
    const sent: (string | null)[] = []
    await o.flush(async i => { sent.push(i.form.text); return res(i.id) })
    expect(sent).toEqual(['Priya guard up', null])
    expect(await o.swap(a.id, form)).toBe(false)
    expect(await o.unhold(b.id)).toBe(false)
    expect(await o.drop(a.id)).toBe(false)
    expect(await o.count()).toBe(0)
  })
})

describe('dual recorder with untagged audio', () => {
  it('closes the phone mic on the first untagged chunk and records from the glasses only', async () => {
    const calls: unknown[][] = []
    const r = new Recorder({ audioControl: async (...a: unknown[]) => { calls.push(a); return true } }, { dual: true })
    await r.start()
    r.push(new Uint8Array(500).fill(9), 'phone')
    r.push(new Uint8Array(20_000).fill(1)) // untagged
    r.push(new Uint8Array(20_000).fill(9), 'phone') // ignored: the phone mic is closed
    expect(calls).toContainEqual([false, 'phone'])
    expect([r.bytesFrom('glasses'), r.bytesFrom('phone')]).toEqual([20_000, 0])
    const out = await r.stop()
    expect(r.source).toBe('glasses')
    expect(out.wav?.[44]).toBe(1)
    expect(calls.slice(-2)).toEqual([[false, 'glasses'], [false]]) // the phone is not closed twice
  })
})

describe('api plan sources and voice plan', () => {
  it('replaceDeck posts the source and parses the Deck; voicePlan parses the lens summary', async () => {
    const calls: { url: string; body: string }[] = []
    const reply = (body: unknown) => ((url: string, init: RequestInit) => { calls.push({ url, body: String(init.body) }); return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: JSON_HDR })) }) as unknown as typeof fetch
    const deck = { id: 'd', classId: 'c', forDate: '2026-10-19', status: 'draft', isStarter: false, drills: [] }
    await expect(createApi('http://x', async () => null, reply(deck)).replaceDeck('d', { deckId: 'o' })).resolves.toMatchObject({ id: 'd' })
    expect(calls[0]).toEqual({ url: 'http://x/v1/decks/d/replace', body: '{"source":{"deckId":"o"}}' })
    const vp = { diffId: 'x', deckId: 'd', lines: ['+ Sparring 6m'] }
    await expect(createApi('http://x', async () => null, reply(vp)).voicePlan('c', 'cut kata')).resolves.toEqual(vp)
    expect(calls[1]).toEqual({ url: 'http://x/v1/plan/voice', body: '{"classId":"c","transcript":"cut kata"}' })
  })
})

describe('api token read', () => {
  it('a token read that never answers goes out without auth after TOKEN_READ_TIMEOUT_MS (401 → pair), never hangs', async () => {
    vi.useFakeTimers()
    try {
      const { TOKEN_READ_TIMEOUT_MS } = await import('./api')
      const seen: (string | null)[] = []
      const api = createApi('http://x', () => new Promise<string | null>(() => {}), ((_u: string, init: RequestInit) => {
        seen.push(new Headers(init.headers).get('Authorization'))
        return Promise.resolve(new Response('{"error":"missing token"}', { status: 401 }))
      }) as unknown as typeof fetch)
      const p = api.today().catch(e => e)
      await vi.advanceTimersByTimeAsync(TOKEN_READ_TIMEOUT_MS)
      const err = await p
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).status).toBe(401)
      expect(seen).toEqual([null])
    } finally { vi.useRealTimers() }
  })
  it('a token read that fails counts as no token', async () => {
    const seen: (string | null)[] = []
    const api = createApi('http://x', async () => { throw new Error('storage down') }, ((_u: string, init: RequestInit) => {
      seen.push(new Headers(init.headers).get('Authorization'))
      return Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))
    }) as unknown as typeof fetch)
    await expect(api.health()).resolves.toEqual({ ok: true })
    expect(seen).toEqual([null])
  })
})
