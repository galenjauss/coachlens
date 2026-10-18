import { ImuReportPace, OsEventTypeList, type EvenAppBridge } from '@evenrealities/even_hub_sdk'
import { MIC_DUAL_START } from '../config'
import { ApiError, NetworkError, TRANSCRIBE_TIMEOUT_MS, type Api } from '../core/api'
import { MAX_RECORD_MS, Recorder, type MicSource, type StopResult } from '../core/audio'
import { bus } from '../core/bus'
import type { FlushResult, Outbox, OutboxForm, OutboxItem } from '../core/outbox'
import { KEYS, type KV } from '../core/storage'
import { CLASS_ID_KEY } from '../phone/classPref'
import { fromB64, toB64 } from '../core/wav'
import { RUNS_MAX_MS, RUNS_POLL_MS, runsDone } from './agentRuns'
import { imuSample, toLensEvent } from './events'
import { Glasses, type GlassesBridge } from './glasses'
import { NodDetector, type NodConfig } from './nod'
import { initialState, reduce } from './reducer'
import { MIC_TICK_MS, render } from './render'
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
/**
 * Sequential mode (MIC_DUAL_START off): glasses audio must start arriving within this long, else the
 * phone mic takes over. Dual mode: after this long with only phone audio, the mic line says "(phone)".
 */
export const MIC_FALLBACK_MS = 1500
/** While a session is active, ping /health this often so the serverless API stays warm. */
export const KEEP_WARM_MS = 4 * 60_000
/** While notes wait in the outbox, retry sending them this often. */
export const OUTBOX_RETRY_MS = 20_000
/** The recorded audio waits in the outbox this long while transcript-first may swap it to text. */
const HOLD_MS = TRANSCRIBE_TIMEOUT_MS + 2000
/** UtteranceForm caps `text` at 1000 chars: a longer transcript goes as audio instead (never rejected). */
const MAX_TEXT = 1000
/** The "hearing you" line (and the thinking dots) refresh at most this often. */
export const MIC_METER_MS = MIC_TICK_MS
/** Host events after which the app is no longer in front: the IMU is turned off (re-armed on resume). */
const HOST_EXITS = new Set<OsEventTypeList | undefined>([OsEventTypeList.FOREGROUND_EXIT_EVENT, OsEventTypeList.ABNORMAL_EXIT_EVENT, OsEventTypeList.SYSTEM_EXIT_EVENT])
/** A stop tap this soon after recording starts is a double-trigger: ignored. */
export const STOP_DEBOUNCE_MS = 600

export type LensBridge = GlassesBridge & Pick<EvenAppBridge, 'audioControl' | 'imuControl' | 'shutDownPageContainer' | 'onEvenHubEvent'>
export interface LensDeps {
  bridge: LensBridge; api: Api; kv: KV; outbox: Outbox; nod: NodConfig
  imuPace?: ImuReportPace; logImu?: boolean
  /** Open both mics at record start (default MIC_DUAL_START). */
  micDualStart?: boolean
  /** Network state (default navigator.onLine): offline skips transcribe and queues the audio. */
  isOnline?: () => boolean
}
export interface LensHandle { dispatch(e: LensEvent): void; stop(): void }

/** One replaceable timer: setting it clears the previous one. */
function slot() {
  let h: ReturnType<typeof setTimeout> | null = null
  const clear = () => { if (h) clearTimeout(h); h = null }
  return { clear, get active() { return h !== null }, set(ms: number, fn: () => void) { clear(); h = setTimeout(() => { h = null; fn() }, ms) } }
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
  const recorder = new Recorder(d.bridge, { dual: d.micDualStart ?? MIC_DUAL_START })
  const detector = new NodDetector(d.nod)
  const timers = { status: slot(), timerEnded: slot(), recordMax: slot(), micFallback: slot(), micMeter: slot(), think: slot(), keepWarm: slot(), outboxRetry: slot() }
  const online = () => (d.isOnline ? d.isOnline() : !(typeof navigator !== 'undefined' && navigator.onLine === false))
  /** Flushes reporting on the note just recorded; background retries wait so they never take its reply. */
  let inFlight = 0
  /** The host backgrounded the app: no keep-warm pings until it resumes. */
  let suspended = false
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
    if (state.screen === 'sending' && prev.screen !== 'sending') thinkTicks()
    if (Boolean(state.session) !== Boolean(prev.session)) keepWarm()
  }

  /** Ping /health every KEEP_WARM_MS while a session is active and the app is in front; else stop. */
  function keepWarm(): void {
    if (!state.session || suspended || exited) return timers.keepWarm.clear()
    if (timers.keepWarm.active) return
    timers.keepWarm.set(KEEP_WARM_MS, () => {
      if (!state.session || suspended || exited) return
      void d.api.health().catch(err => console.warn('[keep-warm] ping failed', errText(err)))
      keepWarm()
    })
  }

  /** While notes wait in the outbox, retry every OUTBOX_RETRY_MS (keeps its cadence across count changes). */
  function armRetry(count: number): void {
    if (count <= 0 || exited || suspended) return timers.outboxRetry.clear()
    if (timers.outboxRetry.active) return
    timers.outboxRetry.set(OUTBOX_RETRY_MS, () => { void retryFlush() })
  }
  async function retryFlush(): Promise<void> {
    if (exited || suspended) return
    await backgroundFlush()
    let n = 0
    try { n = await d.outbox.count() } catch (err) { console.warn('[outbox] count failed', err) }
    armRetry(n)
  }
  /** A flush nobody waits on (retry timer, `online`, the phone's Retry now); skipped while a note is reporting. */
  function backgroundFlush(): Promise<void> {
    return inFlight > 0 ? Promise.resolve() : flush(null)
  }

  /** While "sending" is up, step the stage dots every MIC_METER_MS (the reducer advances sending → thinking). */
  function thinkTicks(): void {
    timers.think.set(MIC_METER_MS, () => {
      if (state.screen !== 'sending') return
      dispatch({ type: 'thinkingTick' })
      thinkTicks()
    })
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
    // The request for the note just recorded is really going out: the stage line moves heard → sending.
    const send = (i: OutboxItem) => { if (i.id === currentId) dispatch({ type: 'sendStarted' }); return sendItem(i) }
    try { r = await d.outbox.flush(send) } catch (err) {
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

  /**
   * Transcript-first: STT alone, with a TRANSCRIBE_TIMEOUT_MS cap. `{ text }` = send the note as text;
   * 'empty' = nothing was heard (422); null = failed or too slow: send the audio instead.
   */
  async function transcriptFirst(wav: Uint8Array, sessionId: string): Promise<{ text: string } | 'empty' | null> {
    dispatch({ type: 'sendStarted' })
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new NetworkError('timeout')), TRANSCRIBE_TIMEOUT_MS) })
    try {
      const text = (await Promise.race([d.api.transcribe(new Blob([wav as BlobPart], { type: 'audio/wav' }), { sessionId }), timeout])).trim()
      if (!text) return 'empty'
      return text.length <= MAX_TEXT ? { text } : null
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) return 'empty'
      console.warn('[transcribe] sending the audio instead:', errText(err))
      return null
    } finally { clearTimeout(timer) }
  }

  async function stopAndSend(eff: Extract<Effect, { type: 'stopMicAndSend' }>): Promise<void> {
    stopMicTimers()
    let res: StopResult
    try { res = await recorder.stop() } catch (err) { console.error('[mic] stop failed', err); return dispatch({ type: 'utteranceEmpty', reason: 'no_audio' }) }
    if (!res.wav) {
      console.warn('[mic] nothing to send', res.reason, res.bytes, 'bytes from', recorder.source)
      return dispatch({ type: 'utteranceEmpty', reason: res.reason })
    }
    const base = { sessionId: eff.sessionId, drillId: eff.drillId, mode: eff.mode }
    inFlight += 1 // before the enqueue: no background flush may take this note's reply
    try { return await sendNote(res.wav, base) } finally { inFlight -= 1 }
  }

  /**
   * The audio is saved in the outbox first (held while transcribe runs), so a kill in the transcribe
   * window loses nothing. Transcribe answered → the same item becomes the text note (exactly one item);
   * failed/slow → the hold is released and the audio goes. Offline → the audio is queued unheld.
   */
  async function sendNote(wav: Uint8Array, base: Pick<OutboxForm, 'sessionId' | 'drillId' | 'mode'>): Promise<void> {
    const audio: OutboxForm = { ...base, audioB64: toB64(wav), text: null }
    const tryText = online() && typeof d.api.transcribe === 'function'
    let item: OutboxItem
    try { item = await d.outbox.enqueue(audio, tryText ? { holdUntil: Date.now() + HOLD_MS } : {}) } catch (err) {
      // Storage failed: try once directly so the note is not silently lost.
      console.error('[outbox] enqueue failed', err)
      dispatch({ type: 'sendStarted' })
      try { return dispatch({ type: 'utteranceResult', res: await sendItem({ id: 'direct', createdAt: Date.now(), attempts: 0, form: audio }) }) } catch { return dispatch({ type: 'utteranceEmpty', reason: 'not_understood' }) }
    }
    if (tryText) {
      const heard = await transcriptFirst(wav, base.sessionId)
      if (heard === 'empty') {
        await d.outbox.drop(item.id).catch(err => console.warn('[outbox] drop failed (the server will reject it)', err))
        return dispatch({ type: 'utteranceEmpty', reason: 'not_understood' })
      }
      const settle = heard ? d.outbox.swap(item.id, { ...base, audioB64: null, text: heard.text }) : d.outbox.unhold(item.id)
      // A failed write leaves the hold to expire on its own: the audio still goes on a later flush.
      const swapped = await settle.catch(err => { console.warn('[outbox] update failed', err); return false })
      if (heard && swapped) dispatch({ type: 'transcriptReady', transcript: heard.text })
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

  /** Which mic the line names: dual mode says "(phone)" once only the phone has heard anything for MIC_FALLBACK_MS. */
  const liveSource = (): MicSource => (recorder.dual && recorder.bytesFrom('glasses') === 0 && recorder.bytesFrom('phone') > 0
    && Date.now() - recStartedAt >= MIC_FALLBACK_MS ? 'phone' : recorder.source)
  const micLevel = () => ({ type: 'micLevel' as const, tick: Math.round((Date.now() - recStartedAt) / MIC_METER_MS), audio: recorder.bytes > 0, source: liveSource() })

  /**
   * Refresh the "hearing you" line every MIC_METER_MS while recording — the only lens update while the
   * mic is open (pulse + m:ss; audio arrival and the phone switch show on the next tick).
   */
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
    await recorder.switchToPhone() // the next meter tick says "(phone)": no extra lens update
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
          if (!recorder.dual) timers.micFallback.set(MIC_FALLBACK_MS, () => { void fallbackToPhone() })
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
      case 'remind':
        try {
          await d.api.remind(eff.sessionId, eff.studentIds)
          dispatch({ type: 'remindResult', ok: true, names: eff.names })
        } catch (e) {
          console.warn('[lens] remind failed', errText(e))
          dispatch({ type: 'remindResult', ok: false, names: eff.names })
        }
        return
      case 'expireStatus': return timers.status.set(eff.ms, () => dispatch({ type: 'statusExpired' }))
      case 'flushOutbox': return backgroundFlush()
      case 'exit':
        exited = true
        timers.keepWarm.clear(); timers.outboxRetry.clear()
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
    if (e.sysEvent && HOST_EXITS.has(e.sysEvent.eventType)) { // backgrounded / closed by the host
      void setImu(false)
      suspended = true
      timers.keepWarm.clear()
      timers.outboxRetry.clear()
      return
    }
    const le = toLensEvent(e)
    if (!le) return
    // A stop tap right after recording started is a double-trigger: keep recording.
    if (le.type === 'tap' && (state.screen === 'recording' || state.screen === 'attendance') && Date.now() - recStartedAt < STOP_DEBOUNCE_MS) return
    if (le.type === 'resumed') {
      // The host may close sensors while we're in the background: re-arm what was on.
      if (!exited) void setImu(true, true)
      suspended = false
      keepWarm()
      void d.outbox.count().then(armRetry, err => console.warn('[outbox] count failed', err))
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
  const offOutbox = bus.on('outboxChanged', count => { dispatch({ type: 'outboxChanged', count }); armRetry(count) })
  const offRetry = bus.on('outboxRetry', () => { void backgroundFlush() }) // phone "Retry now"
  const onOnline = () => { void backgroundFlush() }
  const win = typeof window !== 'undefined' ? window : null
  win?.addEventListener('online', onOnline)
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
  void d.outbox.count().then(n => bus.emit('outboxChanged', n), err => console.warn('[outbox] count failed', err)) // lens + phone start from the real count

  return {
    dispatch,
    stop() {
      unsubscribe(); offPaired(); offStart(); offClass(); offDeck(); offOutbox(); offRetry(); if (tick) clearTimeout(tick)
      win?.removeEventListener('online', onOnline)
      exited = true
      void setImu(false)
      runsPoll?.stop()
      glasses.dispose()
      for (const t of Object.values(timers)) t.clear()
    },
  }
}
