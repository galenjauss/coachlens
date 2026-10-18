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
    const wav = await r.stop()
    expect([...wav!.slice(44, 48)]).toEqual([1, 2, 3, 4])
  })
})
