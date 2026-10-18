import { describe, it, expect } from 'vitest'
import { pcmToWav, toB64, fromB64 } from './wav'
import { Outbox } from './outbox'
import { memoryKV } from './storage'
import { ApiError, NetworkError } from './api'

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
})
