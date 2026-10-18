import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Today } from '@matside/shared'
import { ApiError, NetworkError, type Api } from '../core/api'
import { bus } from '../core/bus'
import { Outbox } from '../core/outbox'
import { KEYS, memoryKV } from '../core/storage'
import { IDLE_DARK_MS, RESULT_CARD_MS } from '../config'
import { STATUS_MS } from './reducer'
import { parseDisplayMode, startLens, type LensBridge, type LensHandle } from './controller'

const today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft', drills: [
    { id: 'd1', position: 1, name: 'Tag', minutes: 20, kind: 'warmup', cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
  ] },
} as unknown as Today
const cov = { covered: 0, present: 12 }
const reply = (id = 'u1') => ({ utteranceId: id, transcript: 'Maya black belt', cardLines: ['√ Maya rank: black'], coverage: cov, nextStudent: null, disambiguation: null })

function fakeBridge() {
  let handler: (e: EvenHubEvent) => void = () => {}
  const sent: string[] = []
  const rec = (k: string) => vi.fn(async (c: { textObject?: { content?: string }[] }) => { sent.push(`${k}:${c.textObject?.map(t => t.content).join('|')}`); return k === 'create' ? 0 : true })
  const bridge = {
    createStartUpPageContainer: rec('create'), rebuildPageContainer: rec('rebuild'),
    textContainerUpgrade: vi.fn(async (c: { containerName?: string; content?: string }) => { sent.push(`upgrade:${c.containerName}=${c.content}`); return true }),
    audioControl: vi.fn(async () => true), imuControl: vi.fn(async () => true), shutDownPageContainer: vi.fn(async () => true),
    onEvenHubEvent: vi.fn((cb: (e: EvenHubEvent) => void) => { handler = cb; return () => { handler = () => {} } }),
  }
  return { bridge: bridge as unknown as LensBridge, sent, emit: (e: Record<string, unknown>) => handler(e as EvenHubEvent) }
}
function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  return {
    today: vi.fn(async () => today), classes: vi.fn(async () => []), health: vi.fn(async () => ({ ok: true })),
    startSession: vi.fn(async () => ({ sessionId: 's1', startedAt: new Date().toISOString(), coverage: cov, nextStudent: null })),
    logDrill: vi.fn(async () => ({ ok: true })), utteranceRuns: vi.fn(async () => null),
    utterance: vi.fn(async () => reply()), undo: vi.fn(async () => ({ ok: true, reversed: [], cancelled: [], notReversible: [] })),
    ...over,
  } as unknown as Api
}
const tap = { sysEvent: {} }
const dbl = { sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }
const pcm = () => ({ audioEvent: { audioPcm: speech() } })
/** 0.5 s of a loud 200 Hz tone (16 kHz s16le): clearly speech-level energy. */
function speech(): Uint8Array {
  const n = 8000, b = new Uint8Array(n * 2), v = new DataView(b.buffer)
  for (let i = 0; i < n; i++) v.setInt16(i * 2, Math.round(6000 * Math.sin((2 * Math.PI * 200 * i) / 16000)), true)
  return b
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('controller · remediation', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })

  async function toPeek(api = fakeApi(), displayMode?: string) {
    const kv = memoryKV()
    await kv.set(KEYS.firstRunSeen, '1')
    if (displayMode) await kv.set(KEYS.displayMode, displayMode)
    const outbox = new Outbox(kv)
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox, nod: { enabled: false, axis: 'y', threshold: 1, windowMs: 1, cooldownMs: 1 }, micDualStart: false, isOnline: () => true })
    await flush()
    b.emit(tap); await flush() // lobby
    b.emit(tap); await flush() // start → roll call
    b.emit(dbl); await flush() // skip → peek
    return { ...b, kv, outbox, api }
  }
  async function recordNote(b: Awaited<ReturnType<typeof toPeek>>, quiet = false) {
    b.emit(tap); await flush()
    await vi.advanceTimersByTimeAsync(700)
    const chunk = quiet ? { audioEvent: { audioPcm: new Uint8Array(16000) } } : pcm()
    b.emit(chunk); b.emit(chunk)
    b.emit(tap); await flush()
    await vi.advanceTimersByTimeAsync(10) // transcribe is absent in the fake: the note goes as audio
  }

  it('parseDisplayMode: quiet unless "standard" is stored', () => {
    expect(parseDisplayMode(null)).toBe('quiet')
    expect(parseDisplayMode('junk')).toBe('quiet')
    expect(parseDisplayMode('standard')).toBe('standard')
  })

  it('quiet (default): the peek goes dark IDLE_DARK_MS after the last change; standard stays lit', async () => {
    const q = await toPeek()
    await vi.advanceTimersByTimeAsync(STATUS_MS + 10) // "Roll call skipped" expires: that is the last change
    const n = q.sent.length
    await vi.advanceTimersByTimeAsync(IDLE_DARK_MS - 100)
    expect(q.sent.slice(n).some(x => x.startsWith('rebuild:') && x.endsWith(':'))).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(q.sent.at(-1)).toBe('rebuild:') // the dark page (one empty container)
    lens?.stop(); lens = null
    const s = await toPeek(fakeApi(), 'standard')
    await vi.advanceTimersByTimeAsync(IDLE_DARK_MS * 3)
    expect(s.sent.at(-1)).not.toBe('rebuild:')
  })

  it('the phone toggle switches the policy live', async () => {
    const b = await toPeek(fakeApi(), 'standard')
    bus.emit('displayModeChanged', 'quiet'); await flush()
    await vi.advanceTimersByTimeAsync(STATUS_MS + IDLE_DARK_MS + 50)
    expect(b.sent.at(-1)).toBe('rebuild:')
  })

  it('quiet: a result card closes itself after RESULT_CARD_MS', async () => {
    const b = await toPeek()
    await recordNote(b)
    expect(b.sent.join('\n')).toContain('Maya rank: black')
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(RESULT_CARD_MS + 50)
    expect(b.sent.slice(n).join('\n')).toMatch(/STANCES/) // back to the peek
  })

  it('F03: the utterance carries the outbox item id; a retry after a lost reply reuses the SAME key', async () => {
    let calls = 0
    const utterance = vi.fn(async () => { calls++; if (calls === 1) throw new NetworkError('response lost'); return reply() })
    const b = await toPeek(fakeApi({ utterance }), 'standard')
    await recordNote(b)
    const [item] = await b.outbox.list()
    expect(item).toBeDefined()
    bus.emit('outboxRetry', undefined); await flush()
    expect(utterance).toHaveBeenCalledTimes(2)
    const keys = utterance.mock.calls.map(c => (c as unknown as [unknown, { opId: string }])[1].opId)
    expect(keys).toEqual([item!.id, item!.id])
    expect(await b.outbox.count()).toBe(0)
  })

  it('F07: a background flush result is visible on the lens; a rejected note is counted as failed', async () => {
    const utterance = vi.fn(async (): Promise<ReturnType<typeof reply>> => { throw new ApiError(429, 'rate_limited') })
    const b = await toPeek(fakeApi({ utterance }), 'standard')
    await recordNote(b)
    expect(b.sent.join('\n')).toContain('server busy, will retry')
    utterance.mockImplementation(async () => reply())
    bus.emit('outboxRetry', undefined); await flush()
    expect(b.sent.join('\n')).toContain('↑ 1 note sent')
    utterance.mockImplementation(async () => { throw new ApiError(413, 'too_large') })
    await recordNote(b)
    expect(b.sent.join('\n')).toContain('Not sent · see phone')
    expect((await b.outbox.failed()).length).toBe(1)
    await flush()
    expect(b.sent.join('\n')).toContain('1 failed')
  })

  it('F02: undo shows "Undoing…" while the server is slow, then its lines; failure offers a retry', async () => {
    let release!: (v: unknown) => void
    const undo = vi.fn(() => new Promise(r => { release = r }))
    const b = await toPeek(fakeApi({ undo }), 'standard')
    await recordNote(b)
    b.emit(dbl); await flush()
    expect(b.sent.at(-1)).toContain('Undoing…')
    await vi.advanceTimersByTimeAsync(5000)
    expect(b.sent.join('\n')).not.toMatch(/UNDONE|Undone/)
    release({ ok: true, reversed: ['Restored Maya rank: brown'], cancelled: [], notReversible: [] }); await flush()
    expect(b.sent.join('\n')).toContain('Restored Maya rank: brown')
    expect(b.sent.join('\n')).toContain('UNDONE')

    undo.mockImplementation(async () => { throw new NetworkError('offline') })
    b.emit(tap); await flush() // close
    await recordNote(b)
    b.emit(dbl); await flush()
    expect(b.sent.join('\n')).toContain('Undo failed · tap to retry')
    undo.mockImplementation(async () => { throw new ApiError(409, 'already_undone') })
    b.emit(tap); await flush() // retry
    expect(undo).toHaveBeenCalledTimes(3)
    expect(b.sent.join('\n')).toContain('Already undone')
  })

  it('#2 low-energy audio is still SENT (the server decides); a 422 for it says "Couldn\'t hear you"', async () => {
    const utterance = vi.fn(async (): Promise<ReturnType<typeof reply>> => { throw new ApiError(422, 'empty_transcript') })
    const b = await toPeek(fakeApi({ utterance }), 'standard')
    await recordNote(b, true)
    expect(utterance).toHaveBeenCalledTimes(1)
    expect(b.sent.join('\n')).toContain("Couldn't hear you")
    utterance.mockImplementation(async () => reply('u9'))
    await recordNote(b, true)
    expect(b.sent.join('\n')).toContain('Maya rank: black') // a quiet clip the server understood is a normal note
  })

  it('#6 Retry while a note is reporting is deferred, not dropped: it flushes right after', async () => {
    let release!: (v: unknown) => void
    const utterance = vi.fn()
      .mockImplementationOnce(async () => { throw new ApiError(503, 'x') }) // an older note: queued
      .mockImplementationOnce(() => new Promise(r => { release = r })) // the next note: slow
      .mockImplementation(async () => reply('u3'))
    const b = await toPeek(fakeApi({ utterance }), 'standard')
    await recordNote(b) // stays queued (503)
    b.emit(tap); await flush(); await vi.advanceTimersByTimeAsync(700); b.emit(pcm()); b.emit(pcm())
    bus.emit('outboxRetry', undefined) // pressed while nothing is reporting yet: forced flush starts (slow)
    await flush()
    b.emit(tap); await flush()
    bus.emit('outboxRetry', undefined) // pressed while the new note is in flight: must not be lost
    release(reply('u2')); await flush(); await flush()
    await vi.advanceTimersByTimeAsync(10)
    expect(await b.outbox.count()).toBe(0)
  })

  it('#7 after re-pairing, held notes go at once (backoff reset, forced flush)', async () => {
    const utterance = vi.fn(async (): Promise<ReturnType<typeof reply>> => { throw new ApiError(401, 'unauthorized') })
    const b = await toPeek(fakeApi({ utterance }), 'standard')
    await recordNote(b)
    expect((await b.outbox.list())[0]!.nextAttemptAt).toBeDefined()
    utterance.mockImplementation(async () => reply())
    bus.emit('paired', undefined); await flush(); await flush()
    expect(await b.outbox.count()).toBe(0)
  })

  it('#8 an older note set aside during the current note\'s flush gets a status line', async () => {
    const b = await toPeek(fakeApi(), 'standard')
    await b.outbox.enqueue({ sessionId: 's1', drillId: null, mode: 'note', audioB64: null, text: 'old one' })
    ;(b.api.utterance as ReturnType<typeof vi.fn>).mockImplementation(async (p: { text: string | null }) => { if (p.text === 'old one') throw new ApiError(400, 'bad'); return reply() })
    await recordNote(b)
    expect(b.sent.join('\n')).toContain('1 note not sent · see phone')
  })
})
