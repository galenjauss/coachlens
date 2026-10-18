import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImuReportPace, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Today } from '@matside/shared'
import { ApiError, type Api } from '../core/api'
import { bus } from '../core/bus'
import { Outbox } from '../core/outbox'
import { KEYS, memoryKV } from '../core/storage'
import { CLASS_ID_KEY } from '../phone/classPref'
import { RUNS_MAX_MS, RUNS_POLL_MS } from './agentRuns'
import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { attendanceChanged, KEEP_WARM_MS, MIC_FALLBACK_MS, MIC_METER_MS, OUTBOX_RETRY_MS, startLens, STOP_DEBOUNCE_MS, TICK_MS, type LensBridge, type LensHandle } from './controller'
import { NetworkError, TRANSCRIBE_TIMEOUT_MS } from '../core/api'
import { INSIGHT_AFTER_ATTENDANCE_MS, INSIGHT_AFTER_ATTENDANCE_LATE_MS, INSIGHT_BANNER_MS, INSIGHT_GLYPH, INSIGHT_POLL_MS, PLAN_CHUNK_MS, PLAN_MAX_MS, QUEUED_GLYPH } from '../config'
import { PLAN_TRANSCRIBE_TIMEOUT_MS } from './planListen'
import { STATUS_MS } from './reducer'

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
    textContainerUpgrade: vi.fn(async (c: { containerName?: string; content?: string; contentOffset?: number; contentLength?: number }) => {
      sent.push(c.contentOffset === undefined ? `upgrade:${c.containerName}=${c.content}` : `partial:${c.containerName}@${c.contentOffset}+${c.contentLength}=${c.content}`)
      return true
    }),
    audioControl: vi.fn(async (_on?: boolean, _src?: string) => true),
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
    classes: vi.fn(async () => []),
    utteranceRuns: vi.fn(async () => []),
    health: vi.fn(async () => ({ ok: true })),
    ...over,
  } as unknown as Api
}

const tap = { sysEvent: {} }
const dbl = { sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }
const imu = (y: number) => ({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: { x: 0.5, y, z: 1 } } })
const swipe = { textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }
const NOD = { enabled: true, axis: 'y' as const, threshold: 0.3, windowMs: 600, cooldownMs: 1200 }
const pcm = (n = 1000) => ({ audioEvent: { audioPcm: new Uint8Array(n) } })
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('lens controller', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })

  async function boot(api = fakeApi(), firstRunSeen = true, opts: { nod?: typeof NOD; micDualStart?: boolean; isOnline?: () => boolean } = {}) {
    const kv = memoryKV()
    if (firstRunSeen) await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: opts.nod ?? NOD, micDualStart: opts.micDualStart, isOnline: opts.isOnline })
    await flush()
    return { ...b, kv, api }
  }

  it('first run paints instructions immediately, tap → home with "Pair on phone" on 401; recovers when the phone pairs', async () => {
    let paired = false
    const api = fakeApi({ today: vi.fn(async () => { if (!paired) throw new ApiError(401, 'bad token'); return today }) })
    const b = await boot(api, false)
    expect(b.sent[0]).toContain('WELCOME TO COACHLENS')
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain('Pair on phone')
    expect(await b.kv.get(KEYS.firstRunSeen)).toBe('1')
    paired = true
    bus.emit('paired', undefined); await flush()
    expect(b.sent.at(-1)).toContain('Kids · Tue')
  })

  describe('first page when unpaired or offline (never black, never an endless spinner)', () => {
    const lastBody = (sent: string[]) => sent.at(-1) ?? ''
    it('no token (401): home says to pair on the phone, with a retry', async () => {
      const b = await boot(fakeApi({ today: vi.fn(async () => { throw new ApiError(401, 'missing token') }) }))
      expect(b.sent[0]).toMatch(/^create:/) // the first page went up at once
      expect(lastBody(b.sent)).toContain('Not paired yet')
      expect(lastBody(b.sent)).toContain('Pair on phone: open CoachLens in the')
      expect(lastBody(b.sent)).toContain('> Tap to retry')
    })
    it('API unreachable: home says it cannot load, names the problem and offers a retry that re-requests', async () => {
      const today = vi.fn(async () => { throw new NetworkError('Failed to fetch') })
      const b = await boot(fakeApi({ today }))
      expect(lastBody(b.sent)).toContain("Can't load class.")
      expect(lastBody(b.sent)).toContain("Offline · check the phone's internet")
      b.emit(tap); await flush()
      expect(today).toHaveBeenCalledTimes(2)
    })
    it('API hanging: "Loading class… Pair on your phone if this stays." until the request times out', async () => {
      const b = await boot(fakeApi({ today: vi.fn(() => new Promise(() => {})) }))
      expect(lastBody(b.sent)).toContain('Loading class…')
      expect(lastBody(b.sent)).toContain('Pair on your phone if this stays.')
    })
    it('bridge storage that never answers still gets the first-run page on the glasses', async () => {
      const kv = { get: vi.fn(() => new Promise<string | null>(() => {})), set: vi.fn(async () => {}) }
      const b = fakeBridge()
      const started = startLens({ bridge: b.bridge, api: fakeApi(), kv, outbox: new Outbox(memoryKV()), nod: NOD })
      await vi.advanceTimersByTimeAsync(3000)
      lens = await started
      await flush()
      expect(b.sent[0]).toContain('WELCOME TO COACHLENS')
      expect(b.sent[0]).toContain('Pair on your phone, then tap here.')
    })
  })

  it('a note the server saved but whose reply was unreadable shows a neutral card and is never resent', async () => {
    const { BadResponseError } = await import('../core/api')
    const utterance = vi.fn(async () => { throw new BadResponseError() })
    const b = await toPeek(fakeApi({ utterance }))
    b.emit(tap); await flush()
    for (let i = 0; i < 20; i++) b.emit({ audioEvent: { audioPcm: new Uint8Array(1000) } })
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain('Saved · details unavailable')
    lens!.dispatch({ type: 'resumed' }); await flush() // flushes the outbox again
    expect(utterance).toHaveBeenCalledTimes(1)
  })

  it('offline home shows Offline and does not crash', async () => {
    const { NetworkError } = await import('../core/api')
    const b = await boot(fakeApi({ today: vi.fn(async () => { throw new NetworkError('x') }) }))
    expect(b.sent.join('\n')).toContain('Offline')
  })

  it('startSession failure dispatches actionFailed so a retry is possible', async () => {
    const startSession = vi.fn(async () => { throw new ApiError(500, 'boom') })
    const b = await boot(fakeApi({ startSession }))
    b.emit(tap); await flush() // lobby
    b.emit(tap); await flush()
    b.emit(tap); await flush()
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(b.sent.join('\n')).toContain('Server error 500')
  })

  /** Start class and skip roll call: the persistent peek. */
  async function toPeek(api = fakeApi(), opts: Parameters<typeof boot>[2] = {}) {
    const b = await boot(api, true, opts)
    b.emit(tap); await flush() // home → lobby
    b.emit(tap); await flush() // start class → attendance (mic)
    b.emit(dbl); await flush() // skip roll call → peek
    return b
  }
  /** A deliberate nod: rest, two dipped samples 150 ms apart, back — all within the window. */
  async function nod(b: Awaited<ReturnType<typeof boot>>) {
    b.emit(imu(0.1)); await vi.advanceTimersByTimeAsync(100)
    b.emit(imu(0.6)); await vi.advanceTimersByTimeAsync(150)
    b.emit(imu(0.6)); await vi.advanceTimersByTimeAsync(100)
    b.emit(imu(0.1)); await flush()
  }
  async function toDark() {
    const b = await toPeek()
    await nod(b)
    return b
  }
  /** In peek with a drill running (deck → first drill, 2 min). */
  async function toDrill(api = fakeApi(), opts: Parameters<typeof boot>[2] = {}) {
    const b = await toPeek(api, opts)
    b.emit(swipe); await flush()
    b.emit({ listEvent: {} }); await flush() // drill detail
    b.emit(tap); await flush() // start it
    return b
  }

  it('session start turns IMU on; skip roll call lands on a persistent peek (never auto-hides)', async () => {
    const b = await toPeek()
    expect(b.raw.imuControl).toHaveBeenCalledWith(true, ImuReportPace.P100)
    expect(b.sent.at(-1)).toMatch(/^rebuild:STANCES/)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(b.sent.some(x => x === 'rebuild:')).toBe(false)
  })

  it('a nod toggles the lens dark, and back to peek', async () => {
    const b = await toPeek()
    await vi.advanceTimersByTimeAsync(STATUS_MS)
    await nod(b)
    expect(b.sent.at(-1)).toBe('rebuild:')
    await vi.advanceTimersByTimeAsync(2000) // past the cooldown
    await nod(b)
    expect(b.sent.at(-1)).toMatch(/^rebuild:STANCES/)
  })

  it('kill switch: with nod disabled, a nod does nothing (samples still reach the readout)', async () => {
    const seen: boolean[] = []
    const off = bus.on('imuSample', p => seen.push(p.nod))
    try {
      const b = await toPeek(fakeApi(), { nod: { ...NOD, enabled: false } })
      const n = b.sent.length
      await nod(b)
      expect(b.sent.slice(n).some(x => x === 'rebuild:')).toBe(false)
      expect(seen).toHaveLength(4)
      expect(seen.every(x => !x)).toBe(true)
    } finally { off() }
  })

  it('a single IMU spike does not toggle', async () => {
    const b = await toPeek()
    const n = b.sent.length
    b.emit(imu(0.1)); await vi.advanceTimersByTimeAsync(100)
    b.emit(imu(0.9)); await vi.advanceTimersByTimeAsync(100)
    b.emit(imu(0.1)); await flush()
    expect(b.sent.slice(n).some(x => x === 'rebuild:')).toBe(false)
  })

  it('a slow tilt (looking down) does not toggle', async () => {
    const b = await toPeek()
    const n = b.sent.length
    for (let i = 0; i <= 30; i++) { b.emit(imu(0.1 + i * 0.02)); await vi.advanceTimersByTimeAsync(100) }
    expect(b.sent.slice(n).some(x => x === 'rebuild:')).toBe(false)
  })

  it('every IMU sample reaches the phone readout via the bus, flagged when it was a nod', async () => {
    const seen: { y: number; nod: boolean }[] = []
    const off = bus.on('imuSample', p => seen.push({ y: p.y, nod: p.nod }))
    try {
      const b = await toPeek()
      await nod(b)
      expect(seen).toEqual([{ y: 0.1, nod: false }, { y: 0.6, nod: false }, { y: 0.6, nod: false }, { y: 0.1, nod: true }])
    } finally { off() }
  })

  it('IMU is on from lens start (home, before class) and off on exit', async () => {
    const b = await boot()
    expect(b.raw.imuControl).toHaveBeenCalledWith(true, ImuReportPace.P100)
    b.emit(dbl); await flush() // home double-tap: exit
    expect(b.raw.imuControl).toHaveBeenLastCalledWith(false)
    expect(b.raw.shutDownPageContainer).toHaveBeenCalledWith(1)
  })

  it('a nod on home turns the lens dark before class; another nod brings home back', async () => {
    const b = await boot()
    await nod(b)
    expect(b.sent.at(-1)).toBe('rebuild:')
    await vi.advanceTimersByTimeAsync(2000)
    await nod(b)
    expect(b.sent.at(-1)).toMatch(/COACHLENS/)
  })

  it('tap in dark wakes the lens and does not open the mic', async () => {
    const b = await toDark()
    b.raw.audioControl.mockClear()
    b.emit(tap); await flush()
    expect(b.sent.at(-1)).toMatch(/^rebuild:STANCES/)
    expect(b.raw.audioControl).not.toHaveBeenCalled()
  })

  it('never repaints while dark, even across many ticks', async () => {
    const b = await toDark()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(TICK_MS * 120)
    expect(b.sent.length).toBe(n)
  })

  it('per-second clock (default): one full upgrade of the small timer container per second, none while dark', async () => {
    const b = await toDrill()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(3100)
    const ticks = b.sent.slice(n)
    expect(ticks).toEqual(['upgrade:timer=1:59 left', 'upgrade:timer=1:58 left', 'upgrade:timer=1:57 left'])
    await nod(b)
    const m = b.sent.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.sent.length).toBe(m)
  })

  it('a 3-minute drill counts down 3:00 → 2:59 → 2:58 → 2:57 → 2:56 … 0:00 → +0:01 over (full-line upgrades)', async () => {
    const t3 = { ...today, deck: { ...today.deck, drills: today.deck.drills.map(x => (x.id === 'd1' ? { ...x, minutes: 3 } : x)) } }
    const b = await toDrill(fakeApi({ today: vi.fn(async () => t3) }))
    expect(b.sent.join('\n')).toContain('3:00 left')
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(4 * TICK_MS + 100)
    expect(b.sent.slice(n)).toEqual(['upgrade:timer=2:59 left', 'upgrade:timer=2:58 left', 'upgrade:timer=2:57 left', 'upgrade:timer=2:56 left'])
    await vi.advanceTimersByTimeAsync(175 * TICK_MS + 100) // now 179.2 s in (0:01 left shown)
    const m = b.sent.length
    await vi.advanceTimersByTimeAsync(2 * TICK_MS + 100)
    expect(b.sent.slice(m).filter(x => x.startsWith('upgrade:timer='))).toEqual(['upgrade:timer=0:00 left', 'upgrade:timer=+0:01 over'])
  })

  it('ticks land on whole seconds of the drill even when it started mid-second', async () => {
    const b = await toPeek()
    await vi.advanceTimersByTimeAsync(400) // the drill starts 400 ms into a tick period
    b.emit(swipe); await flush()
    b.emit({ listEvent: {} }); await flush()
    b.emit(tap); await flush()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(990)
    expect(b.sent.slice(n)).toEqual([]) // no tick lands mid-second
    await vi.advanceTimersByTimeAsync(40) // just past the drill's first whole second
    expect(b.sent.slice(n)).toEqual(['upgrade:timer=1:59 left'])
    await vi.advanceTimersByTimeAsync(1000)
    expect(b.sent.slice(n)).toEqual(['upgrade:timer=1:59 left', 'upgrade:timer=1:58 left'])
  })

  it('the bar is re-sent at most every 5 s', async () => {
    const b = await toDrill()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(30_000)
    const box = b.sent.slice(n).filter(x => x.startsWith('upgrade:box='))
    expect(box.length).toBeGreaterThan(0)
    expect(box.length).toBeLessThanOrEqual(6)
  })

  it('timerEnded shows "next" when the active drill runs out', async () => {
    const b = await toDrill()
    await vi.advanceTimersByTimeAsync(2 * 60_000)
    expect(b.sent.join('\n')).toContain('Time · next: Holds')
  })

  it('endSession failure shows a peek instead of a stuck spinner; success shows wrap-up (IMU stays on for nods)', async () => {
    const endSession = vi.fn().mockRejectedValueOnce(new ApiError(500, 'x')).mockResolvedValueOnce(wrap)
    const b = await toPeek(fakeApi({ endSession }))
    b.emit(dbl); await flush() // confirmEnd
    b.emit(tap); await flush() // end → fails
    expect(b.sent.join('\n')).toContain("Couldn't end class")
    await vi.advanceTimersByTimeAsync(STATUS_MS)
    b.emit(dbl); await flush()
    b.emit(tap); await flush() // end → succeeds
    expect(b.sent.join('\n')).toContain('40 min · 2 drills · 0/12 got feedback')
    expect(b.raw.imuControl).not.toHaveBeenCalledWith(false)
  })

  it('an empty transcript (422) from a note shows a retry peek, not a stuck "Sending"', async () => {
    const b = await toPeek()
    b.emit(tap); await flush() // recording
    for (let i = 0; i < 20; i++) b.emit({ audioEvent: { audioPcm: new Uint8Array(1000) } })
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain("Didn't catch that")
  })

  it('host exit events turn the IMU off; resume re-arms it; stop() turns it off', async () => {
    for (const ev of [OsEventTypeList.FOREGROUND_EXIT_EVENT, OsEventTypeList.ABNORMAL_EXIT_EVENT, OsEventTypeList.SYSTEM_EXIT_EVENT]) {
      const b = await toPeek()
      b.raw.imuControl.mockClear()
      b.emit({ sysEvent: { eventType: ev } }); await flush()
      expect(b.raw.imuControl).toHaveBeenCalledWith(false)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
      expect(b.raw.imuControl).toHaveBeenLastCalledWith(true, ImuReportPace.P100)
      lens!.stop(); await flush()
      expect(b.raw.imuControl).toHaveBeenLastCalledWith(false)
      lens = null
    }
  })

  it('wrap-up tap queues the missed kids and confirms by name once saved', async () => {
    const missed = { ...wrap, missed: [{ id: 'j', name: 'Jake' }, { id: 'l', name: 'Leo' }, { id: 'm', name: 'Mia' }] }
    const remind = vi.fn(async () => ({ ok: true }))
    const b = await toPeek(fakeApi({ endSession: vi.fn(async () => missed), remind }))
    b.emit(dbl); await flush()
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain('Missed: Jake, Leo, Mia')
    expect(b.sent.join('\n')).toContain('tap: put Jake, Leo first next class\n2×: done')
    b.emit(tap); await flush()
    expect(remind).toHaveBeenCalledWith('s1', ['j', 'l', 'm'])
    expect(b.sent.join('\n')).toContain('ok · Jake, Leo, Mia first next class')
  })

  it('resume re-arms the IMU and an open mic', async () => {
    const b = await toPeek()
    b.emit(tap); await flush() // recording: mic open
    b.raw.imuControl.mockClear(); b.raw.audioControl.mockClear()
    b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
    expect(b.raw.imuControl).toHaveBeenCalledWith(true, ImuReportPace.P100)
    expect(b.raw.audioControl).toHaveBeenCalledWith(true, expect.anything())
  })

  it('resume while dark repaints with exactly one full rebuild (never blank and deaf)', async () => {
    const b = await toDark()
    b.raw.rebuildPageContainer.mockClear(); b.raw.createStartUpPageContainer.mockClear()
    b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
    expect(b.raw.rebuildPageContainer.mock.calls.length + b.raw.createStartUpPageContainer.mock.calls.length).toBe(1)
    expect(b.sent.at(-1)).toBe('rebuild:')
  })

  it('todayLoaded with new minutes for the active drill re-arms the drill timer', async () => {
    let t = today
    const b = await toDrill(fakeApi({ today: vi.fn(async () => t) })) // drill d1, 2 min
    t = { ...today, deck: { ...today.deck, drills: today.deck.drills.map(x => (x.id === 'd1' ? { ...x, minutes: 5 } : x)) } }
    lens!.dispatch({ type: 'resumed' }); await flush() // reloads today
    await vi.advanceTimersByTimeAsync(2 * 60_000 + 1000)
    expect(b.sent.join('\n')).not.toContain('Time · next')
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(b.sent.join('\n')).toContain('Time · next: Holds')
  })

  it('home double-tap exits via shutDownPageContainer(1)', async () => {
    const b = await boot()
    b.emit(dbl); await flush()
    expect(b.raw.shutDownPageContainer).toHaveBeenCalledWith(1)
  })

  describe('agent card', () => {
    const okRes = { utteranceId: 'u1', transcript: 'Priya keep your guard up', cardLines: ['√ Priya · guard', '→ parent note for Priya drafting'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null }
    const r = (agent: string) => ({ agent, summary: '', status: 'ok', createdAt: '2026-10-20T17:00:00Z' })
    async function toCard(utteranceRuns: ReturnType<typeof vi.fn>) {
      const b = await toPeek(fakeApi({ utterance: vi.fn(async () => okRes), utteranceRuns }))
      b.emit(tap); await flush() // recording
      for (let i = 0; i < 20; i++) b.emit({ audioEvent: { audioPcm: new Uint8Array(1000) } })
      await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
      b.emit(tap); await flush() // send → card
      return b
    }

    it('stays up (no timeout) with transcript left and agent progress right, polled every 2 s', async () => {
      const utteranceRuns = vi.fn().mockResolvedValueOnce([r('router')]).mockResolvedValue([r('router'), r('progress')])
      const b = await toCard(utteranceRuns)
      expect(b.sent.join('\n')).toContain('"Priya keep your guard up"')
      expect(b.sent.join('\n')).toContain('ok sorted · .. email')
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS)
      expect(b.sent.at(-1)).toBe('upgrade:agents=ok sorted · ok logged · .. email\ntap: close · 2×: undo')
      expect(utteranceRuns).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(b.sent.some(x => x.startsWith('rebuild:STANCES'))).toBe(true) // (from before the card)
      expect(b.sent.filter(x => x.startsWith('rebuild:')).at(-1)).toMatch(/Priya keep your guard up/) // still the card
    })

    it('stops polling after 30 s', async () => {
      const utteranceRuns = vi.fn(async () => [r('router')])
      await toCard(utteranceRuns)
      await vi.advanceTimersByTimeAsync(RUNS_MAX_MS + 10_000)
      expect(utteranceRuns).toHaveBeenCalledTimes(RUNS_MAX_MS / RUNS_POLL_MS + 1)
    })

    it('stops polling as soon as every expected agent reported', async () => {
      const utteranceRuns = vi.fn().mockResolvedValueOnce([r('router')]).mockResolvedValue([r('router'), r('progress'), r('parent_email')])
      const b = await toCard(utteranceRuns)
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS * 5)
      expect(utteranceRuns).toHaveBeenCalledTimes(2)
      expect(b.sent.at(-1)).toBe('upgrade:agents=ok sorted · ok logged · ok email\ntap: close · 2×: undo')
    })

    it('stops polling when the endpoint is missing (404 → null) and shows the server card lines', async () => {
      const utteranceRuns = vi.fn(async () => null)
      const b = await toCard(utteranceRuns)
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS * 5)
      expect(utteranceRuns).toHaveBeenCalledTimes(1)
      expect(b.sent.join('\n').replace(/\n/g, ' ')).toContain('√ Priya · guard · → parent note for Priya drafting')
    })

    it('stops polling once the card is tapped away', async () => {
      const utteranceRuns = vi.fn(async () => [r('router')])
      const b = await toCard(utteranceRuns)
      b.emit(tap); await flush()
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS * 5)
      expect(utteranceRuns).toHaveBeenCalledTimes(1)
      expect(b.sent.at(-1)).toMatch(/^rebuild:STANCES/)
    })
  })

  describe('class choice on home', () => {
    const classes = [{ id: 'c1', name: 'Kids · Tue', mode: 'martial_arts', modeLabel: 'Martial arts' }, { id: 'c2', name: 'PT · Sam', mode: 'personal_training', modeLabel: 'Personal training' }]
    it('swipe saves the class, tells the phone, loads its day; tap starts it', async () => {
      const todayFor = vi.fn(async (id?: string) => (id === 'c2' ? { ...today, classId: 'c2', className: 'PT · Sam' } : today))
      const startSession = vi.fn(async () => ({ sessionId: 's1', startedAt: new Date().toISOString(), coverage: cov, nextStudent: null }))
      const changed: (string | null)[] = []
      const off = bus.on('classChanged', id => changed.push(id))
      try {
        const b = await boot(fakeApi({ classes: vi.fn(async () => classes), today: todayFor, startSession }))
        expect(b.sent.join('\n')).toContain('COACHLENS (1/2)')
        b.emit(swipe); await flush()
        expect(await b.kv.get(CLASS_ID_KEY)).toBe('c2')
        expect(changed).toEqual(['c2'])
        expect(todayFor).toHaveBeenLastCalledWith('c2')
        expect(b.sent.join('\n')).toContain('PT · Sam')
        b.emit(tap); await flush() // lobby
        b.emit(tap); await flush()
        expect(startSession).toHaveBeenCalledWith('c2')
      } finally { off() }
    })
  })

  describe('recording robustness (BLE)', () => {
    it('pauses the per-second ticks while recording and sending; ticks resume on the peek', async () => {
      const b = await toDrill()
      await vi.advanceTimersByTimeAsync(1100)
      b.emit(tap); await flush() // recording
      b.emit(pcm())
      const n = b.sent.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(b.sent.slice(n).filter(x => x.startsWith('upgrade:timer=') || x.startsWith('upgrade:hdr='))).toEqual([]) // static time
      expect(b.sent.slice(n).every(x => x.startsWith('upgrade:mic='))).toBe(true) // only the small mic line moves
      b.emit(dbl); await flush() // cancel → peek
      const m = b.sent.length
      await vi.advanceTimersByTimeAsync(2000)
      expect(b.sent.slice(m).filter(x => x.startsWith('upgrade:timer=')).length).toBe(2)
    })

    it('mic line: waiting until audio arrives, then ● LISTENING pulsing ●/○ once per 500 ms tick with m:ss counting up', async () => {
      const b = await toPeek()
      b.emit(tap); await flush()
      expect(b.sent.at(-1)).toContain('○ waiting for mic…')
      const n = b.sent.length
      await vi.advanceTimersByTimeAsync(100)
      b.emit(pcm(3200))
      for (let i = 0; i < 40; i++) { b.emit(pcm(3200)); await vi.advanceTimersByTimeAsync(100) } // 4.1 s in
      const mic = b.sent.slice(n).filter(x => x.startsWith('upgrade:mic='))
      expect(b.sent.slice(n).every(x => x.startsWith('upgrade:mic='))).toBe(true) // the only lens update while recording
      expect(mic.length).toBeLessThanOrEqual(4100 / MIC_METER_MS) // ≤ 1 update per 500 ms
      expect(mic.slice(0, 4)).toEqual(['upgrade:mic=○ LISTENING  0:00', 'upgrade:mic=● LISTENING  0:01', 'upgrade:mic=○ LISTENING  0:01', 'upgrade:mic=● LISTENING  0:02'])
      expect(mic.at(-1)).toBe('upgrade:mic=● LISTENING  0:04')
    })

    it('thinking stage line: heard → sending (request out) → thinking after 1.5 s, dots cycle per 500 ms; then the card', async () => {
      let answer: (v: unknown) => void = () => {}
      const okRes = { utteranceId: 'u1', transcript: 'Priya guard up', cardLines: ['√ Priya · guard'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null }
      const utterance = vi.fn(() => new Promise(r => { answer = r }))
      const b = await toPeek(fakeApi({ utterance }))
      b.emit(tap); await flush()
      for (let i = 0; i < 20; i++) b.emit(pcm())
      await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
      const n = b.sent.length
      b.emit(tap); await flush()
      const body = () => b.sent.slice(n).filter(x => x.includes('> agents')).map(x => x.split(/[|=]/).find(seg => seg.includes('> agents')))
      expect(body()).toEqual(['HEARD· > sending > thinking > agents', 'heard > SENDING· > thinking > agents']) // stop, then the request goes out
      expect(utterance).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(MIC_METER_MS * 4)
      expect(body()).toEqual(['HEARD· > sending > thinking > agents', 'heard > SENDING· > thinking > agents', 'heard > SENDING·· > thinking > agents', 'heard > SENDING··· > thinking > agents',
        'heard > sending > THINKING· > agents', 'heard > sending > THINKING·· > agents'])
      answer(okRes); await flush()
      expect(b.sent.slice(n).join('\n')).toContain('Priya guard up')
      const m = b.sent.length
      await vi.advanceTimersByTimeAsync(MIC_METER_MS * 4)
      expect(b.sent.slice(m).some(x => x.includes('> agents'))).toBe(false) // ticks stop with the card
    })

    const SEQ = { micDualStart: false } // the sequential fallback (MIC_DUAL_START off)
    it('sequential: no glasses audio within 1.5 s → switches to the phone mic and says so', async () => {
      const b = await toPeek(fakeApi(), SEQ)
      b.emit(tap); await flush()
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS - 100)
      expect(b.raw.audioControl).not.toHaveBeenCalledWith(true, AudioInputSource.Phone)
      await vi.advanceTimersByTimeAsync(200)
      expect(b.raw.audioControl).toHaveBeenLastCalledWith(true, AudioInputSource.Phone)
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toBe('upgrade:mic=○ waiting for phone mic…')
    })

    it('sequential: the switch closes the glasses mic first; a late glasses chunk after it is ignored, phone audio counts', async () => {
      const b = await toPeek(fakeApi(), SEQ)
      b.emit(tap); await flush()
      b.raw.audioControl.mockClear()
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS + 100)
      expect(b.raw.audioControl.mock.calls).toEqual([[false], [true, AudioInputSource.Phone]])
      b.emit({ audioEvent: { audioPcm: new Uint8Array(3200).fill(200), source: AudioInputSource.Glasses } }) // late glasses audio
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toBe('upgrade:mic=○ waiting for phone mic…')
      b.emit({ audioEvent: { audioPcm: new Uint8Array(3200).fill(200), source: AudioInputSource.Phone } })
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toMatch(/^upgrade:mic=[●○] LISTENING \(phone\) {2}0:0\d$/)
    })

    it('sequential: glasses audio arriving in time → no phone fallback', async () => {
      const b = await toPeek(fakeApi(), SEQ)
      b.emit(tap); await flush()
      b.emit(pcm())
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS * 2)
      expect(b.raw.audioControl).not.toHaveBeenCalledWith(true, AudioInputSource.Phone)
    })

    it('debounce: a stop tap within 600 ms keeps recording; a later tap sends', async () => {
      const utterance = vi.fn(async () => { throw new ApiError(422, 'empty_transcript') })
      const b = await toPeek(fakeApi({ utterance }))
      b.emit(tap); await flush() // recording
      b.raw.audioControl.mockClear()
      await vi.advanceTimersByTimeAsync(300)
      b.emit(tap); await flush() // double-trigger: ignored
      expect(b.sent.at(-1)).not.toContain('Sending')
      expect(b.raw.audioControl).not.toHaveBeenCalledWith(false)
      for (let i = 0; i < 20; i++) b.emit(pcm())
      await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
      b.emit(tap); await flush()
      expect(b.raw.audioControl).toHaveBeenCalledWith(false)
      expect(utterance).toHaveBeenCalledTimes(1)
    })

    it('sequential: no audio at all → says the glasses sent nothing (never reaches the API)', async () => {
      const utterance = vi.fn()
      const b = await toPeek(fakeApi({ utterance, }), SEQ)
      b.raw.audioControl.mockImplementation(async (on?: boolean, src?: string) => !(on && src === AudioInputSource.Phone)) // phone mic refused too
      b.emit(tap); await flush()
      await vi.advanceTimersByTimeAsync(2000)
      b.emit(tap); await flush()
      expect(b.sent.join('\n')).toContain('No audio from glasses')
      expect(utterance).not.toHaveBeenCalled()
    })
  })

  /** Record one note: tap, the given audio events, wait out the debounce, tap to stop. */
  async function say(b: Awaited<ReturnType<typeof boot>>, events: Record<string, unknown>[]) {
    b.emit(tap); await flush()
    for (const e of events) b.emit(e)
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
    b.emit(tap); await flush()
  }
  const chunk = (source: string, fill: number, n = 1000) => ({ audioEvent: { audioPcm: new Uint8Array(n).fill(fill), source } })
  const twenty = (e: Record<string, unknown>) => Array.from({ length: 20 }, () => e)
  /** First PCM byte of the WAV sent as an utterance (after the 44-byte header). */
  const sentFill = async (utterance: ReturnType<typeof vi.fn>) => new Uint8Array(await (utterance.mock.calls[0]![0] as { audio: Blob }).audio.arrayBuffer())[44]
  const okRes = { utteranceId: 'u1', transcript: 'Priya guard up', cardLines: ['√ Priya · guard'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null }
  /** The payload of the first utterance call. */
  const firstPayload = (fn: { mock: { calls: unknown[][] } }) => fn.mock.calls[0]![0] as { text: string | null; audio: Blob | null }

  describe('dual-mic start', () => {
    it('opens the glasses and phone mics together; stop releases both', async () => {
      const b = await toPeek()
      b.raw.audioControl.mockClear()
      b.emit(tap); await flush()
      expect(b.raw.audioControl.mock.calls).toEqual([[true, AudioInputSource.Glasses], [true, AudioInputSource.Phone]])
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS * 2)
      expect(b.raw.audioControl).toHaveBeenCalledTimes(2) // no sequential switch
      b.raw.audioControl.mockClear()
      b.emit(tap); await flush()
      expect(b.raw.audioControl.mock.calls).toEqual([[false, AudioInputSource.Glasses], [false, AudioInputSource.Phone], [false]])
    })

    it('stop keeps the glasses audio when it has ≥ 0.4 s, even if the phone heard more', async () => {
      const utterance = vi.fn(async () => okRes)
      const b = await toPeek(fakeApi({ utterance }))
      await say(b, [...twenty(chunk(AudioInputSource.Glasses, 7)), ...twenty(chunk(AudioInputSource.Phone, 9)), ...twenty(chunk(AudioInputSource.Phone, 9))])
      expect(await sentFill(utterance)).toBe(7)
    })

    it('stop uses the phone audio when the glasses sent < 0.4 s', async () => {
      const utterance = vi.fn(async () => okRes)
      const b = await toPeek(fakeApi({ utterance }))
      await say(b, [chunk(AudioInputSource.Glasses, 7), ...twenty(chunk(AudioInputSource.Phone, 9))])
      expect(await sentFill(utterance)).toBe(9)
    })

    it('the mic line says "(phone)" once only the phone has heard anything for 1.5 s', async () => {
      const b = await toPeek()
      b.emit(tap); await flush()
      b.emit(chunk(AudioInputSource.Phone, 1, 3200))
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toMatch(/^upgrade:mic=[●○] LISTENING {2}0:00$/)
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS)
      expect(b.sent.at(-1)).toMatch(/^upgrade:mic=[●○] LISTENING \(phone\) {2}0:0\d$/)
    })
  })

  describe('transcript-first', () => {
    it('shows "You said" from /v1/transcribe at once, then sends ONE text utterance and fills the card', async () => {
      let answer: (v: unknown) => void = () => {}
      const transcribe = vi.fn(async () => 'Priya guard up')
      const utterance = vi.fn(() => new Promise(r => { answer = r }))
      const b = await toPeek(fakeApi({ transcribe, utterance }))
      const n = b.sent.length
      await say(b, twenty(pcm()))
      expect(transcribe).toHaveBeenCalledTimes(1)
      expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), { sessionId: 's1' })
      expect(utterance).toHaveBeenCalledTimes(1)
      expect(transcribe.mock.invocationCallOrder[0]!).toBeLessThan(utterance.mock.invocationCallOrder[0]!)
      expect(utterance).toHaveBeenCalledWith({ sessionId: 's1', drillId: null, mode: 'note', text: 'Priya guard up', audio: null })
      const shown = b.sent.slice(n).join('\n')
      expect(shown).toContain('Priya guard up') // before the reply
      expect(shown).toContain('… sorting')
      const m = b.sent.length
      answer(okRes); await flush()
      expect(b.sent.slice(m).join('\n')).toContain('√ Priya · guard')
      lens!.dispatch({ type: 'resumed' }); await flush() // flushes again: nothing left to send
      expect(utterance).toHaveBeenCalledTimes(1)
    })

    it('the audio is saved (held) before transcribe answers: concurrent flushes skip it, success swaps it to text', async () => {
      let heard: (v: string) => void = () => {}
      const transcribe = vi.fn(() => new Promise<string>(r => { heard = r }))
      const utterance = vi.fn(async () => okRes)
      const b = await toPeek(fakeApi({ transcribe, utterance }))
      await say(b, twenty(pcm()))
      const saved = await new Outbox(b.kv).list()
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({ form: { text: null, audioB64: expect.any(String) }, holdUntil: expect.any(Number) })
      bus.emit('outboxRetry', undefined); await flush()
      lens!.dispatch({ type: 'resumed' }); await flush()
      expect(utterance).not.toHaveBeenCalled() // held, and the note is in flight
      heard('Priya guard up'); await flush()
      expect(utterance).toHaveBeenCalledTimes(1)
      expect(firstPayload(utterance)).toMatchObject({ text: 'Priya guard up', audio: null })
      expect(await new Outbox(b.kv).count()).toBe(0)
    })

    it('killed during the transcribe window: the next start sends the saved audio once the hold expires', async () => {
      const b = await toPeek(fakeApi({ transcribe: vi.fn(() => new Promise(() => {})) }))
      await say(b, twenty(pcm()))
      lens!.stop(); lens = null // app killed mid-transcribe: only what storage holds survives
      const disk = memoryKV()
      await disk.set(KEYS.firstRunSeen, '1')
      await disk.set(KEYS.outbox, (await b.kv.get(KEYS.outbox))!)
      expect(await new Outbox(disk).count()).toBe(1)
      await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS + 2000)
      const utterance = vi.fn(async () => okRes)
      const nb = fakeBridge()
      lens = await startLens({ bridge: nb.bridge, api: fakeApi({ utterance }), kv: disk, outbox: new Outbox(disk), nod: NOD })
      await flush()
      expect(utterance).toHaveBeenCalledTimes(1)
      expect(firstPayload(utterance).audio).toBeInstanceOf(Blob)
    })

    it('a transcribe failure falls back to sending the audio (once)', async () => {
      const transcribe = vi.fn(async () => { throw new ApiError(500, 'stt down') })
      const utterance = vi.fn(async () => okRes)
      const b = await toPeek(fakeApi({ transcribe, utterance }))
      await say(b, twenty(pcm()))
      expect(utterance).toHaveBeenCalledTimes(1)
      const p = firstPayload(utterance)
      expect(p.text).toBeNull()
      expect(p.audio).toBeInstanceOf(Blob)
      expect(b.sent.slice(-3).join('\n')).toContain('√ Priya · guard')
    })

    it('a transcribe slower than 5 s falls back to the audio', async () => {
      const transcribe = vi.fn(() => new Promise(() => {}))
      const utterance = vi.fn(async () => okRes)
      const b = await toPeek(fakeApi({ transcribe, utterance }))
      await say(b, twenty(pcm()))
      expect(utterance).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS)
      expect(utterance).toHaveBeenCalledTimes(1)
      expect(firstPayload(utterance).audio).toBeInstanceOf(Blob)
    })

    it('offline skips transcribe and queues the audio directly', async () => {
      const transcribe = vi.fn(async () => 'x')
      const utterance = vi.fn(async () => { throw new NetworkError('offline') })
      const b = await toPeek(fakeApi({ transcribe, utterance }), { isOnline: () => false })
      await say(b, twenty(pcm()))
      expect(transcribe).not.toHaveBeenCalled()
      expect(firstPayload(utterance).audio).toBeInstanceOf(Blob)
      expect(b.sent.join('\n')).toContain('Saved · will sync')
    })

    it('an empty transcript (422) says so and sends nothing', async () => {
      const transcribe = vi.fn(async () => { throw new ApiError(422, 'empty_transcript') })
      const utterance = vi.fn()
      const b = await toPeek(fakeApi({ transcribe, utterance }))
      await say(b, twenty(pcm()))
      expect(utterance).not.toHaveBeenCalled()
      expect(b.sent.join('\n')).toContain("Didn't catch that")
    })
  })

  describe('offline queue', () => {
    /** The most recent peek status row sent (a rebuild carries every container). */
    const lastStatus = (b: Awaited<ReturnType<typeof boot>>) => b.sent.filter(x => x.startsWith('upgrade:next=') || x.startsWith('rebuild:')).at(-1) ?? ''
    it(`peek shows "${QUEUED_GLYPH} 1 queued", retries every 20 s, and clears once sent`, async () => {
      let up = false
      const utterance = vi.fn(async () => { if (!up) throw new NetworkError('offline'); return okRes })
      const counts: number[] = []
      const off = bus.on('outboxChanged', n => counts.push(n))
      try {
        const b = await toPeek(fakeApi({ utterance }))
        await say(b, twenty(pcm()))
        expect(lastStatus(b)).toContain(`${QUEUED_GLYPH} 1 queued`)
        await vi.advanceTimersByTimeAsync(OUTBOX_RETRY_MS)
        expect(utterance).toHaveBeenCalledTimes(2) // still offline: kept
        up = true
        await vi.advanceTimersByTimeAsync(OUTBOX_RETRY_MS)
        expect(utterance).toHaveBeenCalledTimes(3)
        expect(lastStatus(b)).not.toContain('queued')
        expect(counts.slice(-2)).toEqual([1, 0])
        await vi.advanceTimersByTimeAsync(OUTBOX_RETRY_MS * 3)
        expect(utterance).toHaveBeenCalledTimes(3) // nothing left: no more retries
      } finally { off() }
    })

    it('no retries while the app is suspended; they resume on return', async () => {
      const utterance = vi.fn(async () => { throw new NetworkError('offline') })
      const b = await toPeek(fakeApi({ utterance }))
      await say(b, twenty(pcm()))
      expect(utterance).toHaveBeenCalledTimes(1)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } }); await flush()
      await vi.advanceTimersByTimeAsync(OUTBOX_RETRY_MS * 3)
      expect(utterance).toHaveBeenCalledTimes(1)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush() // resume flushes once
      const n = utterance.mock.calls.length
      await vi.advanceTimersByTimeAsync(OUTBOX_RETRY_MS)
      expect(utterance.mock.calls.length).toBe(n + 1)
    })

    it('the phone "Retry now" flushes the outbox', async () => {
      let up = false
      const utterance = vi.fn(async () => { if (!up) throw new NetworkError('offline'); return okRes })
      const b = await toPeek(fakeApi({ utterance }))
      await say(b, twenty(pcm()))
      up = true
      bus.emit('outboxRetry', undefined); await flush()
      expect(utterance).toHaveBeenCalledTimes(2)
      expect(lastStatus(b)).not.toContain('queued')
    })
  })

  describe('keep-warm', () => {
    it('pings /health every 4 min during a session; stops on app suspend and on session end', async () => {
      const health = vi.fn(async () => ({ ok: true }))
      const b = await boot(fakeApi({ health }))
      await vi.advanceTimersByTimeAsync(KEEP_WARM_MS)
      expect(health).not.toHaveBeenCalled() // no session yet
      b.emit(tap); await flush() // lobby
      b.emit(tap); await flush() // start class
      b.emit(dbl); await flush() // skip roll call
      await vi.advanceTimersByTimeAsync(KEEP_WARM_MS * 2)
      expect(health).toHaveBeenCalledTimes(2)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } }); await flush()
      await vi.advanceTimersByTimeAsync(KEEP_WARM_MS * 2)
      expect(health).toHaveBeenCalledTimes(2)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
      await vi.advanceTimersByTimeAsync(KEEP_WARM_MS)
      expect(health).toHaveBeenCalledTimes(3)
      b.emit(dbl); await flush() // confirm end
      b.emit(tap); await flush() // end → wrap-up
      b.emit(tap); await flush() // done → home (session over)
      await vi.advanceTimersByTimeAsync(KEEP_WARM_MS * 2)
      expect(health).toHaveBeenCalledTimes(3)
    })
  })

  describe('planning listen (lobby 2×)', () => {
    type Deferred = { blob: Blob; resolve(t: string): void; reject(e: unknown): void }
    /** transcribe() whose calls the test settles one by one, in any order. */
    function controlledTranscribe() {
      const calls: Deferred[] = []
      const fn = vi.fn((blob: Blob) => new Promise<string>((resolve, reject) => { calls.push({ blob, resolve, reject }) }))
      return { fn, calls }
    }
    const planRes = (diffId: string | null = 'd9') => ({ diffId, deckId: 'k1', lines: ['+ Sprawls · 5m'] })
    const speak = (b: { emit(e: Record<string, unknown>): void }, chunks: number) => { for (let i = 0; i < chunks; i++) b.emit(pcm(1000)) }
    async function toPlanning(over: Partial<Record<keyof Api, unknown>>) {
      const api = fakeApi({ voicePlan: vi.fn(async () => planRes()), undoDiff: vi.fn(async () => ({ ok: true })), ...over })
      const b = await boot(api, true, { micDualStart: false })
      b.emit(tap); await flush() // lobby
      b.emit(dbl); await flush() // planning listen
      return b
    }

    it('cuts a chunk every 20 s (only new audio), joins transcripts in order (even when they finish out of order), includes the remainder, then applies', async () => {
      const t = controlledTranscribe()
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe: t.fn, voicePlan })
      expect(b.sent.at(-1)).toContain('● Planning · 0:00')
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      speak(b, 30); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      expect(t.fn).toHaveBeenCalledTimes(2)
      expect(t.calls.map(c => c.blob.size)).toEqual([44 + 20000, 44 + 30000])
      expect(t.fn).toHaveBeenCalledWith(expect.any(Blob), { classId: 'c1' }, PLAN_TRANSCRIBE_TIMEOUT_MS)
      t.calls[1]!.resolve('add sprawls'); await flush() // the second chunk lands first
      t.calls[0]!.resolve('swap tag'); await flush()
      expect(b.sent.join('\n')).toContain('swap tag add sprawls')
      speak(b, 15)
      b.emit(tap); await flush() // stop and apply
      expect(t.calls).toHaveLength(3)
      expect(t.calls[2]!.blob.size).toBe(44 + 15000) // the remainder since the last cut
      expect(voicePlan).not.toHaveBeenCalled() // waits for every chunk
      t.calls[2]!.resolve('then kata'); await flush()
      expect(voicePlan).toHaveBeenCalledWith('c1', 'swap tag add sprawls then kata')
      expect(b.sent.slice(-3).join('\n')).toContain('PLAN UPDATED')
    })

    it('a failed chunk is retried once; a chunk failing twice is dropped and the rest still applies', async () => {
      let n = 0
      const transcribe = vi.fn(async () => {
        n += 1
        if (n === 1) throw new ApiError(500, 'boom') // chunk 1, first try
        if (n === 2) return 'one' // chunk 1, retry
        if (n === 3 || n === 4) throw new NetworkError('x') // chunk 2, both tries
        return 'three' // the remainder
      })
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe, voicePlan })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      speak(b, 20); b.emit(tap); await flush()
      expect(transcribe).toHaveBeenCalledTimes(5)
      expect(voicePlan).toHaveBeenCalledWith('c1', 'one three')
    })

    it('a chunk that failed twice is counted: the result says part of the talk was missed', async () => {
      let n = 0
      const transcribe = vi.fn(async () => { n += 1; if (n <= 2) throw new NetworkError('x'); return 'add kata' })
      const b = await toPlanning({ transcribe })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      speak(b, 20); b.emit(tap); await flush()
      expect(b.sent.slice(-3).join('\n')).toContain('Part of the talk was missed')
    })

    it('every chunk failing says "Couldn\'t transcribe · check connection"; a 422 alone does not count as missed', async () => {
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe: vi.fn(async () => { throw new NetworkError('x') }), voicePlan })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      b.emit(tap); await flush()
      expect(voicePlan).not.toHaveBeenCalled()
      expect(b.sent.at(-1)).toContain("Couldn't transcribe · check connection")
    })

    it('the header ticks every 5 s in whole 5 s steps (still between ticks)', async () => {
      const b = await toPlanning({ transcribe: vi.fn(async () => 'x') })
      const n = b.sent.length
      await vi.advanceTimersByTimeAsync(4900)
      expect(b.sent.length).toBe(n)
      await vi.advanceTimersByTimeAsync(200)
      expect(b.sent.slice(n)).toEqual(['upgrade:hdr=● Planning · 0:05'])
      await vi.advanceTimersByTimeAsync(5000)
      expect(b.sent.at(-1)).toBe('upgrade:hdr=● Planning · 0:10')
    })

    it('leaving the app mid-listen cancels it: the mic closes, nothing applies, the lobby says why', async () => {
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe: vi.fn(async () => 'x'), voicePlan })
      speak(b, 20)
      b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } }); await flush()
      expect(b.raw.audioControl).toHaveBeenLastCalledWith(false)
      expect(b.sent.at(-1)).toContain('Planning stopped · app left')
      await vi.advanceTimersByTimeAsync(PLAN_MAX_MS)
      expect(voicePlan).not.toHaveBeenCalled()
    })

    it('stops and applies on its own at the 3-minute cap, releasing the mic and reloading today', async () => {
      const transcribe = vi.fn(async () => 'warmup longer')
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe, voicePlan })
      const todayCalls = vi.mocked(b.api.today).mock.calls.length
      speak(b, 20)
      await vi.advanceTimersByTimeAsync(PLAN_MAX_MS)
      expect(voicePlan).toHaveBeenCalledTimes(1)
      expect(voicePlan).toHaveBeenCalledWith('c1', 'warmup longer')
      expect(b.raw.audioControl).toHaveBeenLastCalledWith(false)
      expect(vi.mocked(b.api.today).mock.calls.length).toBeGreaterThan(todayCalls)
      expect(b.sent.slice(-3).join('\n')).toContain('PLAN UPDATED')
      await vi.advanceTimersByTimeAsync(PLAN_MAX_MS) // nothing keeps cutting or ticking
      expect(transcribe).toHaveBeenCalledTimes(1)
    })

    it('cancel (2×) releases the mic, drops late transcripts and never applies', async () => {
      const t = controlledTranscribe()
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe: t.fn, voicePlan })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      b.emit(dbl); await flush()
      expect(b.raw.audioControl).toHaveBeenLastCalledWith(false)
      expect(b.sent.at(-1)).toContain('Planning cancelled')
      t.calls[0]!.resolve('late words'); await flush()
      await vi.advanceTimersByTimeAsync(PLAN_MAX_MS)
      expect(voicePlan).not.toHaveBeenCalled()
      expect(b.sent.join('\n')).not.toContain('late words')
    })

    it('nothing heard returns to the lobby without calling the plan API', async () => {
      const voicePlan = vi.fn(async () => planRes())
      const b = await toPlanning({ transcribe: vi.fn(async () => { throw new ApiError(422, 'empty_transcript') }), voicePlan })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      b.emit(tap); await flush()
      expect(voicePlan).not.toHaveBeenCalled()
      expect(b.sent.at(-1)).toContain("Didn't catch that")
    })

    it('undo on the result calls diff undo; a 409 shows the server message', async () => {
      const undoDiff = vi.fn(async () => { throw new ApiError(409, 'plan changed since') })
      const b = await toPlanning({ transcribe: vi.fn(async () => 'add kata'), undoDiff })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      b.emit(tap); await flush()
      b.emit(dbl); await flush()
      expect(undoDiff).toHaveBeenCalledWith('d9')
      expect(b.sent.at(-1)).toContain('plan changed since')
    })

    it('a successful undo says "Plan change undone" on the lobby', async () => {
      const b = await toPlanning({ transcribe: vi.fn(async () => 'add kata') })
      speak(b, 20); await vi.advanceTimersByTimeAsync(PLAN_CHUNK_MS)
      b.emit(tap); await flush()
      b.emit(dbl); await flush()
      expect(b.sent.at(-1)).toContain('Plan change undone')
    })
  })
})

describe('lens controller · insights', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers(); vi.restoreAllMocks() })

  const insight = (id: string, o: Record<string, unknown> = {}) => ({
    id, kind: 'no_feedback', studentId: 'j', studentName: 'Jake', classId: 'c1', title: 'Jake: no feedback in 3 classes',
    detail: 'Last note Oct 2', urgency: 'high', status: 'new', createdAt: '2026-10-20T17:00:10Z', actionLabel: null, ...o,
  })
  async function toPeek(api: Api) {
    const kv = memoryKV()
    await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: NOD })
    await flush()
    b.emit(tap); await flush() // home → lobby (fetches the lobby insight)
    b.emit(tap); await flush() // start class → roll call
    b.emit(dbl); await flush() // skip roll call → peek
    return b
  }
  const sessionCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(c => (c[0] as { sessionId?: string }).sessionId)

  it('the lobby shows the class insight fetched on enter', async () => {
    const insights = vi.fn(async () => ({ insights: [insight('l', { urgency: 'low', title: 'Mia is close to her next belt' })] }))
    const kv = memoryKV(); await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api: fakeApi({ insights }), kv, outbox: new Outbox(kv), nod: NOD })
    await flush()
    b.emit(tap); await flush()
    expect(insights).toHaveBeenCalledWith({ scope: 'class', classId: 'c1' })
    expect(b.sent.join('\n')).toContain(`${INSIGHT_GLYPH} Mia is close to her next belt`)
  })

  it('polls every INSIGHT_POLL_MS during class: a new high item banners for 8 s, then becomes the ★1 suffix', async () => {
    const insights = vi.fn(async (p: { sessionId?: string }) => ({ insights: p.sessionId ? [insight('a')] : [] }))
    const b = await toPeek(fakeApi({ insights }))
    expect(sessionCalls(insights)).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toEqual([[{ scope: 'class', classId: 'c1', sessionId: 's1' }]])
    expect(b.sent.join('\n')).toContain(`upgrade:hdr=${INSIGHT_GLYPH} Jake: no feedback in 3 classes`)
    const before = b.sent.length
    await vi.advanceTimersByTimeAsync(INSIGHT_BANNER_MS)
    const after = b.sent.slice(before).join('\n')
    expect(after).toContain('upgrade:hdr=STANCES')
    expect(after).toContain(`${INSIGHT_GLYPH}1`)
    // The same item on the next poll changes nothing on the lens.
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toHaveLength(2)
    expect(b.sent.slice(n).filter(x => x.includes('hdr=') || x.includes(INSIGHT_GLYPH))).toEqual([])
  })

  it('the poll stops when class ends; the wrap-up gets the top insight row', async () => {
    const insights = vi.fn(async (p: { sessionId?: string }) => ({ insights: p.sessionId ? [] : [insight('w', { title: 'Leo hit a new PR' })] }))
    const b = await toPeek(fakeApi({ insights }))
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toHaveLength(1)
    b.emit(dbl); await flush() // confirm end
    b.emit(tap); await flush() // end class → wrap-up
    expect(b.sent.join('\n')).toContain(`${INSIGHT_GLYPH} Leo hit a new PR`)
    expect(b.sent.join('\n')).toContain('Missed: nobody!')
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS * 3)
    expect(sessionCalls(insights)).toHaveLength(1)
  })

  it('pauses while the app is backgrounded and resumes on return', async () => {
    const insights = vi.fn(async () => ({ insights: [] }))
    const b = await toPeek(fakeApi({ insights }))
    b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_EXIT_EVENT } }); await flush()
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS * 2)
    expect(sessionCalls(insights)).toHaveLength(0)
    b.emit({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }); await flush()
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toHaveLength(1)
  })

  it('a 404 (insights API not deployed) is silent: nothing on the lens, nothing logged, no more polls', async () => {
    const warn = vi.spyOn(console, 'warn')
    const error = vi.spyOn(console, 'error')
    const insights = vi.fn(async () => { throw new ApiError(404, 'not_found') })
    const b = await toPeek(fakeApi({ insights }))
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS * 3)
    expect(sessionCalls(insights)).toHaveLength(1)
    expect(b.sent.join('\n')).not.toContain(INSIGHT_GLYPH)
    const logged = [...warn.mock.calls, ...error.mock.calls].map(c => String(c[0]))
    expect(logged.filter(l => l.includes('insight'))).toEqual([])
    b.emit(dbl); await flush()
    b.emit(tap); await flush()
    expect(b.sent.join('\n')).toContain('Missed: nobody!') // the wrap-up still shows, without an insight row
  })
})

describe('lens controller · insight poll right after attendance changes', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })
  const back = { id: 'back', kind: 'returning_student', studentId: 'j', studentName: 'Jake', classId: 'c1', title: "Jake's back after 2 missed", detail: 'd', urgency: 'high', status: 'new', createdAt: '2026-10-20T17:00:10Z', actionLabel: null }
  const res = (o: Record<string, unknown>) => ({ utteranceId: 'u1', transcript: 'x', cardLines: ['√ Priya · guard'], coverage: cov, nextStudent: null, disambiguation: null, ...o })
  async function toPeek(api: Api) {
    const kv = memoryKV(); await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: NOD })
    await flush()
    b.emit(tap); await flush(); b.emit(tap); await flush(); b.emit(dbl); await flush()
    return b
  }
  async function say(b: Awaited<ReturnType<typeof toPeek>>) {
    b.emit(tap); await flush() // recording
    for (let i = 0; i < 20; i++) b.emit(pcm())
    await vi.advanceTimersByTimeAsync(STOP_DEBOUNCE_MS)
    b.emit(tap); await flush() // send → card
  }
  const sessionCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(c => (c[0] as { sessionId?: string }).sessionId).length

  it('a voice "mark present" polls insights 1.5 s and 5 s later, then the regular 30 s cadence resumes', async () => {
    expect(INSIGHT_AFTER_ATTENDANCE_LATE_MS).toBe(5000)
    let calls = 0
    // The detector is slow: its row is not there at the first early poll, only at the second.
    const insights = vi.fn(async (p: { sessionId?: string }) => ({ insights: p.sessionId && ++calls > 1 ? [back] : [] }))
    const utterance = vi.fn(async () => res({ cardLines: ['√ Jake marked present'], attendanceChanged: true }))
    const b = await toPeek(fakeApi({ insights, utterance }))
    await say(b)
    expect(b.sent.join('\n')).toContain('Jake marked present')
    expect(sessionCalls(insights)).toBe(0)
    await vi.advanceTimersByTimeAsync(INSIGHT_AFTER_ATTENDANCE_MS - 100)
    expect(sessionCalls(insights)).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(sessionCalls(insights)).toBe(1)
    b.emit(tap); await flush() // card → peek: nothing to promote yet
    expect(b.sent.join('\n')).not.toContain("Jake's back")
    await vi.advanceTimersByTimeAsync(INSIGHT_AFTER_ATTENDANCE_LATE_MS - INSIGHT_AFTER_ATTENDANCE_MS - 100)
    expect(sessionCalls(insights)).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(sessionCalls(insights)).toBe(2) // the second early poll finds it: the banner shows on peek
    expect(b.sent.join('\n')).toContain("Jake's back after 2 missed")
    await vi.advanceTimersByTimeAsync(INSIGHT_AFTER_ATTENDANCE_MS + INSIGHT_POLL_MS - INSIGHT_AFTER_ATTENDANCE_LATE_MS - 100)
    expect(sessionCalls(insights)).toBe(2) // no extra poll in between
    await vi.advanceTimersByTimeAsync(100)
    expect(sessionCalls(insights)).toBe(3)
  })

  it('any other reply adds no poll: the first one still comes 30 s after class start', async () => {
    const insights = vi.fn(async () => ({ insights: [] }))
    const b = await toPeek(fakeApi({ insights, utterance: vi.fn(async () => res({})) }))
    await say(b)
    await vi.advanceTimersByTimeAsync(INSIGHT_AFTER_ATTENDANCE_MS * 2)
    expect(sessionCalls(insights)).toBe(0)
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toBe(1)
  })

  it('attendanceChanged: the api flag wins; an older api is read from roll-call / marked card lines', () => {
    expect(attendanceChanged({ cardLines: ['11 present', 'absent: Mia'] })).toBe(true)
    expect(attendanceChanged({ cardLines: ['√ Jake marked present'] })).toBe(true)
    expect(attendanceChanged({ cardLines: ['√ Priya · guard', '? Who is here today'] })).toBe(false)
    expect(attendanceChanged({ cardLines: ['√ Priya · guard'], attendanceChanged: true })).toBe(true)
    expect(attendanceChanged({ cardLines: ['11 present'], attendanceChanged: false })).toBe(false)
  })
})

describe('lens controller · insight poll around class end', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })
  const high = { id: 'late', kind: 'no_feedback', studentId: 'j', studentName: 'Jake', classId: 'c1', title: 'Late insight title', detail: 'd', urgency: 'high', status: 'new', createdAt: '2026-10-20T17:00:10Z', actionLabel: null }
  async function toPeek(api: Api) {
    const kv = memoryKV(); await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: NOD })
    await flush()
    b.emit(tap); await flush(); b.emit(tap); await flush(); b.emit(dbl); await flush()
    return b
  }
  const sessionCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(c => (c[0] as { sessionId?: string }).sessionId).length

  it('a failed end-class leaves class running, and the poll picks up again 30 s later', async () => {
    const insights = vi.fn(async () => ({ insights: [] }))
    const endSession = vi.fn(async () => { throw new ApiError(500, 'boom') })
    const b = await toPeek(fakeApi({ insights, endSession }))
    b.emit(dbl); await flush() // confirm end
    b.emit(tap); await flush() // end fails → back on peek with the session
    expect(b.sent.join('\n')).toContain("Couldn't end class")
    expect(sessionCalls(insights)).toBe(0)
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS)
    expect(sessionCalls(insights)).toBe(1)
  })

  it('a poll answer that lands after class ended never reaches the wrap-up', async () => {
    let answer: (v: { insights: unknown[] }) => void = () => {}
    const insights = vi.fn((p: { sessionId?: string }) => (p.sessionId ? new Promise(r => { answer = r }) : Promise.resolve({ insights: [] })))
    const b = await toPeek(fakeApi({ insights }))
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS) // request out, not answered
    expect(sessionCalls(insights)).toBe(1)
    b.emit(dbl); await flush()
    b.emit(tap); await flush() // wrap-up
    const n = b.sent.length
    answer({ insights: [high] }); await flush()
    expect(b.sent.slice(n).join('\n')).not.toContain('Late insight title')
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_MS * 2)
    expect(sessionCalls(insights)).toBe(1)
  })
})
