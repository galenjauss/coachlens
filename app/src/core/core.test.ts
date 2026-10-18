import { describe, it, expect } from 'vitest'
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

describe('api bad responses', () => {
  const mk = (resp: Response) => createApi('http://x', async () => null, (() => Promise.resolve(resp)) as unknown as typeof fetch)
  it('maps a schema failure on 2xx to ApiError 502', async () => {
    const api = mk(new Response(JSON.stringify({ nope: 1 }), { status: 200 }))
    await expect(api.today()).rejects.toMatchObject({ status: 502, message: 'bad_response' })
  })
  it('maps a non-JSON 2xx to ApiError 502', async () => {
    const api = mk(new Response('<html>', { status: 200 }))
    await expect(api.today()).rejects.toMatchObject({ status: 502 })
  })
  it('survives a literal null error body', async () => {
    const api = mk(new Response('null', { status: 500 }))
    await expect(api.today()).rejects.toMatchObject({ status: 500 })
  })
})

describe('api.utteranceRuns', () => {
  const mk = (resp: Response, seen: string[] = []) => createApi('http://x', async () => null, ((url: string) => { seen.push(url); return Promise.resolve(resp) }) as unknown as typeof fetch)
  it('parses the runs list from GET /v1/utterances/:id/runs', async () => {
    const seen: string[] = []
    const runs = [{ agent: 'router', summary: 'sorted', status: 'ok', createdAt: '2026-10-20T00:00:00Z' }]
    await expect(mk(new Response(JSON.stringify(runs), { status: 200 }), seen).utteranceRuns('u 1')).resolves.toEqual(runs)
    expect(seen).toEqual(['http://x/v1/utterances/u%201/runs'])
  })
  it('404 (endpoint not deployed yet) → null; other errors throw; bad shape → 502', async () => {
    await expect(mk(new Response('{"error":"not_found"}', { status: 404 })).utteranceRuns('u')).resolves.toBeNull()
    await expect(mk(new Response('{}', { status: 500 })).utteranceRuns('u')).rejects.toMatchObject({ status: 500 })
    await expect(mk(new Response('[{"agent":1}]', { status: 200 })).utteranceRuns('u')).rejects.toMatchObject({ status: 502 })
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
  it('switchToPhone opens the phone mic once; bars() reflects arriving audio', async () => {
    const calls: unknown[][] = []
    const r = new Recorder({ audioControl: async (...a: unknown[]) => { calls.push(a); return true } })
    await r.start()
    expect(r.bars()).toBe(0)
    expect(await r.switchToPhone()).toBe(true)
    expect(await r.switchToPhone()).toBe(false)
    expect(r.source).toBe('phone')
    expect(calls).toEqual([[true, 'glasses'], [false], [true, 'phone']]) // glasses mic closed BEFORE the phone mic opens
    const loud = new Uint8Array(3200); const v = new DataView(loud.buffer)
    for (let i = 0; i < 1600; i++) v.setInt16(i * 2, i % 2 ? 4000 : -4000, true)
    r.push(loud)
    expect(r.bars()).toBe(5)
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
