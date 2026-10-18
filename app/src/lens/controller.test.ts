import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImuReportPace, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Today } from '@matside/shared'
import { ApiError, type Api } from '../core/api'
import { Outbox } from '../core/outbox'
import { KEYS, memoryKV } from '../core/storage'
import { startLens, TICK_MS, type LensBridge, type LensHandle } from './controller'
import { PEEK_MS } from './reducer'

const today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft', drills: [
    { id: 'd1', position: 1, name: 'Tag', minutes: 2, kind: 'warmup', cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
    { id: 'd2', position: 2, name: 'Holds', minutes: 4, kind: 'technique', cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
  ] },
} as Today
const cov = { covered: 0, present: 12 }
const wrap = { sessionId: 's1', minutes: 40, drillsRun: 2, coverage: cov, missed: [], agentActions: 0, pendingReview: 0 }

function fakeBridge() {
  let handler: (e: EvenHubEvent) => void = () => {}
  const sent: string[] = []
  const bridge = {
    createStartUpPageContainer: vi.fn(async (c: { textObject?: { containerName?: string; content?: string }[] }) => { sent.push(`create:${c.textObject?.map(t => t.content).join('|')}`); return 0 }),
    rebuildPageContainer: vi.fn(async (c: { textObject?: { containerName?: string; content?: string }[] }) => { sent.push(`rebuild:${c.textObject?.map(t => t.content).join('|')}`); return true }),
    textContainerUpgrade: vi.fn(async (c: { containerName?: string; content?: string }) => { sent.push(`upgrade:${c.containerName}=${c.content}`); return true }),
    audioControl: vi.fn(async () => true),
    imuControl: vi.fn(async () => true),
    shutDownPageContainer: vi.fn(async () => true),
    onEvenHubEvent: vi.fn((cb: (e: EvenHubEvent) => void) => { handler = cb; return () => { handler = () => {} } }),
  }
  return { bridge: bridge as unknown as LensBridge, raw: bridge, sent, emit: (e: Record<string, unknown>) => handler(e as EvenHubEvent) }
}

function fakeApi(over: Partial<Record<keyof Api, unknown>> = {}) {
  return {
    today: vi.fn(async () => today),
    startSession: vi.fn(async () => ({ sessionId: 's1', startedAt: new Date().toISOString(), coverage: cov, nextStudent: null })),
    endSession: vi.fn(async () => wrap),
    logDrill: vi.fn(async () => ({ ok: true })),
    utterance: vi.fn(async () => { throw new ApiError(422, 'empty_transcript') }),
    remind: vi.fn(async () => ({ ok: true })),
    ...over,
  } as unknown as Api
}

const tap = { sysEvent: {} }
const dbl = { sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }
const imu = (y: number) => ({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: { x: 0, y, z: 1 } } })
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('lens controller', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })

  async function boot(api = fakeApi(), firstRunSeen = true) {
    const kv = memoryKV()
    if (firstRunSeen) await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), tilt: { axis: 'y', threshold: 0.5 } })
    await flush()
    return { ...b, kv, api }
  }

  it('first run paints instructions immediately, tap → home with "Not paired" when the API rejects', async () => {
    const api = fakeApi({ today: vi.fn(async () => { throw new ApiError(401, 'bad token') }) })
    const b = await boot(api, false)
    expect(b.sent[0]).toContain('WELCOME TO COACHLENS')
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain('Not paired')
    expect(await b.kv.get(KEYS.firstRunSeen)).toBe('1')
  })

  it('offline home shows Offline and does not crash', async () => {
    const { NetworkError } = await import('../core/api')
    const b = await boot(fakeApi({ today: vi.fn(async () => { throw new NetworkError('x') }) }))
    expect(b.sent.join('\n')).toContain('Offline')
  })

  it('startSession failure dispatches actionFailed so a retry is possible', async () => {
    const startSession = vi.fn(async () => { throw new ApiError(500, 'boom') })
    const b = await boot(fakeApi({ startSession }))
    b.emit(tap); await flush()
    b.emit(tap); await flush()
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(b.sent.join('\n')).toContain('Server error 500')
  })

  async function toDark() {
    const b = await boot()
    b.emit(tap); await flush() // start class → attendance (mic)
    b.emit(dbl); await flush() // skip roll call → peek
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    return b
  }

  it('session start turns IMU on at P500; skip roll call peeks then goes dark', async () => {
    const b = await toDark()
    expect(b.raw.imuControl).toHaveBeenCalledWith(true, ImuReportPace.P500)
    expect(b.sent.at(-1)).toBe('rebuild:')
  })

  it('never repaints while dark, even across many ticks', async () => {
    const b = await toDark()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(TICK_MS * 4)
    expect(b.sent.length).toBe(n)
  })

  it('head tilt (held) peeks, then hides after PEEK_MS', async () => {
    const b = await toDark()
    b.emit(imu(0.8)); await vi.advanceTimersByTimeAsync(500)
    b.emit(imu(0.8)); await flush()
    expect(b.sent.at(-1)).toMatch(/^rebuild:STANCES/)
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    expect(b.sent.at(-1)).toBe('rebuild:')
  })

  it('a single IMU spike does nothing', async () => {
    const b = await toDark()
    const n = b.sent.length
    b.emit(imu(0.9)); await vi.advanceTimersByTimeAsync(500)
    b.emit(imu(0.0)); await flush()
    expect(b.sent.length).toBe(n)
  })

  it('timerEnded peeks when the active drill runs out', async () => {
    const b = await boot()
    b.emit(tap); await flush()
    // fake a resumed drill: start first drill via deck
    b.emit(dbl); await flush()
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    b.emit({ textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }); await flush()
    b.emit({ listEvent: {} }); await flush() // select drill 0 (2 min)
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    expect(b.sent.at(-1)).toBe('rebuild:')
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(b.sent.join('\n')).toContain('Time · next: Holds')
  })

  it('endSession failure shows a peek instead of a stuck spinner; success turns IMU off', async () => {
    const endSession = vi.fn().mockRejectedValueOnce(new ApiError(500, 'x')).mockResolvedValueOnce(wrap)
    const b = await boot(fakeApi({ endSession }))
    b.emit(tap); await flush()
    b.emit(dbl); await flush()
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    b.emit(dbl); await flush() // confirmEnd
    b.emit(tap); await flush() // end → fails
    expect(b.sent.join('\n')).toContain("Couldn't end class")
    await vi.advanceTimersByTimeAsync(PEEK_MS)
    b.emit(dbl); await flush()
    b.emit(tap); await flush() // end → succeeds
    expect(b.sent.join('\n')).toContain('CLASS DONE · 40 min')
    expect(b.raw.imuControl).toHaveBeenLastCalledWith(false)
  })

  it('an empty transcript (422) from a note shows a retry peek, not a stuck "Sending"', async () => {
    const b = await toDark()
    b.emit(tap); await flush() // recording
    for (let i = 0; i < 20; i++) b.emit({ audioEvent: { audioPcm: new Uint8Array(1000) } })
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain("Didn't catch that")
  })

  it('resume re-arms the IMU and an open mic', async () => {
    const b = await toDark()
    b.emit(tap); await flush() // recording: mic open
    b.raw.imuControl.mockClear(); b.raw.audioControl.mockClear()
    b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
    expect(b.raw.imuControl).toHaveBeenCalledWith(true, ImuReportPace.P500)
    expect(b.raw.audioControl).toHaveBeenCalledWith(true, expect.anything())
  })

  it('home double-tap exits via shutDownPageContainer(1)', async () => {
    const b = await boot()
    b.emit(dbl); await flush()
    expect(b.raw.shutDownPageContainer).toHaveBeenCalledWith(1)
  })
})
