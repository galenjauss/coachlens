import { AudioInputSource, ImuReportPace, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { ApiError, NetworkError, type Api } from '../core/api'
import { MAX_RECORD_MS, Recorder } from '../core/audio'
import { bus } from '../core/bus'
import type { FlushResult, Outbox, OutboxItem } from '../core/outbox'
import { KEYS, type KV } from '../core/storage'
import { CLASS_ID_KEY } from '../phone/classPref'
import { fromB64, toB64 } from '../core/wav'
import { imuSample, toLensEvent } from './events'
import { Glasses, type GlassesBridge } from './glasses'
import { initialState, reduce } from './reducer'
import { render } from './render'
import type { Effect, LensEvent, LensState } from './state'
import { HeadTiltDetector, type TiltConfig } from './tilt'

/** While `peek` or `recording` is visible, repaint at most this often (minute text). Never while dark. */
export const TICK_MS = 30_000
const TICKING = new Set<LensState['screen']>(['peek', 'recording'])

export type LensBridge = GlassesBridge & Pick<EvenAppBridge, 'audioControl' | 'imuControl' | 'shutDownPageContainer' | 'onEvenHubEvent'>
export interface LensDeps { bridge: LensBridge; api: Api; kv: KV; outbox: Outbox; tilt: TiltConfig; logImu?: boolean }
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
  const glasses = new Glasses(d.bridge)
  const recorder = new Recorder(d.bridge)
  const detector = new HeadTiltDetector(d.tilt)
  const timers = { hide: slot(), card: slot(), timerEnded: slot(), recordMax: slot() }
  let state: LensState = initialState(await readFirstRunSeen(d.kv))
  let imuOn = false

  const paint = () => glasses.show(render(state, Date.now()))

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
    if (e.type === 'sessionStarted' && state.session && !prev.session) void setImu(true)
    if (e.type === 'wrapupLoaded') void setImu(false)
  }

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
      const ok = on ? await d.bridge.imuControl(true, ImuReportPace.P500) : await d.bridge.imuControl(false)
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

  async function run(eff: Effect): Promise<void> {
    switch (eff.type) {
      case 'markFirstRunSeen': return d.kv.set(KEYS.firstRunSeen, '1')
      case 'loadToday':
        try { dispatch({ type: 'todayLoaded', today: await d.api.today((await d.kv.get(CLASS_ID_KEY)) ?? undefined) }) } catch (e) { dispatch({ type: 'loadFailed', message: errText(e) }) }
        return
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
      case 'scheduleCardTimeout': return timers.card.set(eff.ms, () => dispatch({ type: 'cardTimeout' }))
      case 'scheduleHide': return timers.hide.set(eff.ms, () => dispatch({ type: 'hide' }))
      case 'flushOutbox': return flush(null)
      case 'exit':
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
      if (detector.push(imu)) dispatch({ type: 'headTilt' })
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
  const tick = setInterval(() => { if (TICKING.has(state.screen)) void paint() }, TICK_MS)

  await paint() // never a black screen: the first page goes up immediately
  if (state.screen !== 'firstRun') void run({ type: 'loadToday' })
  void run({ type: 'flushOutbox' })

  return {
    dispatch,
    stop() {
      unsubscribe(); offPaired(); offStart(); offClass(); clearInterval(tick)
      for (const t of Object.values(timers)) t.clear()
    },
  }
}
