# MatSide Plan, Part 3: Even Hub app and shipping (Tasks 14–20)

> Index and Global Constraints: [2026-10-17-matside.md](2026-10-17-matside.md). Needs Task 2 (contracts). Needs Task 13's `API_URL` from Task 16 on. Tasks 14–15 can start right after Task 2.

---

### Task 14: App core: storage, API client, outbox, WAV, recorder

**Files:**
- Create: `app/src/config.ts`, `app/src/core/storage.ts`, `app/src/core/api.ts`, `app/src/core/outbox.ts`, `app/src/core/wav.ts`, `app/src/core/audio.ts`, `app/src/core/bus.ts`, `app/vitest.config.ts`
- Test: `app/src/core/core.test.ts`

**Interfaces:**
- Consumes: shared contracts.
- Produces:
  - **`config.ts`:** `API_URL: string` (from `import.meta.env.VITE_API_URL`)
  - **`storage.ts`:**
    - `interface KV { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> }`
    - `memoryKV(): KV`
    - `bridgeKV(bridge): KV`
    - `KEYS = { token, outbox, firstRunSeen, session }`
  - **`api.ts`:**
    - `class ApiError { status: number }`, `class NetworkError`
    - `createApi(baseUrl, getToken: () => Promise<string | null>): Api`, with every method listed in Step 3
  - **`outbox.ts`:**
    - `OutboxForm = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; audioB64: string | null; text: string | null }`
    - `class Outbox(kv)` with methods `enqueue(form): Promise<OutboxItem>`, `list()`, and `flush(send): Promise<FlushResult>`
    - `FlushResult = { results: Map<string, UtteranceResponse>; dropped: Map<string, number>; remaining: number }`
  - **`wav.ts`:** `pcmToWav(chunks: Uint8Array[], sampleRate?): Uint8Array`, `toB64(u8)`, `fromB64(s)`
  - **`audio.ts`:** `class Recorder(bridge)` with `start()`, `push(pcm)`, `stop(): Promise<Uint8Array | null>` (null if under 0.4 s), `cancel()`, `MAX_RECORD_MS = 20000`
  - **`bus.ts`:** `bus` (tiny typed emitter); events `paired`, `startClass`, `sessionChanged`

- [ ] **Step 1: Install app deps**

```bash
cd ~/lahacks
npm install -w app react@^19.3.1 react-dom@^19.3.1
npm install -w app -D @vitejs/plugin-react@^6.1.2 @types/react @types/react-dom vitest@^5.0.5
```

`app/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
```

- [ ] **Step 2: Failing tests**

`app/src/core/core.test.ts`:
```ts
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
})
```

- [ ] **Step 3: Run to verify failure, then implement**

Run: `npm test -w app`. Expected: FAIL.

`app/src/config.ts`:
```ts
export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'
```

`app/src/core/storage.ts`:
```ts
export interface KV { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> }
export const KEYS = { token: 'matside.token', outbox: 'matside.outbox', firstRunSeen: 'matside.firstRun', session: 'matside.session' } as const

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return { async get(k) { return m.get(k) ?? null }, async set(k, v) { m.set(k, v) } }
}

type BridgeStorage = { getLocalStorage(k: string): Promise<string>; setLocalStorage(k: string, v: string): Promise<boolean> }
export function bridgeKV(bridge: BridgeStorage): KV {
  return {
    async get(k) { const v = await bridge.getLocalStorage(k); return v ? v : null },
    async set(k, v) { if (!(await bridge.setLocalStorage(k, v))) console.error('[kv] set failed', k) },
  }
}

export function browserKV(): KV {
  return {
    async get(k) { try { return localStorage.getItem(k) } catch { return null } },
    async set(k, v) { try { localStorage.setItem(k, v) } catch (e) { console.error('[kv]', e) } },
  }
}
```

`app/src/core/wav.ts`:
```ts
export function pcmToWav(chunks: Uint8Array[], sampleRate = 16000): Uint8Array {
  const dataLen = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(44 + dataLen)
  const v = new DataView(out.buffer)
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i) }
  ascii(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  ascii(36, 'data'); v.setUint32(40, dataLen, true)
  let o = 44
  for (const c of chunks) { out.set(c, o); o += c.length }
  return out
}
export function toB64(u: Uint8Array): string {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
export function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
```

`app/src/core/api.ts`:
```ts
import {
  Alternatives, AgentRunView, Coverage, Deck, NextStudent, ReviewItem, RosterStudent, StartSessionResponse, StudentDetail,
  SuggestResponse, Today, UtteranceResponse, WrapUp, type DeckPatch,
} from '@matside/shared'
import { z } from 'zod'

export class ApiError extends Error { constructor(public status: number, message: string) { super(message) } }
export class NetworkError extends Error {}

export type Api = ReturnType<typeof createApi>
export type UtterancePayload = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; text: string | null; audio: Blob | null }

export function createApi(baseUrl: string, getToken: () => Promise<string | null>) {
  async function req<T>(path: string, init: RequestInit & { json?: unknown } = {}, schema?: z.ZodType<T>): Promise<T> {
    const headers = new Headers(init.headers)
    const token = await getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    let body = init.body
    if (init.json !== undefined) { headers.set('Content-Type', 'application/json'); body = JSON.stringify(init.json) }
    let res: Response
    try { res = await fetch(`${baseUrl}${path}`, { ...init, headers, body }) } catch (e) { throw new NetworkError(e instanceof Error ? e.message : 'network') }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? res.statusText)
    return schema ? schema.parse(data) : (data as T)
  }
  const post = <T>(path: string, json: unknown = {}, schema?: z.ZodType<T>) => req(path, { method: 'POST', json }, schema)
  const ok = z.object({ ok: z.literal(true) })
  return {
    pair: (code: string) => post('/pair', { code }, z.object({ token: z.string() })),
    today: () => req('/v1/today', {}, Today),
    startSession: (classId: string) => post('/v1/sessions', { classId }, StartSessionResponse),
    attendance: (sessionId: string, presentIds: string[]) => post(`/v1/sessions/${sessionId}/attendance`, { presentIds }, Coverage),
    endSession: (sessionId: string) => post(`/v1/sessions/${sessionId}/end`, {}, WrapUp),
    remind: (sessionId: string, studentIds: string[]) => post(`/v1/sessions/${sessionId}/remind`, { studentIds }, ok),
    logDrill: (sessionId: string, drillId: string, event: 'start' | 'end') => post(`/v1/sessions/${sessionId}/drills/${drillId}/${event}`, {}, ok),
    utterance: (p: UtterancePayload) => {
      const f = new FormData()
      f.set('sessionId', p.sessionId); f.set('mode', p.mode)
      if (p.drillId) f.set('drillId', p.drillId)
      if (p.text) f.set('text', p.text)
      if (p.audio) f.set('audio', p.audio, 'note.wav')
      return req('/v1/utterance', { method: 'POST', body: f }, UtteranceResponse)
    },
    undo: (utteranceId: string) => post(`/v1/utterances/${utteranceId}/undo`, {}, z.object({ coverage: Coverage.nullable() })),
    assignNote: (noteId: string, studentId: string) => post(`/v1/notes/${noteId}/assign`, { studentId }, z.object({ coverage: Coverage.nullable(), nextStudent: NextStudent.nullable() })),
    dismissNote: (noteId: string) => post(`/v1/notes/${noteId}/dismiss`, {}, ok),
    review: () => req('/v1/review', {}, z.array(ReviewItem)),
    approve: (id: string, edits: { subject?: string; body?: string } = {}) => post(`/v1/review/outbox/${id}/approve`, edits, ok),
    skip: (id: string) => post(`/v1/review/outbox/${id}/skip`, {}, ok),
    approveAll: () => post('/v1/review/outbox/approve-all', {}, z.object({ sent: z.number(), failed: z.number() })),
    handleBilling: (id: string, note?: string) => post(`/v1/review/billing/${id}/handle`, { note }, ok),
    noteBilling: (id: string, note: string) => post(`/v1/review/billing/${id}/note`, { note }, ok),
    deck: (id: string) => req(`/v1/decks/${id}`, {}, Deck),
    patchDeck: (id: string, patch: DeckPatch) => req(`/v1/decks/${id}`, { method: 'PATCH', json: patch }, Deck),
    suggest: (id: string, text: string) => post(`/v1/decks/${id}/suggest`, { text }, SuggestResponse),
    acceptDiff: (id: string, remember: boolean) => post(`/v1/diffs/${id}/accept`, { remember }, Deck),
    undoDiff: (id: string) => post(`/v1/diffs/${id}/undo`, {}, ok),
    alternatives: (drillId: string) => post(`/v1/drills/${drillId}/alternatives`, {}, Alternatives),
    students: () => req('/v1/students', {}, z.array(RosterStudent)),
    student: (id: string) => req(`/v1/students/${id}`, {}, StudentDetail),
    feed: (since?: string) => req(`/v1/agents/feed${since ? `?since=${encodeURIComponent(since)}` : ''}`, {}, z.array(AgentRunView)),
    runReportCards: (studentIds?: string[]) => post('/v1/report-cards/run', { studentIds }, z.object({ started: z.number() })),
  }
}
```
Add `zod` to app dependencies: `npm install -w app zod@^4.6.7`.

`app/src/core/outbox.ts`:
```ts
import type { UtteranceResponse } from '@matside/shared'
import { ApiError } from './api'
import { KEYS, type KV } from './storage'

export type OutboxForm = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; audioB64: string | null; text: string | null }
export type OutboxItem = { id: string; createdAt: number; attempts: number; form: OutboxForm }
export type FlushResult = { results: Map<string, UtteranceResponse>; dropped: Map<string, number>; remaining: number }
const MAX_ATTEMPTS = 5

export class Outbox {
  private busy: Promise<unknown> = Promise.resolve()
  constructor(private kv: KV) {}

  async list(): Promise<OutboxItem[]> {
    const raw = await this.kv.get(KEYS.outbox)
    try { return raw ? (JSON.parse(raw) as OutboxItem[]) : [] } catch { return [] }
  }
  private save(items: OutboxItem[]) { return this.kv.set(KEYS.outbox, JSON.stringify(items)) }

  async enqueue(form: OutboxForm): Promise<OutboxItem> {
    const item: OutboxItem = { id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, form }
    await this.save([...(await this.list()), item])
    return item
  }

  // Serialized: never two flushes at once. Stops at the first network/5xx failure to keep order.
  flush(send: (i: OutboxItem) => Promise<UtteranceResponse>): Promise<FlushResult> {
    const run = this.busy.then(async () => {
      const results = new Map<string, UtteranceResponse>()
      const dropped = new Map<string, number>()
      let items = await this.list()
      while (items.length) {
        const head = items[0]!
        try {
          results.set(head.id, await send(head))
          items = items.slice(1)
        } catch (e) {
          if (e instanceof ApiError && e.status >= 400 && e.status < 500) { dropped.set(head.id, e.status); items = items.slice(1) }
          else if (e instanceof ApiError) {
            const attempts = head.attempts + 1
            items = attempts >= MAX_ATTEMPTS ? items.slice(1) : [{ ...head, attempts }, ...items.slice(1)]
            if (attempts >= MAX_ATTEMPTS) dropped.set(head.id, e.status)
            break
          } else break
        } finally {
          await this.save(items)
        }
      }
      return { results, dropped, remaining: items.length }
    })
    this.busy = run.catch(() => undefined)
    return run
  }
}
```

`app/src/core/audio.ts`:
```ts
import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { pcmToWav } from './wav'

export const MAX_RECORD_MS = 20_000
const MIN_BYTES = 16000 * 2 * 0.4

type AudioBridge = { audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean> }

export class Recorder {
  private chunks: Uint8Array[] = []
  recording = false
  constructor(private bridge: AudioBridge) {}
  async start() {
    this.chunks = []
    this.recording = true
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses)
    if (!ok) { this.recording = false; throw new Error('mic unavailable') }
  }
  push(pcm: Uint8Array) { if (this.recording) this.chunks.push(pcm) }
  async stop(): Promise<Uint8Array | null> {
    this.recording = false
    await this.bridge.audioControl(false)
    const bytes = this.chunks.reduce((n, c) => n + c.length, 0)
    return bytes < MIN_BYTES ? null : pcmToWav(this.chunks)
  }
  async cancel() { this.recording = false; this.chunks = []; await this.bridge.audioControl(false) }
}
```

`app/src/core/bus.ts`:
```ts
type Events = { paired: void; startClass: void; sessionChanged: string | null }
type Handler<T> = (p: T) => void
const handlers: { [K in keyof Events]?: Handler<Events[K]>[] } = {}
export const bus = {
  on<K extends keyof Events>(k: K, h: Handler<Events[K]>) { (handlers[k] ??= []).push(h); return () => { handlers[k] = handlers[k]!.filter(x => x !== h) as never } },
  emit<K extends keyof Events>(k: K, p: Events[K]) { for (const h of handlers[k] ?? []) h(p) },
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm test -w app && npm run typecheck -w app`
Expected: PASS. If `ApiError` constructor parameter properties trip `isolatedModules`/`erasableSyntaxOnly`, write the field out explicitly (`status: number; constructor(status, message) { super(message); this.status = status }`).

- [ ] **Step 5: Commit**

```bash
git add app package-lock.json
git commit -m "feat(app): api client, persistent outbox, wav encoder, recorder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Lens state machine (pure reducer)

**Files:**
- Create: `app/src/lens/state.ts`, `app/src/lens/reducer.ts`
- Test: `app/src/lens/reducer.test.ts`

**Interfaces:**
- Consumes: `Today`, `StartSessionResponse`, `UtteranceResponse`, `WrapUp`, `Coverage`, `NextStudent`, `Disambiguation` (shared).
- Produces:
  - `Screen = 'firstRun' | 'home' | 'attendance' | 'attendanceDone' | 'drill' | 'deck' | 'recording' | 'sending' | 'card' | 'disambiguation' | 'confirmEnd' | 'wrapup'`
  - `LensState` (fields in Step 3)
  - `LensEvent` (union in Step 3)
  - `Effect` (union in Step 3)
  - `initialState(firstRunSeen: boolean): LensState`
  - `reduce(s: LensState, e: LensEvent): { state: LensState; effects: Effect[] }`
  - `CARD_MS = 4000`

- [ ] **Step 1: Failing tests**

`app/src/lens/reducer.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { initialState, reduce } from './reducer'
import type { LensEvent, LensState } from './state'

const today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft' as const, drills: [
    { id: 'd1', position: 1, name: 'Tag', minutes: 5, kind: 'warmup' as const, cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
    { id: 'd2', position: 2, name: 'Holds', minutes: 4, kind: 'technique' as const, cues: ['knees out'], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
  ] },
}
const cov = { covered: 0, present: 12 }
const run = (s: LensState, ...events: LensEvent[]) => events.reduce<{ state: LensState; effects: unknown[] }>((acc, e) => {
  const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }
}, { state: s, effects: [] })

describe('lens reducer', () => {
  it('first run → home → start class → voice attendance', () => {
    let r = run(initialState(false), { type: 'tap' })
    expect(r.state.screen).toBe('home')
    expect(r.effects).toContainEqual({ type: 'markFirstRunSeen' })
    r = run(r.state, { type: 'todayLoaded', today }, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'startSession', classId: 'c1' })
    r = run(r.state, { type: 'sessionStarted', res: { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: null }, resumed: false, now: 1000 })
    expect(r.state.screen).toBe('attendance')
    expect(r.effects).toContainEqual({ type: 'startMic' })
    r = run(r.state, { type: 'tap' })
    expect(r.state.screen).toBe('sending')
    expect(r.effects).toContainEqual({ type: 'stopMicAndSend', mode: 'attendance', sessionId: 's1', drillId: null })
    r = run(r.state, { type: 'utteranceResult', res: { utteranceId: 'u', transcript: 'x', cardLines: ['12 present', 'absent: Jake'], coverage: cov, nextStudent: null, disambiguation: null } })
    expect(r.state.screen).toBe('attendanceDone')
    r = run(r.state, { type: 'tap', now: 2000 } as LensEvent)
    expect(r.state.screen).toBe('drill')
    expect(r.state.active?.drillId).toBe('d1')
    expect(r.effects).toContainEqual({ type: 'logDrill', sessionId: 's1', drillId: 'd1', event: 'start' })
  })

  it('home double-tap exits (root rule)', () => {
    const r = run(initialState(true), { type: 'doubleTap' })
    expect(r.effects).toEqual([{ type: 'exit' }])
  })

  const inDrill = () => run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' },
    { type: 'sessionStarted', res: { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: { id: 'p', name: 'Priya', reason: 'guard' } }, resumed: true, now: 1000 }).state

  it('resumed session goes straight to drill', () => {
    expect(inDrill().screen).toBe('drill')
  })

  it('tap to talk, tap to send, card then timeout back to drill', () => {
    let r = run(inDrill(), { type: 'tap' })
    expect(r.state.screen).toBe('recording')
    r = run(r.state, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'stopMicAndSend', mode: 'note', sessionId: 's1', drillId: 'd1' })
    r = run(r.state, { type: 'utteranceResult', res: { utteranceId: 'u1', transcript: 't', cardLines: ['✓ Priya · guard (3rd time)'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null } })
    expect(r.state.screen).toBe('card')
    expect(r.state.coverage.covered).toBe(1)
    expect(r.effects).toContainEqual({ type: 'scheduleCardTimeout', ms: 4000 })
    r = run(r.state, { type: 'cardTimeout' })
    expect(r.state.screen).toBe('drill')
  })

  it('double-tap on a card undoes', () => {
    let r = run(inDrill(), { type: 'tap' }, { type: 'tap' },
      { type: 'utteranceResult', res: { utteranceId: 'u1', transcript: 't', cardLines: ['✓ x'], coverage: cov, nextStudent: null, disambiguation: null } })
    r = run(r.state, { type: 'doubleTap' })
    expect(r.effects).toContainEqual({ type: 'undo', utteranceId: 'u1' })
    expect(r.state.screen).toBe('drill')
  })

  it('long press records and release sends', () => {
    let r = run(inDrill(), { type: 'longPress' })
    expect(r.state.screen).toBe('recording')
    r = run(r.state, { type: 'longPressRelease' })
    expect(r.state.screen).toBe('sending')
  })

  it('queued and empty results return to drill with a status', () => {
    let r = run(inDrill(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceQueued' })
    expect(r.state).toMatchObject({ screen: 'drill', status: '● Saved · will sync' })
    r = run(inDrill(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceEmpty' })
    expect(r.state.status).toBe("Didn't catch that · tap to retry")
  })

  it('disambiguation picks a student', () => {
    let r = run(inDrill(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: {
      utteranceId: 'u', transcript: 't', cardLines: [], coverage: cov, nextStudent: null,
      disambiguation: { noteId: 'n1', heard: 'Mya', options: [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Mia Lopez' }] } } })
    expect(r.state.screen).toBe('disambiguation')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.effects).toContainEqual({ type: 'assignNote', noteId: 'n1', studentId: 'b' })
    expect(r.state.screen).toBe('drill')
  })

  it('swipe opens deck; selecting switches drill', () => {
    let r = run(inDrill(), { type: 'swipeDown' })
    expect(r.state.screen).toBe('deck')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.state.active?.drillId).toBe('d2')
    expect(r.effects).toContainEqual({ type: 'logDrill', sessionId: 's1', drillId: 'd2', event: 'start' })
  })

  it('end class needs confirm, then wrap-up and remind', () => {
    let r = run(inDrill(), { type: 'doubleTap' })
    expect(r.state.screen).toBe('confirmEnd')
    r = run(r.state, { type: 'swipeUp' })
    expect(r.state.screen).toBe('drill')
    r = run(r.state, { type: 'doubleTap' }, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'endSession', sessionId: 's1' })
    r = run(r.state, { type: 'wrapupLoaded', wrapup: { sessionId: 's1', minutes: 47, drillsRun: 7, coverage: { covered: 9, present: 12 }, missed: [{ id: 'j', name: 'Jake' }], agentActions: 11, pendingReview: 3 } })
    expect(r.state.screen).toBe('wrapup')
    r = run(r.state, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'remind', sessionId: 's1', studentIds: ['j'] })
    expect(r.state.screen).toBe('home')
    expect(r.state.session).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w app -- reducer`
Expected: FAIL.

- [ ] **Step 3: Implement**

`app/src/lens/state.ts`:
```ts
import type { Coverage, Disambiguation, NextStudent, StartSessionResponse, Today, UtteranceResponse, WrapUp } from '@matside/shared'

export type Screen = 'firstRun' | 'home' | 'attendance' | 'attendanceDone' | 'drill' | 'deck' | 'recording' | 'sending' | 'card' | 'disambiguation' | 'confirmEnd' | 'wrapup'
export type Mode = 'note' | 'attendance'

export interface LensState {
  screen: Screen
  today: Today | null
  session: { id: string; startedAt: number } | null
  active: { drillId: string; startedAt: number } | null
  coverage: Coverage
  nextStudent: NextStudent | null
  card: { lines: string[]; utteranceId: string | null } | null
  disambiguation: Disambiguation | null
  wrapup: WrapUp | null
  pending: { mode: Mode; returnTo: Screen; viaLongPress: boolean } | null
  attendanceLines: string[]
  status: string | null
  loadError: string | null
}

export type LensEvent =
  | { type: 'tap' } | { type: 'doubleTap' } | { type: 'swipeUp' } | { type: 'swipeDown' }
  | { type: 'longPress' } | { type: 'longPressRelease' }
  | { type: 'listSelect'; index: number }
  | { type: 'resumed' }
  | { type: 'startRequested' }
  | { type: 'todayLoaded'; today: Today }
  | { type: 'loadFailed'; message: string }
  | { type: 'sessionStarted'; res: StartSessionResponse; resumed: boolean; now: number }
  | { type: 'utteranceResult'; res: UtteranceResponse }
  | { type: 'utteranceQueued' } | { type: 'utteranceEmpty' } | { type: 'micFailed' }
  | { type: 'coverageUpdated'; coverage: Coverage; nextStudent: NextStudent | null }
  | { type: 'wrapupLoaded'; wrapup: WrapUp }
  | { type: 'cardTimeout' }

export type Effect =
  | { type: 'markFirstRunSeen' }
  | { type: 'loadToday' }
  | { type: 'startSession'; classId: string }
  | { type: 'startMic' }
  | { type: 'cancelMic' }
  | { type: 'stopMicAndSend'; mode: Mode; sessionId: string; drillId: string | null }
  | { type: 'logDrill'; sessionId: string; drillId: string; event: 'start' | 'end' }
  | { type: 'assignNote'; noteId: string; studentId: string }
  | { type: 'undo'; utteranceId: string }
  | { type: 'endSession'; sessionId: string }
  | { type: 'remind'; sessionId: string; studentIds: string[] }
  | { type: 'scheduleCardTimeout'; ms: number }
  | { type: 'flushOutbox' }
  | { type: 'exit' }
```

`app/src/lens/reducer.ts`:
```ts
import type { Effect, LensEvent, LensState, Mode, Screen } from './state'

export const CARD_MS = 4000
type R = { state: LensState; effects: Effect[] }
const done = (state: LensState, ...effects: Effect[]): R => ({ state, effects })

export function initialState(firstRunSeen: boolean): LensState {
  return {
    screen: firstRunSeen ? 'home' : 'firstRun', today: null, session: null, active: null,
    coverage: { covered: 0, present: 0 }, nextStudent: null, card: null, disambiguation: null, wrapup: null,
    pending: null, attendanceLines: [], status: null, loadError: null,
  }
}

const drills = (s: LensState) => s.today?.deck.drills ?? []

function startDrill(s: LensState, index: number, now: number): R {
  const d = drills(s)[index]
  if (!d || !s.session) return done({ ...s, screen: 'drill' })
  const effects: Effect[] = []
  if (s.active && s.active.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: s.active.drillId, event: 'end' })
  if (s.active?.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: d.id, event: 'start' })
  const active = s.active?.drillId === d.id ? s.active : { drillId: d.id, startedAt: now }
  return { state: { ...s, screen: 'drill', active, status: null }, effects }
}

function record(s: LensState, mode: Mode, returnTo: Screen, viaLongPress: boolean): R {
  return done({ ...s, screen: mode === 'attendance' ? 'attendance' : 'recording', pending: { mode, returnTo, viaLongPress }, status: null }, { type: 'startMic' })
}

function send(s: LensState): R {
  if (!s.pending || !s.session) return done({ ...s, screen: 'drill' })
  return done({ ...s, screen: 'sending' }, { type: 'stopMicAndSend', mode: s.pending.mode, sessionId: s.session.id, drillId: s.pending.mode === 'note' ? s.active?.drillId ?? null : null })
}

function back(s: LensState, status: string | null): LensState {
  const to = s.pending?.returnTo ?? 'drill'
  return { ...s, screen: to === 'attendance' ? 'drill' : to, pending: null, status }
}

export function reduce(s: LensState, e: LensEvent): R {
  const now = 'now' in e && typeof e.now === 'number' ? e.now : Date.now()

  // Data events apply on any screen.
  switch (e.type) {
    case 'todayLoaded': return done({ ...s, today: e.today, loadError: null })
    case 'loadFailed': return done({ ...s, loadError: e.message })
    case 'coverageUpdated': return done({ ...s, coverage: e.coverage, nextStudent: e.nextStudent })
    case 'resumed': return done(s, { type: 'loadToday' }, { type: 'flushOutbox' })
    case 'startRequested': return s.screen === 'home' && s.today ? done(s, { type: 'startSession', classId: s.today.classId }) : done(s)
    case 'sessionStarted': {
      const next = { ...s, session: { id: e.res.sessionId, startedAt: Date.parse(e.res.startedAt) }, coverage: e.res.coverage, nextStudent: e.res.nextStudent }
      return e.resumed ? startDrill(next, 0, e.now) : record(next, 'attendance', 'drill', false)
    }
    case 'micFailed': return done(back(s, 'Mic unavailable · check permission'))
    case 'utteranceQueued': return done(back(s, '● Saved · will sync'))
    case 'utteranceEmpty': return done(back(s, "Didn't catch that · tap to retry"))
    case 'utteranceResult': {
      const base = { ...s, coverage: e.res.coverage, nextStudent: e.res.nextStudent, pending: null }
      if (s.pending?.mode === 'attendance') return done({ ...base, screen: 'attendanceDone', attendanceLines: e.res.cardLines })
      const card = { lines: e.res.cardLines, utteranceId: e.res.utteranceId }
      if (e.res.disambiguation) return done({ ...base, screen: 'disambiguation', disambiguation: e.res.disambiguation, card })
      if (!card.lines.length) return done({ ...base, screen: 'drill' })
      return done({ ...base, screen: 'card', card }, { type: 'scheduleCardTimeout', ms: CARD_MS })
    }
    case 'wrapupLoaded': return done({ ...s, screen: 'wrapup', wrapup: e.wrapup })
    case 'cardTimeout': return s.screen === 'card' ? done({ ...s, screen: 'drill', card: null }) : done(s)
  }

  // Gestures depend on the screen.
  switch (s.screen) {
    case 'firstRun':
      return e.type === 'tap' ? done({ ...s, screen: 'home' }, { type: 'markFirstRunSeen' }, { type: 'loadToday' }) : done(s)
    case 'home':
      if (e.type === 'doubleTap') return done(s, { type: 'exit' })
      if (e.type === 'tap') return s.today ? done(s, { type: 'startSession', classId: s.today.classId }) : done(s, { type: 'loadToday' })
      return done(s)
    case 'attendance':
      if (e.type === 'tap') return send(s)
      if (e.type === 'doubleTap') return done({ ...s, screen: 'drill', pending: null, status: 'Roll call skipped · use phone' }, { type: 'cancelMic' })
      return done(s)
    case 'attendanceDone':
      return e.type === 'tap' ? startDrill(s, 0, now) : done(s)
    case 'drill':
      if (e.type === 'tap') return record(s, 'note', 'drill', false)
      if (e.type === 'longPress') return record(s, 'note', 'drill', true)
      if (e.type === 'swipeUp' || e.type === 'swipeDown') return done({ ...s, screen: 'deck', status: null })
      if (e.type === 'doubleTap') return done({ ...s, screen: 'confirmEnd' })
      return done(s)
    case 'deck':
      if (e.type === 'listSelect') return startDrill(s, e.index, now)
      if (e.type === 'doubleTap') return done({ ...s, screen: 'drill' })
      return done(s)
    case 'recording':
      if (e.type === 'tap') return send(s)
      if (e.type === 'longPressRelease' && s.pending?.viaLongPress) return send(s)
      if (e.type === 'doubleTap') return done(back(s, 'Cancelled'), { type: 'cancelMic' })
      return done(s)
    case 'sending':
      return done(s)
    case 'card':
      if (e.type === 'doubleTap' && s.card?.utteranceId) return done({ ...s, screen: 'drill', card: null, status: 'Undone' }, { type: 'undo', utteranceId: s.card.utteranceId })
      return done({ ...s, screen: 'drill', card: null })
    case 'disambiguation': {
      if (e.type === 'listSelect' && s.disambiguation) {
        const pick = s.disambiguation.options[e.index]
        const after = s.card?.lines.length ? 'card' : 'drill'
        const effects: Effect[] = pick ? [{ type: 'assignNote', noteId: s.disambiguation.noteId, studentId: pick.id }] : []
        if (after === 'card') effects.push({ type: 'scheduleCardTimeout', ms: CARD_MS })
        return { state: { ...s, screen: after, disambiguation: null, status: pick ? `✓ ${pick.name.split(' ')[0]}` : null }, effects }
      }
      if (e.type === 'doubleTap') return done({ ...s, screen: 'drill', disambiguation: null, status: '● Saved to Review' })
      return done(s)
    }
    case 'confirmEnd':
      if (e.type === 'tap' && s.session) return done({ ...s, screen: 'wrapup', wrapup: null }, { type: 'endSession', sessionId: s.session.id })
      return done({ ...s, screen: 'drill' })
    case 'wrapup': {
      if (!s.wrapup || !s.session) return done(s)
      const reset = { ...s, screen: 'home' as const, session: null, active: null, wrapup: null, card: null, status: null, coverage: { covered: 0, present: 0 }, nextStudent: null }
      if (e.type === 'tap') return done(reset, { type: 'remind', sessionId: s.session.id, studentIds: s.wrapup.missed.map(m => m.id) }, { type: 'loadToday' })
      if (e.type === 'doubleTap') return done(reset, { type: 'loadToday' })
      return done(s)
    }
  }
}
```

Note: in the disambiguation test the result has empty `cardLines`, so after the pick the screen is `drill`, which matches the test.

- [ ] **Step 4: Run tests**

Run: `npm test -w app -- reducer`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/lens
git commit -m "feat(app): pure lens state machine with gesture routing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Lens rendering, events, glasses adapter, controller (simulator)

**Files:**
- Create: `app/src/lens/render.ts`, `app/src/lens/events.ts`, `app/src/lens/glasses.ts`, `app/src/lens/controller.ts`
- Modify: `app/src/main.ts` (replace the template), `app/index.html` (`#root` for React), `app/vite.config.ts` (React plugin), `app/app.json`, `app/.env.example`
- Test: `app/src/lens/render.test.ts`

**Interfaces:**
- Consumes: Tasks 14–15; SDK classes `TextContainerProperty`, `ListContainerProperty`, `ListItemContainerProperty`, `CreateStartUpPageContainer`, `RebuildPageContainer`, `TextContainerUpgrade`, `OsEventTypeList`, `waitForEvenAppBridge`, type `EvenHubEvent`.
- Produces:
  - **`render.ts`:**
    - `PageSpec = { key: string; texts: TextSpec[]; list: ListSpec | null }`
    - `TextSpec = { id: number; name: string; x: number; y: number; w: number; h: number; border: boolean; capture: boolean; content: string }`
    - `ListSpec = { id: number; name: string; x: number; y: number; w: number; h: number; items: string[] }` (list always captures)
    - `render(s: LensState, now: number): PageSpec`
    - `timerText(minutes, startedAt, now)`
    - `bar(fraction, width=24)`
  - **`events.ts`:** `toLensEvent(e: EvenHubEvent): LensEvent | null`
  - **`glasses.ts`:** `class Glasses(bridge)` with `show(spec): Promise<void>` (create/rebuild on key change, `textContainerUpgrade` otherwise)
  - **`controller.ts`:** `startLens(deps: { bridge; api: Api; kv: KV; outbox: Outbox }): Promise<{ dispatch(e: LensEvent): void }>`

- [ ] **Step 1: Failing render tests**

`app/src/lens/render.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { render, timerText, bar } from './render'
import { initialState } from './reducer'
import type { LensState } from './state'

const drill = { id: 'd1', position: 1, name: 'Horse stance holds', minutes: 4, kind: 'technique' as const, cues: ['knees out', 'back tall'], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null }
const s: LensState = {
  ...initialState(true), screen: 'drill',
  today: { classId: 'c', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: 's', theme: 'Stances', formsDue: [], focus: [], roster: [], deck: { id: 'k', classId: 'c', forDate: '2026-10-20', status: 'active', drills: [drill] } },
  session: { id: 's', startedAt: 0 }, active: { drillId: 'd1', startedAt: 0 },
  coverage: { covered: 3, present: 12 }, nextStudent: { id: 'p', name: 'Priya', reason: 'guard' },
}

describe('render', () => {
  it('timer and bar', () => {
    expect(timerText(4, 0, 79_000)).toBe('2:41')
    expect(timerText(1, 0, 75_000)).toBe('+0:15')
    expect(bar(0.5, 10)).toBe('━━━━━─────')
  })
  it('drill layout A: header, boxed drill with capture, next line', () => {
    const p = render(s, 79_000)
    expect(p.key).toBe('drill')
    expect(p.texts.find(t => t.name === 'hdrL')?.content).toBe('STANCES · Kids · Tue')
    expect(p.texts.find(t => t.name === 'hdrR')?.content).toBe('Feedback 3/12')
    const box = p.texts.find(t => t.name === 'box')!
    expect(box).toMatchObject({ border: true, capture: true })
    expect(box.content).toContain('HORSE STANCE HOLDS  2:41')
    expect(box.content).toContain('cue: knees out · back tall')
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('> Next feedback: Priya (guard)')
    expect(p.texts.filter(t => t.capture)).toHaveLength(1)
  })
  it('deck uses a capturing list with ≤64-char items', () => {
    const p = render({ ...s, screen: 'deck' }, 0)
    expect(p.list?.items[0]).toBe('Horse stance holds · 4m')
    expect(p.texts.every(t => !t.capture)).toBe(true)
  })
  it('every page has exactly one capturing container and ≤8 texts', () => {
    for (const screen of ['firstRun', 'home', 'attendance', 'attendanceDone', 'drill', 'deck', 'recording', 'sending', 'card', 'confirmEnd', 'wrapup'] as const) {
      const p = render({ ...s, screen, card: { lines: ['✓ x'], utteranceId: 'u' } }, 0)
      expect(p.texts.length).toBeLessThanOrEqual(8)
      expect(p.texts.filter(t => t.capture).length + (p.list ? 1 : 0)).toBe(1)
      for (const t of p.texts) expect(t.name.length).toBeLessThanOrEqual(16)
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w app -- render`
Expected: FAIL.

- [ ] **Step 3: Implement `render.ts`**

`app/src/lens/render.ts`:
```ts
import type { LensState } from './state'

export type TextSpec = { id: number; name: string; x: number; y: number; w: number; h: number; border: boolean; capture: boolean; content: string }
export type ListSpec = { id: number; name: string; x: number; y: number; w: number; h: number; items: string[] }
export type PageSpec = { key: string; texts: TextSpec[]; list: ListSpec | null }

const W = 576
const t = (id: number, name: string, x: number, y: number, w: number, h: number, content: string, o: { border?: boolean; capture?: boolean } = {}): TextSpec =>
  ({ id, name, x, y, w, h, content, border: o.border ?? false, capture: o.capture ?? false })

export function timerText(minutes: number, startedAt: number, now: number): string {
  const left = Math.round(minutes * 60 - (now - startedAt) / 1000)
  const a = Math.abs(left)
  const str = `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`
  return left < 0 ? `+${str}` : str
}
export function bar(fraction: number, width = 24): string {
  const f = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '━'.repeat(f) + '─'.repeat(width - f)
}
const dots = (covered: number, present: number) => '●'.repeat(Math.min(covered, 14)) + '○'.repeat(Math.max(0, Math.min(present, 14) - Math.min(covered, 14)))

// Panel layout: header, bordered body (captures input), footer.
function panel(key: string, header: string, body: string, footer: string): PageSpec {
  return { key: `panel:${key}`, list: null, texts: [
    t(1, 'hdr', 0, 0, W, 40, header),
    t(2, 'body', 0, 44, W, 196, body, { border: true, capture: true }),
    t(3, 'foot', 0, 246, W, 40, footer),
  ] }
}

function listPage(key: string, header: string, items: string[]): PageSpec {
  return { key: `list:${key}:${items.join('|')}`, texts: [t(1, 'hdr', 0, 0, W, 40, header)],
    list: { id: 2, name: 'list', x: 0, y: 44, w: W, h: 244, items: items.slice(0, 20).map(i => i.slice(0, 64)) } }
}

export function render(s: LensState, now: number): PageSpec {
  const drills = s.today?.deck.drills ?? []
  const active = drills.find(d => d.id === s.active?.drillId) ?? null
  const cov = `Feedback ${s.coverage.covered}/${s.coverage.present}`
  const timerRow = active && s.active ? `${active.name.toUpperCase()}  ${timerText(active.minutes, s.active.startedAt, now)}` : ''
  switch (s.screen) {
    case 'firstRun':
      return panel('first', 'WELCOME TO MATSIDE', 'Coach heads-up for the mat.\n\n1. Open MatSide on your phone and pair.\n2. Tap here to continue.', 'tap: talk · swipe: deck · 2×: back')
    case 'home': {
      const td = s.today
      const body = td ? `${td.className} · ${td.startTime}\nTheme: ${td.theme}\nDeck: ${td.deck.drills.length} drills\n\n> Tap to start class` : s.loadError ? `Can't load class.\n${s.loadError}\n\n> Tap to retry` : 'Loading class…\nPair on your phone if this stays.'
      return panel('home', 'MATSIDE', body, s.status ?? '2×: exit')
    }
    case 'attendance':
      return panel('att', `${(s.today?.className ?? '').toUpperCase()} · ${s.today?.theme.toUpperCase() ?? ''}`, `Say who's absent\n"Everyone except Jake and Mia"\n\n● Listening… tap when done`, '2×: skip · or check in on phone')
    case 'attendanceDone': {
      const deck = s.today?.deck.drills ?? []
      const mins = deck.reduce((n, d) => n + d.minutes, 0)
      return panel('attd', s.attendanceLines.join(' · '), `Deck ready · ${deck.length} drills · ${mins} min\n${(s.today?.focus[0]?.label ?? '')}\n\n> Tap to start first drill`, '')
    }
    case 'drill': {
      const frac = active && s.active ? (now - s.active.startedAt) / (active.minutes * 60_000) : 0
      const box = active ? `${timerRow}\n${bar(frac)}\n${active.cues.length ? `cue: ${active.cues.join(' · ')}` : ''}` : 'No drill running\n\n> Swipe to pick a drill'
      const next = s.status ?? (s.nextStudent ? `> Next feedback: ${s.nextStudent.name} (${s.nextStudent.reason})` : '> Everyone has feedback ✓')
      return { key: 'drill', list: null, texts: [
        t(1, 'hdrL', 0, 0, 380, 36, `${(s.today?.theme ?? '').toUpperCase()} · ${s.today?.className ?? ''}`),
        t(2, 'hdrR', 384, 0, 192, 36, cov),
        t(3, 'box', 0, 40, W, 132, box, { border: true, capture: true }),
        t(4, 'next', 0, 180, W, 40, next),
        t(5, 'hint', 0, 244, W, 40, 'tap: talk · swipe: deck · 2×: end'),
      ] }
    }
    case 'deck':
      return listPage('deck', `DECK · ${drills.length} drills · tap to run`, drills.map(d => `${d.name} · ${d.minutes}m${d.focusStudentIds.length ? ` (${d.focusStudentIds.length} kids)` : ''}`))
    case 'recording':
      return panel('rec', timerRow || cov, '● REC\n\nSpeak your note…', 'tap: send · 2×: cancel')
    case 'sending':
      return panel('send', timerRow || cov, '● Sending to agents…', '')
    case 'card':
      return panel('card', timerRow || cov, (s.card?.lines ?? []).join('\n'), `${cov} · 2×: undo`)
    case 'disambiguation': {
      const d = s.disambiguation
      return listPage('dis', d ? `Heard "${d.heard}" · who?` : 'Who?', d ? d.options.map(o => o.name) : [])
    }
    case 'confirmEnd':
      return panel('end', cov, 'End class?\n\n> Tap to confirm\nAny other gesture cancels', '')
    case 'wrapup': {
      const w = s.wrapup
      if (!w) return panel('wrap0', 'CLASS DONE', 'Wrapping up…', '')
      return panel('wrap', `CLASS DONE · ${w.minutes} min · ${w.drillsRun} drills`,
        `Feedback ${w.coverage.covered}/${w.coverage.present} ${dots(w.coverage.covered, w.coverage.present)}\nmissed: ${w.missed.map(m => m.name).join(', ') || 'nobody!'}\n${w.agentActions} agent actions · ${w.pendingReview} to review`,
        w.missed.length ? '> Tap: missed kids first next class' : '> Tap to finish')
    }
  }
}
```

Note: `render(s, 79_000)` with `startedAt 0` and 4 minutes gives 240 − 79 = 161 s, which is `2:41`.

- [ ] **Step 4: Implement events, glasses, controller**

`app/src/lens/events.ts`:
```ts
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { LensEvent } from './state'

// CLICK is 0 and protobuf omits zero values: default INSIDE the envelope check only.
const typeOf = (env?: { eventType?: OsEventTypeList }) => (env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null)

export function toLensEvent(e: EvenHubEvent): LensEvent | null {
  const s = typeOf(e.sysEvent), t = typeOf(e.textEvent), l = typeOf(e.listEvent)
  if (s === OsEventTypeList.LONG_PRESS_EVENT) return { type: 'longPress' }
  if (s === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return { type: 'longPressRelease' }
  if (s === OsEventTypeList.FOREGROUND_ENTER_EVENT) return { type: 'resumed' }
  if (s === OsEventTypeList.IMU_DATA_REPORT || s === OsEventTypeList.FOREGROUND_EXIT_EVENT) return null
  if ([s, t, l].includes(OsEventTypeList.DOUBLE_CLICK_EVENT)) return { type: 'doubleTap' }
  if (e.listEvent && l === OsEventTypeList.CLICK_EVENT) return { type: 'listSelect', index: e.listEvent.currentSelectItemIndex ?? 0 }
  if (t === OsEventTypeList.SCROLL_TOP_EVENT || s === OsEventTypeList.SCROLL_TOP_EVENT) return { type: 'swipeUp' }
  if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT || s === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { type: 'swipeDown' }
  if (s === OsEventTypeList.CLICK_EVENT || t === OsEventTypeList.CLICK_EVENT) return { type: 'tap' }
  return null
}
```

`app/src/lens/glasses.ts`:
```ts
import {
  CreateStartUpPageContainer, ListContainerProperty, ListItemContainerProperty, RebuildPageContainer,
  TextContainerProperty, TextContainerUpgrade, type waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { PageSpec } from './render'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

export class Glasses {
  private key: string | null = null
  private created = false
  private last = new Map<number, string>()
  private queue: Promise<void> = Promise.resolve()
  constructor(private bridge: Bridge) {}

  show(spec: PageSpec): Promise<void> {
    this.queue = this.queue.then(() => this.apply(spec)).catch(e => console.error('[glasses]', e))
    return this.queue
  }

  private async apply(spec: PageSpec) {
    if (spec.key !== this.key) {
      const textObject = spec.texts.map(x => new TextContainerProperty({
        xPosition: x.x, yPosition: x.y, width: x.w, height: x.h, borderWidth: x.border ? 2 : 0, borderColor: 5, borderRadius: 4,
        paddingLength: 6, containerID: x.id, containerName: x.name, content: x.content, isEventCapture: x.capture ? 1 : 0,
      }))
      const listObject = spec.list ? [new ListContainerProperty({
        xPosition: spec.list.x, yPosition: spec.list.y, width: spec.list.w, height: spec.list.h, borderWidth: 0, paddingLength: 4,
        containerID: spec.list.id, containerName: spec.list.name, isEventCapture: 1,
        itemContainer: new ListItemContainerProperty({ itemCount: spec.list.items.length, itemWidth: spec.list.w - 8, isItemSelectBorderEn: 1, itemName: spec.list.items }),
      })] : []
      const containerTotalNum = textObject.length + listObject.length
      if (!this.created) {
        const r = await this.bridge.createStartUpPageContainer(new CreateStartUpPageContainer({ containerTotalNum, textObject, listObject }))
        if (r !== 0) throw new Error(`createStartUpPageContainer failed: ${r}`)
        this.created = true
      } else {
        await this.bridge.rebuildPageContainer(new RebuildPageContainer({ containerTotalNum, textObject, listObject }))
      }
      this.key = spec.key
      this.last = new Map(spec.texts.map(x => [x.id, x.content]))
      return
    }
    for (const x of spec.texts) {
      if (this.last.get(x.id) === x.content) continue
      await this.bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: x.id, containerName: x.name, content: x.content }))
      this.last.set(x.id, x.content)
    }
  }
}
```

`app/src/lens/controller.ts`:
```ts
import type { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import type { Api } from '../core/api'
import { ApiError, NetworkError } from '../core/api'
import { MAX_RECORD_MS, Recorder } from '../core/audio'
import { bus } from '../core/bus'
import type { Outbox, OutboxItem } from '../core/outbox'
import { KEYS, type KV } from '../core/storage'
import { fromB64, toB64 } from '../core/wav'
import { initialState, reduce } from './reducer'
import { render } from './render'
import { Glasses } from './glasses'
import { toLensEvent } from './events'
import type { Effect, LensEvent, LensState } from './state'

type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

export async function startLens(d: { bridge: Bridge; api: Api; kv: KV; outbox: Outbox }) {
  const glasses = new Glasses(d.bridge)
  const recorder = new Recorder(d.bridge)
  let state: LensState = initialState(Boolean(await d.kv.get(KEYS.firstRunSeen)))
  let recordTimer: ReturnType<typeof setTimeout> | null = null
  let cardTimer: ReturnType<typeof setTimeout> | null = null

  const paint = () => glasses.show(render(state, Date.now()))

  function dispatch(e: LensEvent) {
    const r = reduce(state, e)
    state = r.state
    void paint()
    for (const eff of r.effects) void run(eff).catch(err => console.error('[effect]', eff.type, err))
  }

  const sendItem = (i: OutboxItem) => d.api.utterance({
    sessionId: i.form.sessionId, drillId: i.form.drillId, mode: i.form.mode, text: i.form.text,
    audio: i.form.audioB64 ? new Blob([fromB64(i.form.audioB64)], { type: 'audio/wav' }) : null,
  })

  async function flush(currentId: string | null) {
    const r = await d.outbox.flush(sendItem)
    if (currentId) {
      const res = r.results.get(currentId)
      if (res) {
        dispatch({ type: 'utteranceResult', res })
        // Spoken "add drill" changes today's deck; refresh it (cheap: the deck already exists).
        if (res.cardLines.some(l => l.startsWith('✓ Added'))) void run({ type: 'loadToday' })
        return
      }
      if (r.dropped.get(currentId) === 422) return dispatch({ type: 'utteranceEmpty' })
      if (r.dropped.has(currentId)) return dispatch({ type: 'utteranceQueued' })
      return dispatch({ type: 'utteranceQueued' })
    }
  }

  async function run(eff: Effect): Promise<void> {
    switch (eff.type) {
      case 'markFirstRunSeen': return d.kv.set(KEYS.firstRunSeen, '1')
      case 'loadToday':
        try { dispatch({ type: 'todayLoaded', today: await d.api.today() }) }
        catch (e) { dispatch({ type: 'loadFailed', message: e instanceof ApiError && e.status === 401 ? 'Not paired' : 'Offline' }) }
        return
      case 'startSession': {
        const resumed = Boolean(state.today?.sessionId)
        const res = await d.api.startSession(eff.classId)
        bus.emit('sessionChanged', res.sessionId)
        return dispatch({ type: 'sessionStarted', res, resumed, now: Date.now() })
      }
      case 'startMic':
        try {
          await recorder.start()
          recordTimer = setTimeout(() => dispatch({ type: 'tap' }), MAX_RECORD_MS)
        } catch { dispatch({ type: 'micFailed' }) }
        return
      case 'cancelMic':
        if (recordTimer) clearTimeout(recordTimer)
        return recorder.cancel()
      case 'stopMicAndSend': {
        if (recordTimer) clearTimeout(recordTimer)
        const wav = await recorder.stop()
        if (!wav) return dispatch({ type: 'utteranceEmpty' })
        const item = await d.outbox.enqueue({ sessionId: eff.sessionId, drillId: eff.drillId, mode: eff.mode, audioB64: toB64(wav), text: null })
        return flush(item.id)
      }
      case 'logDrill':
        try { await d.api.logDrill(eff.sessionId, eff.drillId, eff.event) } catch (e) { if (!(e instanceof NetworkError)) throw e }
        return
      case 'assignNote': {
        const r = await d.api.assignNote(eff.noteId, eff.studentId)
        if (r.coverage) dispatch({ type: 'coverageUpdated', coverage: r.coverage, nextStudent: r.nextStudent })
        return
      }
      case 'undo': {
        const r = await d.api.undo(eff.utteranceId)
        if (r.coverage) dispatch({ type: 'coverageUpdated', coverage: r.coverage, nextStudent: state.nextStudent })
        return
      }
      case 'endSession': {
        const w = await d.api.endSession(eff.sessionId)
        bus.emit('sessionChanged', null)
        return dispatch({ type: 'wrapupLoaded', wrapup: w })
      }
      case 'remind': { await d.api.remind(eff.sessionId, eff.studentIds); return }
      case 'scheduleCardTimeout':
        if (cardTimer) clearTimeout(cardTimer)
        cardTimer = setTimeout(() => dispatch({ type: 'cardTimeout' }), eff.ms)
        return
      case 'flushOutbox': { await flush(null); return }
      case 'exit': { await d.bridge.shutDownPageContainer(1); return }
    }
  }

  d.bridge.onEvenHubEvent(e => {
    if (e.audioEvent?.audioPcm) recorder.push(e.audioEvent.audioPcm)
    const le = toLensEvent(e)
    if (le) dispatch(le)
  })
  bus.on('paired', () => dispatch({ type: 'resumed' }))
  bus.on('startClass', () => dispatch({ type: 'startRequested' }))
  setInterval(() => { if (state.screen === 'drill' || state.screen === 'recording' || state.screen === 'card') void paint() }, 1000)

  await paint() // never a black screen: first page goes up immediately
  if (state.screen !== 'firstRun') void run({ type: 'loadToday' })
  void run({ type: 'flushOutbox' })
  return { dispatch }
}
```

The timer re-renders once a second, but the Glasses diff only upgrades containers whose text changed (the box), so there's no flicker.

- [ ] **Step 5: Boot file, HTML, Vite, manifest**

`app/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { host: true, port: 5173 }, build: { target: 'esnext' } })
```

`app/index.html` body:
```html
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
```
Keep the existing `<head>`, with its viewport meta and zoom-locking CSS, as is. Remove `#app` styles.

`app/src/main.ts`:
```ts
import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { API_URL } from './config'
import { createApi } from './core/api'
import { Outbox } from './core/outbox'
import { bridgeKV, browserKV, KEYS, type KV } from './core/storage'
import { startLens } from './lens/controller'
import { mountPhone } from './phone/mount'

const BRIDGE_TIMEOUT_MS = 3000

async function boot() {
  const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), BRIDGE_TIMEOUT_MS))])
  const kv: KV = bridge ? bridgeKV(bridge) : browserKV()
  const api = createApi(API_URL, () => kv.get(KEYS.token))
  mountPhone({ api, kv, hasGlasses: Boolean(bridge) })
  if (bridge) await startLens({ bridge, api, kv, outbox: new Outbox(kv) })
}

boot().catch(e => console.error('[boot]', e))
```

`app/src/phone/mount.tsx` (temporary until Task 17 replaces the body of `App`):
```tsx
import { createRoot } from 'react-dom/client'
import type { Api } from '../core/api'
import type { KV } from '../core/storage'
import { App } from './App'

export type PhoneDeps = { api: Api; kv: KV; hasGlasses: boolean }
export function mountPhone(d: PhoneDeps) {
  createRoot(document.getElementById('root')!).render(<App {...d} />)
}
```

`app/src/phone/App.tsx` (minimal here; Task 17 expands it):
```tsx
import type { PhoneDeps } from './mount'
export function App(_: PhoneDeps) {
  return <main style={{ padding: 24, color: '#e5e5e5' }}>MatSide is running. Check the glasses.</main>
}
```

`app/app.json`:
```json
{
  "package_id": "com.matside.app",
  "edition": "202601",
  "name": "MatSide",
  "version": "0.1.0",
  "min_sdk_version": "0.0.16",
  "entrypoint": "index.html",
  "permissions": [
    { "name": "g2-microphone", "desc": "Record short voice notes about students while you teach." },
    { "name": "network", "desc": "Send notes to the MatSide service that runs your agents.", "whitelist": ["https://REPLACE-WITH-API-ORIGIN"] }
  ],
  "supported_languages": ["en"]
}
```
`https://REPLACE-WITH-API-ORIGIN` is replaced with the real origin in Task 20 Step 1; `evenhub pack` must never run with it in place.

`app/.env.example`:
```
VITE_API_URL=https://matside-api.vercel.app
```

- [ ] **Step 6: Tests, typecheck, simulator**

Run: `npm test -w app && npm run typecheck -w app`
Expected: PASS.

Then:
1. Start the API locally (`npm run dev -w api` with `api/.env.local`). Without a deployed API yet, `VITE_API_URL=http://localhost:8787`.
2. Run `cd app && VITE_API_URL=http://localhost:8787 npm run dev`.
3. In another terminal: `evenhub-simulator http://localhost:5173`.
4. To pair in a desktop browser at `http://localhost:5173`, temporarily open the console and run `localStorage.setItem('matside.token', '<token from smoke.sh>')`. Task 17 adds the real pairing UI.

Expected in the simulator:
- first-run panel → tap → home with the class → tap → attendance panel;
- the simulator has no mic, so double-tap to skip;
- drill layout A with a counting-down timer;
- swipe → deck list → click an item → drill switches;
- double-tap → "End class?" → tap → wrap-up.

Take simulator screenshots of each screen for the Devpost into `docs/screens/`.

- [ ] **Step 7: Commit**

```bash
git add app docs/screens
git commit -m "feat(app): lens renderer, gesture mapping, glasses adapter, controller

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Phone shell: theme, tabs, pairing, Today, Agents

**Files:**
- Create: `app/src/phone/theme.css`, `app/src/phone/usePoll.ts`, `app/src/phone/Pairing.tsx`, `app/src/phone/Today.tsx`, `app/src/phone/Agents.tsx`, `app/src/phone/RosterCheckIn.tsx`
- Modify: `app/src/phone/App.tsx`, `app/src/phone/mount.tsx` (import css)

**Interfaces:**
- Consumes: `Api`, `KV`, `KEYS`, `bus`, shared types.
- Produces:
  - `usePoll<T>(fn: () => Promise<T>, ms: number | null, deps?: unknown[]): { data: T | null; error: string | null; reload(): void }`
  - `<App>` with tabs `today | review | agents | students` and `deckOpen` state; it renders `<DeckEditor>` (Task 19) when open.

- [ ] **Step 1: Theme**

`app/src/phone/theme.css`:
```css
:root { --bg: #232323; --card: #2f2f2f; --line: #3a3a3a; --text: #e5e5e5; --muted: #9a9a9a; --accent: #3dff7a; --danger: #ffb4b4; --danger-bg: #5a2a2a; --warn: #e8d36a; --radius: 12px; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.4 -apple-system, system-ui, sans-serif; }
.screen { padding: 20px 16px 88px; max-width: 560px; margin: 0 auto; }
h1 { font-size: 26px; margin: 0 0 2px; color: #fff; }
.sub { color: var(--muted); font-size: 13px; margin-bottom: 14px; }
.card { background: var(--card); border-radius: var(--radius); padding: 12px 14px; margin-bottom: 10px; }
.label { color: var(--muted); font-size: 11px; letter-spacing: .06em; text-transform: uppercase; margin-bottom: 4px; }
.dot::before { content: '●'; color: var(--accent); margin-right: 6px; }
.row { display: flex; align-items: center; gap: 8px; }
.grow { flex: 1; }
.muted { color: var(--muted); font-size: 13px; }
.pill { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 99px; background: var(--line); margin-right: 6px; }
.pill.high { background: var(--danger-bg); color: var(--danger); }
.btns { display: flex; gap: 8px; margin-top: 10px; }
button { font: inherit; border: 0; border-radius: 10px; padding: 10px 12px; background: var(--line); color: var(--text); flex: 1; cursor: pointer; transition: transform .1s, filter .15s; }
button:active { transform: scale(.97); }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button.primary { background: var(--accent); color: #0b0b0b; font-weight: 600; }
button:disabled { opacity: .5; }
input, textarea { font: inherit; width: 100%; background: var(--line); color: var(--text); border: 0; border-radius: 8px; padding: 9px 10px; }
.feed { border-left: 2px solid var(--accent); padding-left: 10px; margin-bottom: 14px; }
.feed.error { border-color: var(--danger); }
.tabs { position: fixed; bottom: 0; left: 0; right: 0; height: 64px; background: #1a1a1a; display: flex; padding-bottom: env(safe-area-inset-bottom); }
.tabs button { background: none; color: #8a8a8a; border-radius: 0; font-size: 12px; }
.tabs button[aria-current='page'] { color: var(--accent); }
.drill { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--line); }
.error { color: var(--danger); }
```

- [ ] **Step 2: Poll hook**

`app/src/phone/usePoll.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'

export function usePoll<T>(fn: () => Promise<T>, ms: number | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(() => setTick(t => t + 1), [])
  useEffect(() => {
    let alive = true
    const load = () => fnRef.current().then(d => { if (alive) { setData(d); setError(null) } }, e => { if (alive) setError(e instanceof Error ? e.message : 'Failed') })
    void load()
    const id = ms ? setInterval(load, ms) : null
    return () => { alive = false; if (id) clearInterval(id) }
  }, [ms, tick, ...deps]) // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload }
}
```

- [ ] **Step 3: Pairing, Today, roster check-in, Agents, App**

`app/src/phone/Pairing.tsx`:
```tsx
import { useState } from 'react'
import type { Api } from '../core/api'
import { ApiError } from '../core/api'
import { bus } from '../core/bus'
import { KEYS, type KV } from '../core/storage'

export function Pairing({ api, kv, onPaired }: { api: Api; kv: KV; onPaired(): void }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setErr(null)
    try {
      const { token } = await api.pair(code.trim())
      await kv.set(KEYS.token, token)
      bus.emit('paired', undefined)
      onPaired()
    } catch (e) {
      setErr(e instanceof ApiError && e.status === 401 ? 'That code didn’t match.' : 'Can’t reach MatSide. Check your connection.')
    } finally { setBusy(false) }
  }
  return (
    <main className="screen">
      <h1>MatSide</h1>
      <p className="sub">Enter your pairing code to connect this phone and your glasses.</p>
      <input inputMode="numeric" autoComplete="one-time-code" aria-label="Pairing code" value={code} onChange={e => setCode(e.target.value)} placeholder="Pairing code" />
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button className="primary" disabled={!code || busy} onClick={submit}>{busy ? 'Pairing…' : 'Pair'}</button></div>
    </main>
  )
}
```

`app/src/phone/RosterCheckIn.tsx`:
```tsx
import { useState } from 'react'
import type { RosterStudent } from '@matside/shared'
import type { Api } from '../core/api'

export function RosterCheckIn({ api, sessionId, roster, onDone }: { api: Api; sessionId: string; roster: RosterStudent[]; onDone(): void }) {
  const [present, setPresent] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const toggle = (id: string) => setPresent(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  async function save() {
    try { await api.attendance(sessionId, [...present]); onDone() } catch { setErr('Couldn’t save attendance. Try again.') }
  }
  return (
    <div className="card">
      <div className="label">Tap who's here · {present.size}/{roster.length}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {roster.map(s => (
          <button key={s.id} aria-pressed={present.has(s.id)} className={present.has(s.id) ? 'primary' : ''} onClick={() => toggle(s.id)}>{s.name.split(' ')[0]}</button>
        ))}
      </div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns"><button onClick={onDone}>Cancel</button><button className="primary" onClick={save}>Save check-in</button></div>
    </div>
  )
}
```

`app/src/phone/Today.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Api } from '../core/api'
import { bus } from '../core/bus'
import { usePoll } from './usePoll'
import { RosterCheckIn } from './RosterCheckIn'

export function Today({ api, onOpenDeck }: { api: Api; onOpenDeck(deckId: string): void }) {
  const { data: t, error, reload } = usePoll(() => api.today(), 15000)
  const [checkIn, setCheckIn] = useState(false)
  useEffect(() => bus.on('sessionChanged', () => reload()), [reload])
  if (error) return <main className="screen"><p className="error">Couldn’t load today: {error}</p><button onClick={reload}>Retry</button></main>
  if (!t) return <main className="screen"><p className="muted">Loading…</p></main>
  async function openCheckIn() {
    if (!t!.sessionId) { const s = await api.startSession(t!.classId); bus.emit('sessionChanged', s.sessionId) }
    setCheckIn(true)
  }
  const mins = t.deck.drills.reduce((n, d) => n + d.minutes, 0)
  return (
    <main className="screen">
      <h1>Today</h1>
      <div className="sub">{t.className} · {t.startTime} · {t.roster.length} enrolled{t.sessionId ? ' · class in progress' : ''}</div>
      <section className="card"><div className="label">This week</div><b>Theme: {t.theme}</b> · Forms: {t.formsDue.join(', ') || '—'}</section>
      <section className="card"><div className="label">Focus (from your notes)</div>
        {t.focus.length ? t.focus.map(f => <div key={f.label} className="dot">{f.label}</div>) : <div className="muted">No open focus areas.</div>}
      </section>
      <section className="card" role="button" tabIndex={0} onClick={() => onOpenDeck(t.deck.id)} onKeyDown={e => e.key === 'Enter' && onOpenDeck(t.deck.id)}>
        <div className="row"><b className="grow">Drill deck</b><span className="muted">{t.deck.drills.length} drills · {mins} min · edit ›</span></div>
        {t.deck.drills.slice(0, 4).map(d => <div className="drill" key={d.id}><span>{d.name}</span><span className="muted">{d.minutes}m</span></div>)}
      </section>
      {checkIn && t.sessionId
        ? <RosterCheckIn api={api} sessionId={t.sessionId} roster={t.roster} onDone={() => { setCheckIn(false); reload() }} />
        : <div className="btns"><button onClick={openCheckIn}>Roster check-in</button><button className="primary" onClick={() => bus.emit('startClass', undefined)}>Start on glasses</button></div>}
    </main>
  )
}
```

`RosterCheckIn` needs `sessionId`, which comes from today's reload after `startSession` emits `sessionChanged`. Until the reload lands, `checkIn && t.sessionId` stays false. That's acceptable; the button press triggers the reload.

`app/src/phone/Agents.tsx`:
```tsx
import type { Api } from '../core/api'
import { usePoll } from './usePoll'

const LABEL: Record<string, string> = { router: 'Router agent', progress: 'Progress agent', parent_email: 'Parent email agent', planner: 'Planner agent', billing: 'Billing agent', attendance: 'Attendance', report_card: 'Report card agent', mailer: 'Mailer' }
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

export function Agents({ api }: { api: Api }) {
  const { data, error } = usePoll(() => api.feed(), 2000)
  return (
    <main className="screen">
      <h1>Agents at work</h1>
      <div className="sub">{data ? `${data.length} recent actions · live` : 'Loading…'}</div>
      {error && <p className="error">{error}</p>}
      {data?.map(r => (
        <article key={r.id} className={`feed ${r.status === 'error' ? 'error' : ''}`}>
          <div className="row"><b className="grow">{LABEL[r.agent] ?? r.agent}</b><span className="muted">{time(r.createdAt)}</span></div>
          <div>{r.summary}</div>
          <div className="muted">{r.reason}</div>
        </article>
      ))}
    </main>
  )
}
```

`app/src/phone/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { KEYS } from '../core/storage'
import type { PhoneDeps } from './mount'
import { Pairing } from './Pairing'
import { Today } from './Today'
import { Agents } from './Agents'

type Tab = 'today' | 'review' | 'agents' | 'students'

export function App({ api, kv }: PhoneDeps) {
  const [paired, setPaired] = useState<boolean | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [deckId, setDeckId] = useState<string | null>(null)
  useEffect(() => { void kv.get(KEYS.token).then(t => setPaired(Boolean(t))) }, [kv])
  if (paired === null) return null
  if (!paired) return <Pairing api={api} kv={kv} onPaired={() => setPaired(true)} />
  return (
    <>
      {tab === 'today' && <Today api={api} onOpenDeck={setDeckId} />}
      {tab === 'agents' && <Agents api={api} />}
      {tab === 'review' && <main className="screen"><h1>Review</h1></main>}
      {tab === 'students' && <main className="screen"><h1>Students</h1></main>}
      <nav className="tabs" aria-label="MatSide">
        {(['today', 'review', 'agents', 'students'] as Tab[]).map(t => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
        ))}
      </nav>
      {deckId && <div hidden>{deckId}</div>}
    </>
  )
}
```
Tasks 18–19 replace the Review and Students placeholders and the `deckId` stub.

In `mount.tsx`, add `import './theme.css'` at the top.

- [ ] **Step 4: Verify**

Run: `npm run typecheck -w app && npm test -w app`
Then `VITE_API_URL=<API_URL> npm run dev -w app` and open `http://localhost:5173` in the browser pane at 375 px wide (mobile preset). Check:
- pairing with the code → Today shows theme, focus, deck;
- the Agents tab updates within 2 s after running `api/scripts/smoke.sh`.

- [ ] **Step 5: Commit**

```bash
git add app/src/phone
git commit -m "feat(app): phone shell with pairing, today, roster check-in, live agents feed

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Phone Review and Students

**Files:**
- Create: `app/src/phone/Review.tsx`, `app/src/phone/Students.tsx`, `app/src/phone/StudentDetail.tsx`
- Modify: `app/src/phone/App.tsx` (swap placeholders, add badge count)

**Interfaces:**
- Consumes: `api.review/approve/skip/approveAll/handleBilling/noteBilling/assignNote/dismissNote/acceptDiff/undoDiff/students/student/runReportCards`.
- Produces:
  - `<Review api />`
  - `<Students api />`
  - `<StudentDetailView api id onBack />`
  - `<DiffList diff />`, exported from `Review.tsx` and reused in Task 19

- [ ] **Step 1: Review**

`app/src/phone/Review.tsx`:
```tsx
import { useState } from 'react'
import type { DeckDiff, ReviewItem } from '@matside/shared'
import type { Api } from '../core/api'
import { usePoll } from './usePoll'

export function DiffList({ diff }: { diff: DeckDiff }) {
  return (
    <div>
      {diff.removed.map(r => <div key={r.drillId} className="drill"><s className="muted">{r.drillId.slice(0, 6)}…</s><span className="pill high">removed · {r.reason}</span></div>)}
      {diff.changed.map(c => <div key={c.drillId} className="drill"><span>{c.after.name} · {c.after.minutes}m</span><span className="pill" style={{ color: 'var(--warn)' }}>changed · {c.reason}</span></div>)}
      {diff.added.map((a, i) => <div key={i} className="drill"><span>{a.name} · {a.minutes}m</span><span className="pill" style={{ color: 'var(--accent)' }}>added · {a.reason}</span></div>)}
    </div>
  )
}

function Email({ api, item, done }: { api: Api; item: Extract<ReviewItem, { kind: 'parent_email' | 'report_card' }>; done(): void }) {
  const [edit, setEdit] = useState(false)
  const [subject, setSubject] = useState(item.subject)
  const [body, setBody] = useState(item.body)
  const [err, setErr] = useState<string | null>(null)
  const act = async (f: () => Promise<unknown>) => { setErr(null); try { await f(); done() } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } }
  return (
    <article className="card">
      <span className="pill">{item.kind === 'report_card' ? 'Report card' : 'Parent email'}</span><span className="muted">{item.studentName} · to {item.to}</span>
      {edit ? (<><input aria-label="Subject" value={subject} onChange={e => setSubject(e.target.value)} style={{ marginTop: 8 }} /><textarea aria-label="Body" rows={8} value={body} onChange={e => setBody(e.target.value)} style={{ marginTop: 8 }} /></>)
        : (<><div style={{ marginTop: 6 }}><b>{subject}</b></div><div className="muted" style={{ whiteSpace: 'pre-wrap' }}>{body}</div></>)}
      {err && <p className="error" role="alert">{err}</p>}
      <div className="btns">
        <button onClick={() => setEdit(!edit)}>{edit ? 'Done' : 'Edit'}</button>
        <button onClick={() => act(() => api.skip(item.id))}>Skip</button>
        <button className="primary" onClick={() => act(() => api.approve(item.id, { subject, body }))}>Send</button>
      </div>
    </article>
  )
}

export function Review({ api }: { api: Api }) {
  const { data, error, reload } = usePoll(() => api.review(), 5000)
  const { data: students } = usePoll(() => api.students(), null)
  const [note, setNote] = useState<Record<string, string>>({})
  const act = async (f: () => Promise<unknown>) => { try { await f() } finally { reload() } }
  const emails = data?.filter(i => i.kind === 'parent_email' || i.kind === 'report_card') ?? []
  return (
    <main className="screen">
      <h1>Review</h1>
      <div className="sub">{data ? `${data.length} items` : 'Loading…'}</div>
      {error && <p className="error">{error}</p>}
      {emails.length > 1 && <div className="btns" style={{ marginBottom: 10 }}><button className="primary" onClick={() => act(() => api.approveAll())}>Approve all emails ({emails.length})</button></div>}
      {data?.map(item => {
        switch (item.kind) {
          case 'parent_email': case 'report_card': return <Email key={item.id} api={api} item={item} done={reload} />
          case 'billing': return (
            <article key={item.id} className="card">
              <span className={`pill ${item.urgency === 'high' ? 'high' : ''}`}>Billing · {item.urgency.toUpperCase()}</span><span className="muted">{item.studentName}</span>
              <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{item.note}{item.amount != null ? ` · $${item.amount}` : ''}</div>
              <input aria-label="Add note" placeholder="Add a note…" value={note[item.id] ?? ''} onChange={e => setNote({ ...note, [item.id]: e.target.value })} style={{ marginTop: 8 }} />
              <div className="btns">
                <button disabled={!note[item.id]} onClick={() => act(() => api.noteBilling(item.id, note[item.id]!))}>Add note</button>
                <button className="primary" onClick={() => act(() => api.handleBilling(item.id, note[item.id] || undefined))}>Mark handled</button>
              </div>
            </article>)
          case 'unassigned_note': return (
            <article key={item.id} className="card">
              <span className="pill">Unassigned note</span>{item.heard && <span className="muted">heard "{item.heard}"</span>}
              <div style={{ marginTop: 6 }}>{item.text}</div>
              <div className="btns" style={{ flexWrap: 'wrap' }}>
                {students?.slice(0, 14).map(s => <button key={s.id} style={{ flex: '0 0 auto' }} onClick={() => act(() => api.assignNote(item.id, s.id))}>{s.name.split(' ')[0]}</button>)}
                <button onClick={() => act(() => api.dismissNote(item.id))}>Dismiss</button>
              </div>
            </article>)
          case 'deck_diff': return (
            <article key={item.id} className="card">
              <span className="pill">Planner suggestion</span><span className="muted">"{item.requestText}"</span>
              <DiffList diff={item.diff} />
              <div className="btns"><button onClick={() => act(() => api.undoDiff(item.id))}>Dismiss</button><button className="primary" onClick={() => act(() => api.acceptDiff(item.id, false))}>Accept</button></div>
            </article>)
        }
      })}
      {data?.length === 0 && <p className="muted">All caught up.</p>}
    </main>
  )
}
```

- [ ] **Step 2: Students**

`app/src/phone/StudentDetail.tsx`:
```tsx
import type { Api } from '../core/api'
import { usePoll } from './usePoll'

export function StudentDetailView({ api, id, onBack }: { api: Api; id: string; onBack(): void }) {
  const { data: s, error, reload } = usePoll(() => api.student(id), null, [id])
  if (error) return <main className="screen"><button onClick={onBack}>‹ Back</button><p className="error">{error}</p></main>
  if (!s) return <main className="screen"><p className="muted">Loading…</p></main>
  const rc = s.reportCard
  return (
    <main className="screen">
      <button onClick={onBack} style={{ flex: 'none', marginBottom: 10 }}>‹ Students</button>
      <h1>{s.name}</h1>
      <div className="sub">{s.belt} belt · age {s.age} · {s.classCount} classes</div>
      <section className="card"><div className="label">Working on</div>
        {s.issues.filter(i => i.status === 'open').map(i => <div key={i.tag} className="dot">{i.tag} <span className="pill high">recurring</span></div>)}
        {!s.issues.some(i => i.status === 'open') && <div className="muted">Nothing flagged.</div>}
      </section>
      <section className="card"><div className="label">Coach notes</div>
        {s.notes.map((n, i) => <div key={i} style={{ marginBottom: 6 }}><b>{n.date}</b> · {n.drillName ?? 'class'}: “{n.text}”</div>)}
      </section>
      <section className="card"><div className="label">Report card</div>
        {rc ? (<>
          <div><b>{rc.month}</b> · {rc.status.replace('_', ' ')}</div>
          <div className="muted">Strengths: {rc.content.strengths.join(', ')} · Working on: {rc.content.workingOn.join(', ')} · Next goal: {rc.content.nextGoal} · {rc.content.attendance}</div>
          {rc.status === 'pending_review' && <div className="btns"><button className="primary" onClick={async () => { await api.approve(rc.outboxId); reload() }}>Send to parent</button></div>}
        </>) : (
          <div className="btns"><button onClick={async () => { await api.runReportCards([s.id]); setTimeout(reload, 8000) }}>Draft report card now</button></div>
        )}
      </section>
    </main>
  )
}
```

`app/src/phone/Students.tsx`:
```tsx
import { useState } from 'react'
import type { Api } from '../core/api'
import { usePoll } from './usePoll'
import { StudentDetailView } from './StudentDetail'

export function Students({ api }: { api: Api }) {
  const { data, error } = usePoll(() => api.students(), null)
  const [open, setOpen] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  if (open) return <StudentDetailView api={api} id={open} onBack={() => setOpen(null)} />
  return (
    <main className="screen">
      <h1>Students</h1>
      <div className="btns" style={{ marginBottom: 10 }}>
        <button onClick={async () => { const r = await api.runReportCards(); setMsg(`Report card agent drafting ${r.started} cards…`) }}>Run monthly report cards now</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {error && <p className="error">{error}</p>}
      {data?.map(s => (
        <button key={s.id} className="card" style={{ display: 'flex', width: '100%', textAlign: 'left' }} onClick={() => setOpen(s.id)}>
          <span className="grow">{s.name}</span><span className="muted">{s.belt} ›</span>
        </button>
      ))}
    </main>
  )
}
```

In `App.tsx`, replace the two placeholders:
```tsx
{tab === 'review' && <Review api={api} />}
{tab === 'students' && <Students api={api} />}
```
and add the imports `import { Review } from './Review'` and `import { Students } from './Students'`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w app`. Then in the browser pane (375 px):
- After smoke.sh, Review shows Priya's parent email. Send it → it arrives in the `DEMO_EMAIL_OVERRIDE` inbox.
- Billing → Mark handled.
- Students → Priya → Draft report card → after about 8 s the card appears → Send.

- [ ] **Step 4: Commit**

```bash
git add app/src/phone
git commit -m "feat(app): review queue and students with report cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Phone deck editor, drill detail, planner diff

**Files:**
- Create: `app/src/phone/DeckEditor.tsx`, `app/src/phone/DrillDetail.tsx`
- Modify: `app/src/phone/App.tsx` (render `DeckEditor` when `deckId` is set, instead of the hidden stub)

**Interfaces:**
- Consumes: `api.deck/patchDeck/suggest/acceptDiff/undoDiff/alternatives/today`; `DiffList` from `Review.tsx`; `Drill`, `DrillDraft`, `RosterStudent`.
- Produces: `<DeckEditor api deckId onClose />`

Reordering uses ▲▼ buttons. HTML5 drag-and-drop doesn't fire on iOS touch, and the time doesn't justify a touch-DnD library. The "Tell the planner" text field works with iOS keyboard dictation, which covers "voice" there.

- [ ] **Step 1: DrillDetail**

`app/src/phone/DrillDetail.tsx`:
```tsx
import { useState } from 'react'
import type { Drill, DrillDraft, RosterStudent } from '@matside/shared'
import type { Api } from '../core/api'

type Editable = DrillDraft & { id: string | null }

export function DrillDetail({ api, drill, roster, onSave, onDelete, onBack }: { api: Api; drill: Editable; roster: RosterStudent[]; onSave(d: Editable): void; onDelete(): void; onBack(): void }) {
  const [d, setD] = useState<Editable>(drill)
  const [alts, setAlts] = useState<DrillDraft[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const toggle = (id: string) => setD({ ...d, focusStudentIds: d.focusStudentIds.includes(id) ? d.focusStudentIds.filter(x => x !== id) : [...d.focusStudentIds, id] })
  async function loadAlts() {
    if (!d.id) return
    setErr(null)
    try { setAlts((await api.alternatives(d.id)).alternatives) } catch { setErr('Planner unavailable right now.') }
  }
  return (
    <main className="screen">
      <button onClick={onBack} style={{ flex: 'none', marginBottom: 10 }}>‹ Deck</button>
      <h1>{d.name}</h1>
      <div className="sub">{d.rationale || 'Added by you'}</div>
      <section className="card">
        <label className="label" htmlFor="dn">Name</label><input id="dn" maxLength={40} value={d.name} onChange={e => setD({ ...d, name: e.target.value })} />
        <label className="label" htmlFor="dm" style={{ display: 'block', marginTop: 8 }}>Minutes</label>
        <input id="dm" type="number" min={1} max={30} value={d.minutes} onChange={e => setD({ ...d, minutes: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })} />
        <label className="label" htmlFor="dc" style={{ display: 'block', marginTop: 8 }}>Coaching cues on lens (max 2, comma-separated)</label>
        <input id="dc" value={d.cues.join(', ')} onChange={e => setD({ ...d, cues: e.target.value.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2).map(s => s.slice(0, 40)) })} />
        <div className="label" style={{ marginTop: 8 }}>Focus students</div>
        <div className="btns" style={{ flexWrap: 'wrap' }}>
          {roster.map(s => <button key={s.id} style={{ flex: '0 0 auto' }} aria-pressed={d.focusStudentIds.includes(s.id)} className={d.focusStudentIds.includes(s.id) ? 'primary' : ''} onClick={() => toggle(s.id)}>{s.name.split(' ')[0]}</button>)}
        </div>
      </section>
      {d.id && <section className="card">
        <div className="label">⇄ Alternatives from planner</div>
        {alts ? alts.map((a, i) => <button key={i} className="card" style={{ width: '100%', textAlign: 'left' }} onClick={() => setD({ ...a, id: d.id })}>{a.name} · {a.minutes}m<div className="muted">{a.rationale}</div></button>)
          : <button onClick={loadAlts}>Suggest 3 alternatives</button>}
        {err && <p className="error">{err}</p>}
      </section>}
      <div className="btns"><button onClick={onDelete}>Delete</button><button className="primary" disabled={!d.name.trim()} onClick={() => onSave(d)}>Save</button></div>
    </main>
  )
}

export const toEditable = (x: Drill): Editable => ({ id: x.id, name: x.name, minutes: x.minutes, kind: x.kind, cues: x.cues, focusStudentIds: x.focusStudentIds, rationale: x.rationale })
```

- [ ] **Step 2: DeckEditor**

`app/src/phone/DeckEditor.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Deck, DrillDraft, RosterStudent, SuggestResponse } from '@matside/shared'
import type { Api } from '../core/api'
import { DiffList } from './Review'
import { DrillDetail, toEditable } from './DrillDetail'

type Editable = DrillDraft & { id: string | null }
const CHIPS = ['More games', 'Shorter', 'More sparring', 'Low energy day']

export function DeckEditor({ api, deckId, onClose }: { api: Api; deckId: string; onClose(): void }) {
  const [deck, setDeck] = useState<Deck | null>(null)
  const [roster, setRoster] = useState<RosterStudent[]>([])
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [ask, setAsk] = useState('')
  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { void api.deck(deckId).then(setDeck, () => setErr('Couldn’t load deck')); void api.today().then(t => setRoster(t.roster), () => undefined) }, [api, deckId])
  if (!deck) return <main className="screen">{err ? <p className="error">{err}</p> : <p className="muted">Loading…</p>}</main>

  const list: Editable[] = deck.drills.map(toEditable)
  const save = async (next: Editable[]) => {
    setErr(null)
    try { setDeck(await api.patchDeck(deck.id, { drills: next })) } catch { setErr('Couldn’t save. Check your connection.') }
  }
  const move = (i: number, dir: -1 | 1) => { const n = [...list]; const j = i + dir; if (j < 0 || j >= n.length) return; [n[i], n[j]] = [n[j]!, n[i]!]; void save(n) }
  async function suggest(text: string) {
    setBusy(true); setErr(null)
    try { setSuggestion(await api.suggest(deck!.id, text)); setRemember(false) } catch { setErr('Planner unavailable right now.') } finally { setBusy(false) }
  }

  if (editing !== null) {
    const blank: Editable = { id: null, name: 'New drill', minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' }
    const current = editing === 'new' ? blank : list[editing]!
    return <DrillDetail api={api} drill={current} roster={roster} onBack={() => setEditing(null)}
      onDelete={() => { if (editing !== 'new') void save(list.filter((_, i) => i !== editing)); setEditing(null) }}
      onSave={d => { void save(editing === 'new' ? [...list, d] : list.map((x, i) => (i === editing ? d : x))); setEditing(null) }} />
  }

  if (suggestion) {
    return (
      <main className="screen">
        <h1>Planner's changes</h1>
        <div className="sub">You said: “{ask}” · {suggestion.totalBefore} → {suggestion.totalAfter} min</div>
        <section className="card"><DiffList diff={suggestion.diff} /></section>
        {suggestion.diff.rememberSuggestion && (
          <label className="card row"><input type="checkbox" style={{ width: 'auto' }} checked={remember} onChange={e => setRemember(e.target.checked)} /><span>Remember for future decks: <i>“{suggestion.diff.rememberSuggestion}”</i></span></label>
        )}
        {err && <p className="error">{err}</p>}
        <div className="btns">
          <button onClick={async () => { await api.undoDiff(suggestion.diffId); setSuggestion(null) }}>Undo all</button>
          <button onClick={async () => { await api.undoDiff(suggestion.diffId); setSuggestion(null) }}>Tweak</button>
          <button className="primary" onClick={async () => { try { setDeck(await api.acceptDiff(suggestion.diffId, remember)); setSuggestion(null); setAsk('') } catch { setErr('Couldn’t apply changes.') } }}>Accept</button>
        </div>
      </main>
    )
  }

  const mins = list.reduce((n, d) => n + d.minutes, 0)
  return (
    <main className="screen">
      <button onClick={onClose} style={{ flex: 'none', marginBottom: 10 }}>‹ Today</button>
      <h1>Deck · {deck.forDate}</h1>
      <div className="sub">{list.length} drills · {mins} min</div>
      {list.map((d, i) => (
        <div key={d.id ?? i} className="card row">
          <div className="row" style={{ flexDirection: 'column', gap: 2 }}>
            <button aria-label={`Move ${d.name} up`} style={{ padding: '2px 8px' }} onClick={() => move(i, -1)}>▲</button>
            <button aria-label={`Move ${d.name} down`} style={{ padding: '2px 8px' }} onClick={() => move(i, 1)}>▼</button>
          </div>
          <button className="grow" style={{ textAlign: 'left', background: 'none' }} onClick={() => setEditing(i)}>
            <b>{d.name}</b><div className="muted">{d.minutes}m · {d.cues[0] ? `cue: ${d.cues[0]}` : d.kind}{d.focusStudentIds.length ? ` · ${d.focusStudentIds.length} kids` : ''}</div>
          </button>
        </div>
      ))}
      <div className="btns"><button onClick={() => setEditing('new')}>＋ Add drill</button></div>
      <section className="card" style={{ marginTop: 14 }}>
        <div className="label">Tell the planner</div>
        <div className="btns" style={{ flexWrap: 'wrap', marginTop: 0 }}>
          {CHIPS.map(c => <button key={c} style={{ flex: '0 0 auto' }} disabled={busy} onClick={() => { setAsk(c); void suggest(c) }}>{c}</button>)}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input aria-label="Tell the planner" placeholder="e.g. they were wild last class, more structure" value={ask} onChange={e => setAsk(e.target.value)} />
          <button className="primary" style={{ flex: 'none' }} disabled={busy || ask.trim().length < 2} onClick={() => suggest(ask.trim())}>{busy ? '…' : 'Ask'}</button>
        </div>
        {err && <p className="error">{err}</p>}
      </section>
    </main>
  )
}
```

In `App.tsx`:
- replace `{deckId && <div hidden>{deckId}</div>}` with an early return placed before the tab content: `if (deckId) return <DeckEditor api={api} deckId={deckId} onClose={() => setDeckId(null)} />`, positioned after the pairing check;
- add `import { DeckEditor } from './DeckEditor'`.

- [ ] **Step 3: Verify**

Run: `npm run typecheck -w app`. In the browser pane (375 px), check:
- Today → deck → ▲▼ reorders and persists after a reload;
- tap a drill → edit cues → Save → the cue shows on the glasses (simulator) after the next deck load;
- "More sparring" chip → diff view → Accept;
- "Suggest 3 alternatives" works.

- [ ] **Step 4: Commit**

```bash
git add app/src/phone
git commit -m "feat(app): deck editor with drill detail, alternatives, planner diff review

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Hardware pass, package, Beta, README, Devpost

**Files:**
- Modify: `app/app.json` (real whitelist origin), `api` env `ALLOWED_ORIGINS`
- Create: `README.md`, `docs/devpost.md`, `app/public/icon.png` (if packaging requires it)

- [ ] **Step 1: Point the app at production**

1. Replace `https://REPLACE-WITH-API-ORIGIN` in `app/app.json` with the API origin, e.g. `https://matside-api.vercel.app` (no trailing slash, no path).
2. Create `app/.env.production` with `VITE_API_URL=<same origin>`.
3. Run `grep -n REPLACE app/app.json`. Expected: no output.

- [ ] **Step 2: Real G2 via QR (iPhone, same network or phone hotspot)**

```bash
cd ~/lahacks/app && npm run dev
evenhub qr --url "http://$(ipconfig getifaddr en0):5173"
```
Scan with Even app → Scan QR. Run this checklist on the glasses and tick each item:
- [ ] First run shows the welcome panel (never black). Pair on the phone with `PAIRING_CODE`.
- [ ] Tap → Start → say "Everyone except Jake and Mia" → `12 present / absent: Jake, Mia`.
- [ ] Tap → drill layout A, timer counting.
- [ ] Tap, say "Priya, guard drops on the jab again, great energy though", tap → agent card ≤3 s → the Agents tab on the phone fills in.
- [ ] Long-press to talk works, or the OS menu takes it (then tap-to-talk is the documented path).
- [ ] Say "Leo's dad still owes for sparring gear, kinda urgent" → `✓ Billing flag · Leo · HIGH`.
- [ ] Say a garbled name ("Mya, kicks higher") → two-choice list → pick works.
- [ ] Lock the phone 5 min mid-drill → unlock → timer is correct, app responsive, a note recorded while locked syncs (`● Saved · will sync` → feed shows it).
- [ ] Deny mic in iOS settings → "Mic unavailable" status, phone still works; re-enable.
- [ ] Double-tap → confirm → wrap-up shows coverage and missed → tap → home. Double-tap on home → system exit dialog.

For anything that fails, use `superpowers:systematic-debugging`. Read the WebView console via the Even app developer tools or by adding `console.log` to the Agents feed.

- [ ] **Step 3: Lock CORS to the real origin**

Temporarily add `console.log('[cors] origin', c.req.header('origin'))` at the top of the `/v1/*` auth middleware. Deploy, make one request from the glasses, and read `vercel logs <url>`.

Then:
```bash
printf '<origin from logs>' | vercel env rm ALLOWED_ORIGINS production -y && printf '<origin from logs>' | vercel env add ALLOWED_ORIGINS production
```
Remove the log line, redeploy (`vercel deploy --prod`), and re-test one note from the glasses.

If the origin is `null` or absent (custom scheme), keep `*`. Requests are still bearer-token authenticated and no cookies are used; note this in the README.

- [ ] **Step 4: Package and Beta**

```bash
cd ~/lahacks/app && npm run build && npx evenhub pack app.json dist
```
Expected: a `.ehpk` file.
- If pack complains about a missing icon, create a 24×24 greyscale `public/icon.png` (simple "M" glyph) and re-run. Check the packaging docs at https://hub.evenrealities.com/docs/ship/packaging for the exact icon field.
- **Developer portal** (https://evenhub.evenrealities.com/, the user signs in): create the project "MatSide" → Builds → upload the `.ehpk` → create a Beta group with the phone account email → push the build.
- **Phone:** Me → Beta tester → install → rerun the Step 2 checklist on the installed Beta (lock/resume, permission denial, root double-tap exit).

- [ ] **Step 5: README**

`README.md` must include:
- One-paragraph pitch and the hero loop.
- Architecture diagram (from the spec, §5).
- **Install & run on G2:**
  1. Join the Beta: send the team your Even account email, or use the provided loaner.
  2. Install MatSide from Me → Beta tester.
  3. Open MatSide on the phone, enter the pairing code `<given to judges at the table>`.
  4. Put on the G2 and tap.
  - No API keys are needed by testers.
- Local dev:
  - `npm install`, `api/.env.example` vars, `npm run dev -w api`, `npm run dev -w app`, `evenhub-simulator http://localhost:5173`, `npm test`.
- Policy notes: billing is flags only, parent emails need approval, demo emails go to a single owned inbox.
- Credits and research citations (link `docs/research.md`).

- [ ] **Step 6: Devpost text + demo video**

Write `docs/devpost.md`:
- What it does, the problem with numbers, how it fits the Even track (Why G2), how we built it, challenges, what's next.
- Even Hub name: **MatSide**.

Record the 2–3 min video following spec §8: through-the-lens footage or the simulator, plus the phone screen. Upload it. Submit Devpost with the Even Realities challenge selected **before 12:00 PM**.

- [ ] **Step 7: Final commit and push**

```bash
git add -A
git commit -m "docs: README with G2 install steps, devpost write-up, production manifest

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
gh repo create matside --public --source . --push
```
Before running `gh repo create`, confirm with the user. It publishes the repo publicly, which Devpost requires. Then add the repo URL to Devpost.
