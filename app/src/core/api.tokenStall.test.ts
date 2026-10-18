// E2E regression (batch 5): in the simulator, a bridge-storage token read stalled past TOKEN_READ_TIMEOUT_MS while the
// glasses streamed roll-call audio. The request went out without auth, got a 401, the app treated that as "token
// revoked" and wiped a valid token: every later note failed with 401 and the phone fell back to Pairing.
import { describe, it, expect, vi } from 'vitest'
import { createApi, TOKEN_READ_TIMEOUT_MS } from './api'
import { bus } from './bus'

const ok = () => Promise.resolve(new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }))

describe('token read stalls', () => {
  it('a stalled read reuses the last token this client read', async () => {
    vi.useFakeTimers()
    try {
      let stall = false
      const seen: (string | null)[] = []
      const api = createApi('http://x', () => (stall ? new Promise<string | null>(() => {}) : Promise.resolve('tok')), ((_u: string, init: RequestInit) => {
        seen.push(new Headers(init.headers).get('Authorization')); return ok()
      }) as unknown as typeof fetch)
      await api.health()
      stall = true
      const p = api.health()
      await vi.advanceTimersByTimeAsync(TOKEN_READ_TIMEOUT_MS)
      await p
      expect(seen).toEqual(['Bearer tok', 'Bearer tok'])
    } finally { vi.useRealTimers() }
  })

  it('a 401 for a request whose token could not be read does not tell the app to re-pair', async () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const off = bus.on('unauthorized', () => seen.push(1))
    try {
      const api = createApi('http://x', () => new Promise<string | null>(() => {}), (() => Promise.resolve(new Response('{"error":"missing token"}', { status: 401 }))) as unknown as typeof fetch)
      const p = api.today().catch(e => e)
      await vi.advanceTimersByTimeAsync(TOKEN_READ_TIMEOUT_MS)
      expect(await p).toMatchObject({ status: 401 })
      expect(seen).toEqual([])
    } finally { off(); vi.useRealTimers() }
  })

  it('a 401 for a cached token (read stalled) does not wipe the stored token, which a re-pair may have replaced', async () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const off = bus.on('unauthorized', () => seen.push(1))
    try {
      let stall = false
      const api = createApi('http://x', () => (stall ? new Promise<string | null>(() => {}) : Promise.resolve('old')), ((_u: string, init: RequestInit) =>
        Promise.resolve(new Headers(init.headers).get('Authorization') ? new Response('{"error":"bad token"}', { status: 401 }) : new Response('{}', { status: 200 }))) as unknown as typeof fetch)
      await expect(api.today()).rejects.toMatchObject({ status: 401 })
      expect(seen).toEqual([1]) // read fresh and rejected: re-pair
      stall = true
      const p = api.today().catch(e => e)
      await vi.advanceTimersByTimeAsync(TOKEN_READ_TIMEOUT_MS)
      expect(await p).toMatchObject({ status: 401 })
      expect(seen).toEqual([1]) // the cached token's 401 does not trigger another wipe
    } finally { off(); vi.useRealTimers() }
  })

  it('a 401 for a token that was read still re-pairs (revoked or expired)', async () => {
    const seen: number[] = []
    const off = bus.on('unauthorized', () => seen.push(1))
    try {
      const api = createApi('http://x', async () => 'old', (() => Promise.resolve(new Response('{"error":"bad token"}', { status: 401 }))) as unknown as typeof fetch)
      await expect(api.today()).rejects.toMatchObject({ status: 401 })
      expect(seen).toEqual([1])
    } finally { off() }
  })
})
