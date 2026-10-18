import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImuReportPace, OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { Today } from '@matside/shared'
import { ApiError, type Api } from '../core/api'
import { bus } from '../core/bus'
import { Outbox } from '../core/outbox'
import { KEYS, memoryKV } from '../core/storage'
import { CLASS_ID_KEY } from '../phone/classPref'
import { RUNS_MAX_MS, RUNS_POLL_MS } from './agentRuns'
import { startLens, TICK_MS, type LensBridge, type LensHandle } from './controller'
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
    classes: vi.fn(async () => []),
    utteranceRuns: vi.fn(async () => []),
    ...over,
  } as unknown as Api
}

const tap = { sysEvent: {} }
const dbl = { sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }
const imu = (y: number) => ({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: { x: 0.5, y, z: 1 } } })
const swipe = { textEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }
const NOD = { axis: 'y' as const, threshold: 0.3, windowMs: 600, cooldownMs: 1200 }
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('lens controller', () => {
  let lens: LensHandle | null = null
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T17:00:00Z')) })
  afterEach(() => { lens?.stop(); lens = null; vi.useRealTimers() })

  async function boot(api = fakeApi(), firstRunSeen = true) {
    const kv = memoryKV()
    if (firstRunSeen) await kv.set(KEYS.firstRunSeen, '1')
    const b = fakeBridge()
    lens = await startLens({ bridge: b.bridge, api, kv, outbox: new Outbox(kv), nod: NOD })
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

  /** Start class and skip roll call: the persistent peek. */
  async function toPeek(api = fakeApi()) {
    const b = await boot(api)
    b.emit(tap); await flush() // start class → attendance (mic)
    b.emit(dbl); await flush() // skip roll call → peek
    return b
  }
  /** A nod: dip and come back within the window. */
  async function nod(b: Awaited<ReturnType<typeof boot>>) {
    b.emit(imu(0.1)); await vi.advanceTimersByTimeAsync(100)
    b.emit(imu(0.6)); await vi.advanceTimersByTimeAsync(200)
    b.emit(imu(0.1)); await flush()
  }
  async function toDark() {
    const b = await toPeek()
    await nod(b)
    return b
  }
  /** In peek with a drill running (deck → first drill, 2 min). */
  async function toDrill(api = fakeApi()) {
    const b = await toPeek(api)
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
      expect(seen).toEqual([{ y: 0.1, nod: false }, { y: 0.6, nod: false }, { y: 0.1, nod: true }])
    } finally { off() }
  })

  it('the phone readout opening turns the IMU on at home; closing turns it off', async () => {
    const b = await boot()
    expect(b.raw.imuControl).not.toHaveBeenCalled()
    bus.emit('imuDebug', true); await flush()
    expect(b.raw.imuControl).toHaveBeenLastCalledWith(true, ImuReportPace.P100)
    bus.emit('imuDebug', false); await flush()
    expect(b.raw.imuControl).toHaveBeenLastCalledWith(false)
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

  it('per-second clock: one partial upgrade of the time characters per second while visible, none while dark', async () => {
    const b = await toDrill()
    const n = b.sent.length
    await vi.advanceTimersByTimeAsync(3000)
    const ticks = b.sent.slice(n)
    expect(ticks).toHaveLength(3)
    for (const x of ticks) expect(x).toMatch(/^partial:timer@\d\+\d=[\d:]+$/)
    await nod(b)
    const m = b.sent.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(b.sent.length).toBe(m)
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

  it('endSession failure shows a peek instead of a stuck spinner; success turns IMU off', async () => {
    const endSession = vi.fn().mockRejectedValueOnce(new ApiError(500, 'x')).mockResolvedValueOnce(wrap)
    const b = await toPeek(fakeApi({ endSession }))
    b.emit(dbl); await flush() // confirmEnd
    b.emit(tap); await flush() // end → fails
    expect(b.sent.join('\n')).toContain("Couldn't end class")
    await vi.advanceTimersByTimeAsync(STATUS_MS)
    b.emit(dbl); await flush()
    b.emit(tap); await flush() // end → succeeds
    expect(b.sent.join('\n')).toContain('CLASS DONE · 40 min')
    expect(b.raw.imuControl).toHaveBeenLastCalledWith(false)
  })

  it('an empty transcript (422) from a note shows a retry peek, not a stuck "Sending"', async () => {
    const b = await toPeek()
    b.emit(tap); await flush() // recording
    for (let i = 0; i < 20; i++) b.emit({ audioEvent: { audioPcm: new Uint8Array(1000) } })
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
      b.emit(tap); await flush() // send → card
      return b
    }

    it('stays up (no timeout) with transcript left and agent progress right, polled every 2 s', async () => {
      const utteranceRuns = vi.fn().mockResolvedValueOnce([r('router')]).mockResolvedValue([r('router'), r('progress')])
      const b = await toCard(utteranceRuns)
      expect(b.sent.join('\n')).toContain('You said:')
      expect(b.sent.join('\n')).toContain('✓ sorted\n… email')
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS)
      expect(b.sent.at(-1)).toBe('upgrade:agents=✓ sorted\n✓ logged\n… email')
      expect(utteranceRuns).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(b.sent.some(x => x.startsWith('rebuild:STANCES'))).toBe(true) // (from before the card)
      expect(b.sent.filter(x => x.startsWith('rebuild:')).at(-1)).toMatch(/You said/) // still the card
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
      expect(b.sent.at(-1)).toBe('upgrade:agents=✓ sorted\n✓ logged\n✓ email')
    })

    it('stops polling when the endpoint is missing (404 → null) and shows the server card lines', async () => {
      const utteranceRuns = vi.fn(async () => null)
      const b = await toCard(utteranceRuns)
      await vi.advanceTimersByTimeAsync(RUNS_POLL_MS * 5)
      expect(utteranceRuns).toHaveBeenCalledTimes(1)
      expect(b.sent.join('\n')).toContain('✓ Priya · guard\n→ parent note for Priya drafting')
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
})
