import { AudioInputSource, ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ApiError, NetworkError, type Api } from '../core/api'
import { MAX_RECORD_MS, Recorder } from '../core/audio'
import { bus } from '../core/bus'
import type { FlushResult, Outbox, OutboxItem } from '../core/outbox'
import { KEYS, type KV } from '../core/storage'
import { isImuDebugOn } from '../core/imuDebug'
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
 * per second that is the few clock characters (partial upgrade); the bar every 5 s. Never while dark.
 */
export const TICK_MS = 1000
const TICKING = new Set<LensState['screen']>(['peek', 'recording'])

export type LensBridge = GlassesBridge & Pick<EvenAppBridge, 'audioControl' | 'imuControl' | 'shutDownPageContainer' | 'onEvenHubEvent'>
export interface LensDeps {
  bridge: LensBridge; api: Api; kv: KV; outbox: Outbox; nod: NodConfig
  imuPace?: ImuReportPace; partialUpgrades?: boolean; logImu?: boolean
}
export interface LensHandle { dispatch(e: LensEvent): void; stop(): void }

/** One replaceable timer: setting it clears the previous one. */
function slot() {
  let h: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (h) clearTimeout(h); h = null }
  return { clear, set(ms: number, fn: () => void) { clear(); h = setTimeout(() => { h = null; fn() }, ms) } }
}

const errText = (e: unknown) => (e instanceof ApiError && e.status === 401 ? 'Not paired' : e instanceof ApiError ? `Server error ${e.status}` : 'Offline')

async function readFirstRunSeen(kv: KV): Promise<boolean> {
  try { return Boolean(await kv.get(KEYS.firstRunSeen)) } catch (e) { console.error('[lens] kv read failed', e); return false }
}

export async function startLens(d: LensDeps): Promise<LensHandle> {
  const glasses = new Glasses(d.bridge, { partial: d.partialUpgrades ?? true })
  const recorder = new Recorder(d.bridge)
  const detector = new NodDetector(d.nod)
  const timers = { status: slot(), timerEnded: slot(), recordMax: slot() }
  let state: LensState = initialState(await readFirstRunSeen(d.kv))
  let imuOn = false
  let imuDebug = isImuDebugOn()
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
    void syncImu()
  }

  /** The IMU runs while a class is live (nod toggle) or while the phone readout is open (calibration). */
  const syncImu = () => setImu(Boolean(state.session && !state.wrapup) || imuDebug)

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
    // Dropped = the server rejected it (422 empty transcript, other 4xx, or retries exhausted): nothing was saved.
    if (r.dropped.has(currentId)) return dispatch({ type: 'utteranceEmpty' })
    dispatch({ type: 'utteranceQueued' }) // still in the outbox (offline / 5xx / not paired)
  }

  async function stopAndSend(eff: Extract<Effect, { type: 'stopMicAndSend' }>): Promise<void> {
    timers.recordMax.clear()
    let wav: Uint8Array | null
    try { wav = await recorder.stop() } catch (err) { console.error('[mic] stop failed', err); return dispatch({ type: 'utteranceEmpty' }) }
    if (!wav) return dispatch({ type: 'utteranceEmpty' })
    const form = { sessionId: eff.sessionId, drillId: eff.drillId, mode: eff.mode, audioB64: toB64(wav), text: null }
    let item: OutboxItem
    try { item = await d.outbox.enqueue(form) } catch (err) {
      // Storage failed: try once directly so the note is not silently lost.
      console.error('[outbox] enqueue failed', err)
      try { return dispatch({ type: 'utteranceResult', res: await sendItem({ id: 'direct', createdAt: Date.now(), attempts: 0, form }) }) } catch { return dispatch({ type: 'utteranceEmpty' }) }
    }
    return flush(item.id)
  }

  async function loadToday(): Promise<void> {
    const seq = ++todaySeq
    try {
      const today = await d.api.today((await d.kv.get(CLASS_ID_KEY)) || undefined)
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
        await d.kv.set(CLASS_ID_KEY, eff.classId)
        bus.emit('classChanged', eff.classId) // the phone follows; our own listener reloads today
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
          await recorder.start()
          timers.recordMax.set(MAX_RECORD_MS, () => {
            if (state.screen === 'recording' || state.screen === 'attendance') dispatch({ type: 'tap', now: Date.now() })
          })
        } catch (err) { console.error('[mic] start failed', err); dispatch({ type: 'micFailed' }) }
        return
      case 'cancelMic':
        timers.recordMax.clear()
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
        imuDebug = false
        await setImu(false)
        await d.bridge.shutDownPageContainer(1)
        return
    }
  }

  const unsubscribe = d.bridge.onEvenHubEvent(e => {
    if (e.audioEvent?.audioPcm) recorder.push(e.audioEvent.audioPcm)
    const imu = imuSample(e)
    if (imu) {
      if (d.logImu) console.info('[imu]', imu.x, imu.y, imu.z)
      const nod = detector.push(imu)
      bus.emit('imuSample', { x: imu.x ?? 0, y: imu.y ?? 0, z: imu.z ?? 0, nod })
      if (nod) dispatch({ type: 'nod' })
      return
    }
    const le = toLensEvent(e)
    if (!le) return
    if (le.type === 'resumed') {
      // The host may close sensors while we're in the background: re-arm what was on.
      if (imuOn) void setImu(true, true)
      if (recorder.recording) void d.bridge.audioControl(true, AudioInputSource.Glasses).catch(err => console.warn('[mic] re-arm failed', err))
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
  const offImuDebug = bus.on('imuDebug', on => { imuDebug = on; void syncImu() })
  const tick = setInterval(() => { if (TICKING.has(state.screen)) void paint(true) }, TICK_MS)

  await paint() // never a black screen: the first page goes up immediately
  if (state.screen !== 'firstRun') { void run({ type: 'loadToday' }); void run({ type: 'loadClasses' }) }
  if (imuDebug) void syncImu()
  void run({ type: 'flushOutbox' })

  return {
    dispatch,
    stop() {
      unsubscribe(); offPaired(); offStart(); offClass(); offDeck(); offImuDebug(); clearInterval(tick)
      runsPoll?.stop()
      glasses.dispose()
      for (const t of Object.values(timers)) t.clear()
    },
  }
}
