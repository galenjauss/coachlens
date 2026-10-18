// E2E regression (batch 5): the batch-3 client sends `Idempotency-Key` (C1) on every queued note. From a browser or the
// Even Hub WebView that is a cross-origin request with a custom header, so the CORS preflight must allow it; otherwise
// the browser never sends the POST and every note sits in the outbox as "offline, will sync". The replay header must be
// readable by the client too.
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps } from './test/helpers'
import { createApp } from './app'

const ORIGIN = 'http://localhost:5191'

async function app() {
  const deps = makeDeps(await makeTestDb())
  return createApp({ ...deps, env: { ...deps.env, allowedOrigins: [ORIGIN] } })
}

describe('CORS for the lens and phone clients', () => {
  it('the preflight for a queued note allows the Idempotency-Key header', async () => {
    const res = await (await app()).request('/v1/utterance', {
      method: 'OPTIONS',
      headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,idempotency-key' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    const allowed = (res.headers.get('access-control-allow-headers') ?? '').toLowerCase().split(',').map(s => s.trim())
    expect(allowed).toEqual(expect.arrayContaining(['authorization', 'content-type', 'idempotency-key']))
  })

  it('a reply exposes Idempotent-Replay to the client', async () => {
    const res = await (await app()).request('/health', { headers: { Origin: ORIGIN } })
    expect((res.headers.get('access-control-expose-headers') ?? '').toLowerCase()).toContain('idempotent-replay')
  })

  it('an unknown origin still gets no CORS grant', async () => {
    const res = await (await app()).request('/v1/utterance', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'idempotency-key' },
    })
    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })
})
