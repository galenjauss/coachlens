import { ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ApiError, NetworkError, type Api } from '../core/api'
import { MAX_RECORD_MS, Recorder, type StopResult } from '../core/audio'
import { bus } from '../core/bus'
import type { FlushResult, Outbox, OutboxItem } from '../core/outbox'
import { KEYS, type KV } from '../core/storage'
import { CLASS_ID_KEY } from '../phone/classPref'
import { fromB64, toB64 } from '../core/wav'
import { RUNS_MAX_MS, RUNS_POLL_MS, runsDone } from './agentRuns'
import { imuSample, toLensEvent } from './events'
import { Glasses, type GlassesBridge } from './glasses'
import { NodDetector, type NodConfig } from './nod'
import { initialState, reduce } from './reducer'
import { render } from './render'
import type { Effect, LensEvent, LensState } from './state'

/**
 * While `peek` or `recording` is visible, re-render this often. Only changed containers are sent:
 * per second that is the small clock container (~10 chars); the bar every 5 s. Never while dark.
 */
export const TICK_MS = 1000
const TICK_SLACK_MS = 20
// Only the peek ticks. While recording/sending the display stays still: on G2, display updates
// compete with mic audio on Bluetooth (a busy link delivered almost no PCM).
const TICKING = new Set<LensState['screen']>(['peek'])
/** Glasses audio must start arriving within this long, else the phone mic takes over. */
export const MIC_FALLBACK_MS = 1500
/** The "hearing you" line refreshes at most this often. */
export const MIC_METER_MS = 500
/** A stop tap this soon after recording starts is a double-trigger: ignored. */
export const STOP_DEBOUNCE_MS = 600

export type LensBridge = GlassesBridge & Pick<EvenAppBridge, 'audioControl' | 'imuControl' | 'shutDownPageContainer' | 'onEvenHubEvent'>
export interface LensDeps {
  bridge: LensBridge; api: Api; kv: KV; outbox: Outbox; nod: NodConfig
  imuPace?: ImuReportPace; logImu?: boolean
}
export interface LensHandle { dispatch(e: LensEvent): void; stop(): void }

/** One replaceable timer: setting it clears the previous one. */
function slot() {
  let h: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (h) clearTimeout(h); h = null }
  return { clear, set(ms: number, fn: () => void) { clear(); h = setTimeout(() => { h = null; fn() }, ms) } }
}

const errText = (e: unknown) => (e instanceof ApiError && e.status === 401 ? 'Pair on phone' : e instanceof ApiError ? `Server error ${e.status}`
  : e instanceof NetworkError && e.message === 'timeout' ? 'Server not responding' : 'Offline')

/** A KV read that hangs (bridge storage) must not block loading: fall back after `ms`. */
function kvGet(kv: KV, key: string, ms = 3000): Promise<string | null> {
  return Promise.race([
    kv.get(key).catch(e => { console.warn('[kv] read failed', key, e); return null }),
    new Promise<null>(r => setTimeout(() => r(null), ms)),
  ])
}

async function readFirstRunSeen(kv: KV): Promise<boolean> {
  try { return Boolean(await kv.get(KEYS.firstRunSeen)) } catch (e) { console.error('[lens] kv read failed', e); return false }
}

export async function startLens(d: LensDeps): Promise<LensHandle> {
  const glasses = new Glasses(d.bridge)
  const recorder = new Recorder(d.bridge)
  const detector = new NodDetector(d.nod)
  const timers = { status: slot(), timerEnded: slot(), recordMax: slot(), micFallback: slot(), micMeter: slot() }
  let recStartedAt = 0
  let state: LensState = initialState(await readFirstRunSeen(d.kv))
  let imuOn = false
  let exited = false
  let todaySeq = 0 // only the latest today request may land (swiping classes fires several)
  let runsPoll: { utteranceId: string; stop(): void } | null = null

  const paint = (background = false) => glasses.show(render(state, Date.now()), { background })

  function dispatch(e: LensEvent): void {
    const prev = state
    const r = reduce(state, e)
    state = r.state
    if (state !== prev) {
      onStateChange(prev, e)
      void paint()
    }
    for (const eff of r.effects) void run(eff).catch(err => console.error('[effect]', eff.type, err))
  }

  function onStateChange(prev: LensState, e: LensEvent): void {
    const minutes = (st: LensState) => st.today?.deck.drills.find(x => x.id === st.active?.drillId)?.minutes
    if (state.active?.drillId !== prev.active?.drillId || state.active?.startedAt !== prev.active?.startedAt) armDrillTimer()
    else if (e.type === 'todayLoaded' && state.active && minutes(state) !== minutes(prev)) armDrillTimer()
  }

  /** The IMU runs from lens start until exit: a nod toggles the lens on any idle screen, before class too. */
  const syncImu = () => setImu(!exited)

  function armDrillTimer(): void {
    timers.timerEnded.clear()
    const a = state.active
    const drill = a && state.today?.deck.drills.find(x => x.id === a.drillId)
    if (!a || !drill) return
    const ms = a.startedAt + drill.minutes * 60_000 - Date.now()
    if (ms > 0) timers.timerEnded.set(ms, () => dispatch({ type: 'timerEnded' }))
  }

  async function setImu(on: boolean, force = false): Promise<void> {
    if (imuOn === on && !force) return
    imuOn = on
    try {
      const ok = on ? await d.bridge.imuControl(true, d.imuPace ?? ImuReportPace.P100) : await d.bridge.imuControl(false)
      if (!ok) console.warn('[imu] imuControl returned false', on)
    } catch (err) {
      console.warn('[imu] imuControl failed (tap still works)', err)
    }
  }

  const sendItem = (i: OutboxItem) => d.api.utterance({
    sessionId: i.form.sessionId, drillId: i.form.drillId, mode: i.form.mode, text: i.form.text,
    audio: i.form.audioB64 ? new Blob([fromB64(i.form.audioB64) as BlobPart], { type: 'audio/wav' }) : null,
  })

  /** Flush the outbox; when `currentId` is the note just recorded, report its outcome to the lens. */
  async function flush(currentId: string | null): Promise<void> {
    let r: FlushResult
    try { r = await d.outbox.flush(sendItem) } catch (err) {
      console.error('[outbox] flush failed', err)
      if (currentId) dispatch({ type: 'utteranceQueued' })
      return
    }
    if (!currentId) return
    const res = r.results.get(currentId)
    if (res) {
      dispatch({ type: 'utteranceResult', res })
      // A spoken "add drill" changes today's deck: refresh it.
      if (res.cardLines.some(l => l.startsWith('✓ Added'))) void run({ type: 'loadToday' })
      return
    }
    if (r.delivered.has(currentId)) return dispatch({ type: 'utteranceDelivered' }) // saved; reply unreadable
    // Dropped = the server rejected it (422 empty transcript, other 4xx, or retries exhausted): nothing was saved.
    if (r.dropped.has(currentId)) return dispatch({ type: 'utteranceEmpty', reason: 'not_understood' })
    dispatch({ type: 'utteranceQueued' }) // still in the outbox (offline / 5xx / not paired)
  }

  async function stopAndSend(eff: Extract<Effect, { type: 'stopMicAndSend' }>): Promise<void> {
    stopMicTimers()
    let res: StopResult
    try { res = await recorder.stop() } catch (err) { console.error('[mic] stop failed', err); return dispatch({ type: 'utteranceEmpty', reason: 'no_audio' }) }
    if (!res.wav) {
      console.warn('[mic] nothing to send', res.reason, res.bytes, 'bytes from', recorder.source)
      return dispatch({ type: 'utteranceEmpty', reason: res.reason })
    }
    const wav = res.wav
    const form = { sessionId: eff.sessionId, drillId: eff.drillId, mode: eff.mode, audioB64: toB64(wav), text: null }
    let item: OutboxItem
    try { item = await d.outbox.enqueue(form) } catch (err) {
      // Storage failed: try once directly so the note is not silently lost.
      console.error('[outbox] enqueue failed', err)
      try { return dispatch({ type: 'utteranceResult', res: await sendItem({ id: 'direct', createdAt: Date.now(), attempts: 0, form }) }) } catch { return dispatch({ type: 'utteranceEmpty', reason: 'not_understood' }) }
    }
    return flush(item.id)
  }

  async function loadToday(): Promise<void> {
    const seq = ++todaySeq
    try {
      const today = await d.api.today((await kvGet(d.kv, CLASS_ID_KEY)) || undefined)
      if (seq === todaySeq) dispatch({ type: 'todayLoaded', today })
    } catch (e) {
      if (seq === todaySeq) dispatch({ type: 'loadFailed', message: errText(e) })
    }
  }

  /**
   * Card right column: poll the utterance's agent runs every RUNS_POLL_MS until every expected agent
   * reported, RUNS_MAX_MS passed, the endpoint is missing (404), or the card is gone.
   */
  function pollRuns(utteranceId: string): void {
    runsPoll?.stop()
    const startedAt = Date.now()
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const poll: { utteranceId: string; stop(): void } = { utteranceId, stop() { stopped = true; if (timer) clearTimeout(timer) } }
    runsPoll = poll
    const finish = () => { poll.stop(); if (runsPoll === poll) runsPoll = null }
    const tick = async () => {
      timer = null
      if (stopped) return
      if (state.card?.utteranceId !== utteranceId) return finish()
      let runs: Awaited<ReturnType<Api['utteranceRuns']>> | undefined
      try { runs = await d.api.utteranceRuns(utteranceId) } catch (err) { console.warn('[runs] poll failed', errText(err)) }
      if (stopped) return
      const final = runs === null || (runs !== undefined && runsDone(runs, state.card?.lines ?? [])) || Date.now() - startedAt + RUNS_POLL_MS > RUNS_MAX_MS
      if (runs !== undefined || final) dispatch({ type: 'runsLoaded', utteranceId, runs: runs ?? null, final })
      if (final) return finish()
      timer = setTimeout(() => { void tick() }, RUNS_POLL_MS)
    }
    void tick()
  }

  function stopMicTimers(): void {
    timers.recordMax.clear(); timers.micFallback.clear(); timers.micMeter.clear()
  }

  const micLevel = () => ({ type: 'micLevel' as const, seconds: Math.floor((Date.now() - recStartedAt) / 1000), wave: recorder.wave(), source: recorder.source })

  /** Refresh the "hearing you" line every MIC_METER_MS while recording (the reducer drops no-change updates). */
  function meter(): void {
    timers.micMeter.set(MIC_METER_MS, () => {
      if (!recorder.recording) return
      dispatch(micLevel())
      meter()
    })
  }

  /** No glasses audio yet: switch to the phone mic and say so on the lens. */
  async function fallbackToPhone(): Promise<void> {
    if (!recorder.recording || recorder.bytes > 0) return
    console.warn('[mic] no glasses audio after', MIC_FALLBACK_MS, 'ms: switching to the phone mic')
    if (await recorder.switchToPhone()) dispatch(micLevel())
  }

  async function run(eff: Effect): Promise<void> {
    switch (eff.type) {
      case 'markFirstRunSeen': return d.kv.set(KEYS.firstRunSeen, '1')
      case 'loadToday': return loadToday()
      case 'loadClasses':
        try {
          const rows = await d.api.classes()
          dispatch({ type: 'classesLoaded', classes: rows.map(r => ({ id: r.id, name: r.name, modeLabel: r.modeLabel })) })
        } catch (e) { console.warn('[lens] classes unavailable', errText(e)) } // home still works with today's class
        return
      case 'selectClass':
        todaySeq += 1 // anything in flight is for the previous class
        try { await d.kv.set(CLASS_ID_KEY, eff.classId) } catch (e) { console.warn('[lens] could not save the class choice', e) }
        bus.emit('classChanged', eff.classId) // the phone follows; our own listener reloads today (never left loading)
        return
      case 'pollRuns': return pollRuns(eff.utteranceId)
      case 'startSession': {
        const resumed = Boolean(state.today?.sessionId)
        try {
          const res = await d.api.startSession(eff.classId)
          bus.emit('sessionChanged', res.sessionId)
          dispatch({ type: 'sessionStarted', res, resumed, now: Date.now() })
        } catch (e) { dispatch({ type: 'actionFailed', message: errText(e) }) }
        return
      }
      case 'startMic':
        try {
          recStartedAt = Date.now()
          await recorder.start()
          timers.recordMax.set(MAX_RECORD_MS, () => {
            if (state.screen === 'recording' || state.screen === 'attendance') dispatch({ type: 'tap', now: Date.now() })
          })
          timers.micFallback.set(MIC_FALLBACK_MS, () => { void fallbackToPhone() })
          meter()
        } catch (err) { console.error('[mic] start failed', err); stopMicTimers(); dispatch({ type: 'micFailed' }) }
        return
      case 'cancelMic':
        stopMicTimers()
        return recorder.cancel()
      case 'stopMicAndSend': return stopAndSend(eff)
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
      case 'endSession':
        try {
          const w = await d.api.endSession(eff.sessionId)
          bus.emit('sessionChanged', null)
          dispatch({ type: 'wrapupLoaded', wrapup: w })
        } catch (e) { dispatch({ type: 'actionFailed', message: errText(e) }) }
        return
      case 'remind': { await d.api.remind(eff.sessionId, eff.studentIds); return }
      case 'expireStatus': return timers.status.set(eff.ms, () => dispatch({ type: 'statusExpired' }))
      case 'flushOutbox': return flush(null)
      case 'exit':
        exited = true
        await setImu(false)
        await d.bridge.shutDownPageContainer(1)
        return
    }
  }

  const unsubscribe = d.bridge.onEvenHubEvent(e => {
    if (e.audioEvent?.audioPcm) recorder.push(e.audioEvent.audioPcm, e.audioEvent.source)
    const imu = imuSample(e)
    if (imu) {
      if (d.logImu) console.info('[imu]', imu.x, imu.y, imu.z)
      const nod = d.nod.enabled && detector.push(imu)
      bus.emit('imuSample', { x: imu.x ?? 0, y: imu.y ?? 0, z: imu.z ?? 0, nod })
      if (nod) dispatch({ type: 'nod' })
      return
    }
    const le = toLensEvent(e)
    if (!le) return
    // A stop tap right after recording started is a double-trigger: keep recording.
    if (le.type === 'tap' && (state.screen === 'recording' || state.screen === 'attendance') && Date.now() - recStartedAt < STOP_DEBOUNCE_MS) return
    if (le.type === 'resumed') {
      // The host may close sensors while we're in the background: re-arm what was on.
      if (imuOn) void setImu(true, true)
      if (recorder.recording) void recorder.rearm().catch(err => console.warn('[mic] re-arm failed', err))
    }
    dispatch(le)
    if (le.type === 'resumed') {
      // The glasses may have dropped our page while backgrounded; the dark page would otherwise never
      // be re-sent (same spec), leaving the lens blank and deaf. One full rebuild restores it.
      glasses.invalidate()
      void paint()
    }
  })
  const offPaired = bus.on('paired', () => dispatch({ type: 'resumed' }))
  const offStart = bus.on('startClass', () => dispatch({ type: 'startRequested' }))
  const offClass = bus.on('classChanged', () => { void run({ type: 'loadToday' }) })
  const offDeck = bus.on('deckChanged', () => { void run({ type: 'loadToday' }) }) // phone edited/accepted a plan: the lens reloads it
  // Ticks land just after whole seconds of the running drill, so the clock text changes on every tick.
  let tick: ReturnType<typeof setTimeout> | null = null
  const scheduleTick = () => {
    const a = state.active
    const into = a ? (((Date.now() - a.startedAt) % TICK_MS) + TICK_MS) % TICK_MS : 0
    tick = setTimeout(() => {
      if (TICKING.has(state.screen)) void paint(true)
      scheduleTick()
    }, TICK_MS - into + TICK_SLACK_MS)
  }
  scheduleTick()

  await paint() // never a black screen: the first page goes up immediately
  if (state.screen !== 'firstRun') { void run({ type: 'loadToday' }); void run({ type: 'loadClasses' }) }
  void syncImu() // IMU on from lens start (nod works on home too); off on exit
  void run({ type: 'flushOutbox' })

  return {
    dispatch,
    stop() {
      unsubscribe(); offPaired(); offStart(); offClass(); offDeck(); if (tick) clearTimeout(tick)
      runsPoll?.stop()
      glasses.dispose()
      for (const t of Object.values(timers)) t.clear()
    },
  }
}
