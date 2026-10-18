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
import { MIC_FALLBACK_MS, MIC_METER_MS, startLens, STOP_DEBOUNCE_MS, TICK_MS, type LensBridge, type LensHandle } from './controller'
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

  async function boot(api = fakeApi(), firstRunSeen = true, opts: { nod?: typeof NOD } = {}) {
    const kv = memoryKV()
    if (firstRunSeen) await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: opts.nod ?? NOD })
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
    b.emit(tap); await flush()
    b.emit(tap); await flush()
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(b.sent.join('\n')).toContain('Server error 500')
  })

  /** Start class and skip roll call: the persistent peek. */
  async function toPeek(api = fakeApi(), opts: Parameters<typeof boot>[2] = {}) {
    const b = await boot(api, true, opts)
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
    b.emit({ listEvent: {} }); await flush()
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
    expect(b.sent.join('\n')).toContain('CLASS DONE · 40 min')
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
    const okRes = { utteranceId: 'u1', transcript: 'Priya keep your guard up', cardLines: ['✓ Priya · guard', '→ parent note for Priya drafting'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null }
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
      expect(b.sent.join('\n').replace(/\n/g, ' ')).toContain('✓ Priya · guard · → parent note for Priya drafting')
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

    it('mic line updates at most every 500 ms and shows audio arriving', async () => {
      const b = await toPeek()
      b.emit(tap); await flush()
      const n = b.sent.length
      for (let i = 0; i < 10; i++) { b.emit(pcm(3200)); await vi.advanceTimersByTimeAsync(100) }
      const mic = b.sent.slice(n).filter(x => x.startsWith('upgrade:mic='))
      expect(mic.length).toBeLessThanOrEqual(1000 / MIC_METER_MS)
      expect(mic.at(-1)).toMatch(/^upgrade:mic=[▁▂▃▄▅▆▇█]{14} 1s$/)
    })

    it('no glasses audio within 1.5 s → switches to the phone mic and says so', async () => {
      const b = await toPeek()
      b.emit(tap); await flush()
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS - 100)
      expect(b.raw.audioControl).not.toHaveBeenCalledWith(true, AudioInputSource.Phone)
      await vi.advanceTimersByTimeAsync(200)
      expect(b.raw.audioControl).toHaveBeenLastCalledWith(true, AudioInputSource.Phone)
      expect(b.sent.at(-1)).toContain('Using phone mic')
    })

    it('the switch closes the glasses mic first; a late glasses chunk after it is ignored, phone audio counts', async () => {
      const b = await toPeek()
      b.emit(tap); await flush()
      b.raw.audioControl.mockClear()
      await vi.advanceTimersByTimeAsync(MIC_FALLBACK_MS + 100)
      expect(b.raw.audioControl.mock.calls).toEqual([[false], [true, AudioInputSource.Phone]])
      b.emit({ audioEvent: { audioPcm: new Uint8Array(3200).fill(200), source: AudioInputSource.Glasses } }) // late glasses audio
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toMatch(/^upgrade:mic=waiting for audio… \ds · Using phone mic$/)
      b.emit({ audioEvent: { audioPcm: new Uint8Array(3200).fill(200), source: AudioInputSource.Phone } })
      await vi.advanceTimersByTimeAsync(MIC_METER_MS)
      expect(b.sent.at(-1)).toMatch(/^upgrade:mic=[▁▂▃▄▅▆▇█]{13}█ \ds · Using phone mic$/)
    })

    it('glasses audio arriving in time → no phone fallback', async () => {
      const b = await toPeek()
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

    it('no audio at all → says the glasses sent nothing (never reaches the API)', async () => {
      const utterance = vi.fn()
      const b = await toPeek(fakeApi({ utterance, }))
      b.raw.audioControl.mockImplementation(async (on?: boolean, src?: string) => !(on && src === AudioInputSource.Phone)) // phone mic refused too
      b.emit(tap); await flush()
      await vi.advanceTimersByTimeAsync(2000)
      b.emit(tap); await flush()
      expect(b.sent.join('\n')).toContain('No audio from glasses')
      expect(utterance).not.toHaveBeenCalled()
    })
  })
})
