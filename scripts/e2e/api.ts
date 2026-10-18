#!/usr/bin/env -S npx tsx
/**
 * Isolated CoachLens API for the e2e run: the REAL api (createApp from api/src/app.ts, real services, real
 * detectors, real drizzle migrations) on 127.0.0.1:8787 over an IN-MEMORY PGlite database seeded with synthetic
 * data for two instructors (scripts/e2e/seed.ts). Nothing is persisted; every start is a fresh database.
 *
 *   node_modules/.bin/tsx scripts/e2e/api.ts          # from the repo root
 *
 * Safety:
 * - Email is INTERCEPTED: deps.mail records each message (GET /__e2e/log → mail) and never sends. The Resend client
 *   is never constructed (api/src/prod.ts is not imported) and RESEND_API_KEY / ANTHROPIC / OPENAI keys are deleted
 *   from this process's env at start.
 * - Network guard: globalThis.fetch refuses anything but loopback, so no SDK can reach Resend, Anthropic or OpenAI
 *   even by accident. Refusals are logged (GET /__e2e/log → blockedFetches).
 * - The model layer is a deterministic fake (scripts/e2e/fakeLlm.ts); speech-to-text is canned: each transcribe
 *   call pops the next transcript queued with POST /__e2e/transcript (the simulator's ambient mic audio is ignored).
 * - Binds to 127.0.0.1 only. The /__e2e control routes exist only in this harness, never in the app.
 *
 * Control routes (harness only):
 *   POST /__e2e/transcript        body = text: queue the next STT result
 *   POST /__e2e/scenario          body = name: tag the following log lines with this scenario
 *   POST /__e2e/fail              { path, status, count, retryAfter? }: answer the next `count` matching requests with `status`
 *   POST /__e2e/drop              { path, count }: run the next matching request, then cut the connection before the body
 *   POST /__e2e/clock             { offsetMs }: shift the server clock (e.g. past 70 % of class time)
 *   GET  /__e2e/state             every table
 *   GET  /__e2e/log               { requests, llmCalls, sttCalls, mail, blockedFetches, deferredErrors }
 *   GET  /__e2e/seed              seed ids and pairing codes
 */
import { serve } from '@hono/node-server'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from '../../api/src/app'
import { makeTestDb } from '../../api/src/test/helpers'
import * as tables from '../../api/src/db/schema'
import { localDate } from '../../api/src/logic/dates'
import type { Deps, MailMsg } from '../../api/src/deps'
import { CODES, TEST_PAIRING_PEPPER, seedE2E } from './seed'
import { createFakeLlm, type LlmCall } from './fakeLlm'

const PORT = Number(process.env.E2E_API_PORT ?? 8787)
const APP_ORIGINS = (process.env.E2E_APP_ORIGINS ?? 'http://localhost:5191').split(',')
const TZ = 'America/Los_Angeles'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

// ---- Safety first: no real keys in this process, no non-loopback network ----
for (const k of ['RESEND_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DATABASE_URL', 'AI_GATEWAY_API_KEY']) delete process.env[k]
const blockedFetches: { at: string; url: string }[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    blockedFetches.push({ at: new Date().toISOString(), url: `${url.protocol}//${url.hostname}${url.pathname}` })
    throw new Error(`e2e network guard: refused ${url.hostname}`)
  }
  return realFetch(input, init)
}) as typeof fetch

// ---- Database + seed ----
let clockOffsetMs = 0
const now = () => new Date(Date.now() + clockOffsetMs)
const db = await makeTestDb()
const seeded = await seedE2E(db, localDate(now(), TZ))

// ---- Fakes ----
const llmCalls: LlmCall[] = []
/** Per-agent model latency (ms), settable from the runner to widen race windows (C1 in_progress, C2 cancellation). */
const llmDelays: Record<string, number> = {}
const sttCalls: { at: string; transcript: string; audioBytes: number; scenario: string }[] = []
const transcripts: string[] = []
const mail: (MailMsg & { at: string; scenario: string; id: string })[] = []
const deferredErrors: { at: string; error: string }[] = []
let scenario = 'boot'

const deps: Deps = {
  db,
  llm: createFakeLlm(llmCalls, name => llmDelays[name] ?? 150),
  stt: {
    async transcribe(wav) {
      const transcript = transcripts.shift() ?? ''
      sttCalls.push({ at: new Date().toISOString(), transcript, audioBytes: wav.byteLength, scenario })
      return transcript
    },
  },
  mail: {
    async send(m) {
      const id = `intercepted_${mail.length + 1}`
      mail.push({ ...m, at: new Date().toISOString(), scenario, id })
      console.log(`[mail intercepted] NOT sent: to=${m.to} subject=${JSON.stringify(m.subject)}`)
      return { id }
    },
  },
  now,
  defer: p => { p.catch(e => { deferredErrors.push({ at: new Date().toISOString(), error: e instanceof Error ? e.message : String(e) }); console.error('[defer]', e) }) },
  env: {
    pairingCode: CODES.A, cronSecret: 'e2e-cron-local', allowedOrigins: APP_ORIGINS,
    demoEmailOverride: null, instructorName: 'Coach Galen', timeZone: TZ, aiDailyCap: 300, sttConfigured: true,
    // Test-only pepper (C4 hashes pairing codes with a server secret); the same value the seed hashed with.
    pairingPepper: process.env.PAIRING_PEPPER || TEST_PAIRING_PEPPER,
  },
}

const app = createApp(deps)

// ---- Request log + fault injection ----
interface ReqLog { at: string; scenario: string; method: string; path: string; status: number; ms: number; idempotencyKey: string | null; replay: string | null; injected?: string; auth: string | null; body?: unknown; response?: unknown }
const requests: ReqLog[] = []
type Rule = { path: string; status?: number; count: number; retryAfter?: number; kind: 'fail' | 'drop' }
const rules: Rule[] = []
const takeRule = (path: string, kind: Rule['kind']) => {
  const r = rules.find(x => x.kind === kind && x.count > 0 && path === x.path)
  if (r) r.count -= 1
  return r ?? null
}
/** The last 6 chars of a bearer token: enough to tell tokens apart in the log, never the token. */
const authTag = (h: string | null) => (h ? `…${h.slice(-6)}` : null)

async function body(req: Request) { return req.text() }

async function control(req: Request, url: URL): Promise<Response> {
  const p = url.pathname.slice('/__e2e'.length)
  if (p === '/transcript' && req.method === 'POST') { transcripts.push(await body(req)); return Response.json({ queued: transcripts.length }) }
  if (p === '/scenario' && req.method === 'POST') { scenario = (await body(req)).trim() || 'unnamed'; return Response.json({ scenario }) }
  if (p === '/fail' && req.method === 'POST') { const r = await req.json() as Rule; rules.push({ ...r, kind: 'fail' }); return Response.json({ ok: true }) }
  if (p === '/drop' && req.method === 'POST') { const r = await req.json() as Rule; rules.push({ ...r, kind: 'drop' }); return Response.json({ ok: true }) }
  if (p === '/clear-rules' && req.method === 'POST') { rules.length = 0; transcripts.length = 0; return Response.json({ ok: true }) }
  if (p === '/llm-delay' && req.method === 'POST') { const { name, ms } = await req.json() as { name: string; ms: number }; llmDelays[name] = ms; return Response.json({ llmDelays }) }
  if (p === '/clock' && req.method === 'POST') { clockOffsetMs = Number((await req.json() as { offsetMs: number }).offsetMs) || 0; return Response.json({ offsetMs: clockOffsetMs, now: now().toISOString() }) }
  if (p === '/state') {
    const data: Record<string, unknown> = {}
    for (const [name, table] of Object.entries(tables)) {
      if (table && typeof table === 'object' && Symbol.for('drizzle:Name') in (table as object)) {
        try { data[name] = await db.select().from(table as never) } catch { /* not a table */ }
      }
    }
    return Response.json(data)
  }
  if (p === '/log') return Response.json({ requests, llmCalls, sttCalls, mail, blockedFetches, deferredErrors, rules, clockOffsetMs })
  if (p === '/seed') return Response.json({ ...seeded, codes: CODES })
  return new Response('not found', { status: 404 })
}

const server = serve({
  port: PORT, hostname: '127.0.0.1',
  fetch: async (req: Request) => {
    const url = new URL(req.url)
    if (url.pathname.startsWith('/__e2e/')) return control(req, url)
    const start = Date.now()
    const log: ReqLog = {
      at: new Date().toISOString(), scenario, method: req.method, path: url.pathname, status: 0, ms: 0,
      idempotencyKey: req.headers.get('idempotency-key'), replay: null, auth: authTag(req.headers.get('authorization')),
    }
    requests.push(log)
    if (req.method !== 'OPTIONS') {
      const fail = takeRule(url.pathname, 'fail')
      if (fail) {
        log.status = fail.status ?? 500; log.ms = Date.now() - start; log.injected = `fail ${log.status}`
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (fail.retryAfter !== undefined) headers['retry-after'] = String(fail.retryAfter)
        const origin = req.headers.get('origin')
        if (origin && APP_ORIGINS.includes(origin)) headers['access-control-allow-origin'] = origin
        headers['access-control-expose-headers'] = 'Retry-After'
        return new Response(JSON.stringify({ error: 'slow down' }), { status: log.status, headers })
      }
    }
    if (/json/.test(req.headers.get('content-type') ?? '')) log.body = await req.clone().json().catch(() => null)
    const res = await app.fetch(req)
    log.status = res.status; log.ms = Date.now() - start; log.replay = res.headers.get('idempotent-replay')
    // Keep what the client was told for the routes the scenarios assert on (small JSON only).
    if (req.method !== 'OPTIONS' && /^\/v1\/(utterance|transcribe|utterances\/|unpair|students|classes|notes\/[^/]+\/candidates|status)/.test(url.pathname)) {
      log.response = await res.clone().json().catch(() => null)
    }
    if (req.method !== 'OPTIONS' && takeRule(url.pathname, 'drop')) {
      // The server has committed; the client never gets the body (the connection is cut mid-response).
      log.injected = 'response dropped after commit'
      await res.text()
      const headers = new Headers(res.headers)
      return new Response(new ReadableStream({ start(c) { c.error(new Error('e2e: response dropped')) } }), { status: res.status, headers })
    }
    return res
  },
}, i => {
  const info = { port: i.port, origins: APP_ORIGINS, seeded, mail: 'intercepted', stt: 'canned', llm: 'deterministic fake' }
  mkdirSync(join(ROOT, 'scripts', 'e2e', '.run'), { recursive: true })
  writeFileSync(join(ROOT, 'scripts', 'e2e', '.run', 'api.json'), JSON.stringify(info, null, 2))
  console.log(`E2E_API_READY ${JSON.stringify(info)}`)
})

const stop = () => { server.close(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
