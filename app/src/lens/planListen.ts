import { PLAN_CHUNK_MS, PLAN_MAX_MS } from '../config'
import { ApiError, type Api } from '../core/api'
import type { Recorder } from '../core/audio'
import type { LensEvent, Screen } from './state'

/** One planning chunk (≤ 20 s of audio) gets this long to transcribe before it counts as failed. */
export const PLAN_TRANSCRIBE_TIMEOUT_MS = 20_000
/** The `● Planning · m:ss` header refreshes this often. */
export const PLAN_TICK_MS = 1000

export interface PlanListenDeps {
  recorder: Pick<Recorder, 'start' | 'cut' | 'stop' | 'cancel' | 'recording'>
  api: Pick<Api, 'transcribe' | 'voicePlan'>
  dispatch(e: LensEvent): void
  screen(): Screen
  errText(e: unknown): string
}

/** One running planning listen. Late results of a cancelled or finished one are dropped. */
interface Run {
  classId: string
  startedAt: number
  texts: string[]
  parts: Promise<void>[]
  timers: ReturnType<typeof setTimeout>[]
}

/**
 * Planning listen: one continuous recording, cut every PLAN_CHUNK_MS into a WAV that is transcribed in
 * the background (each chunk holds only the audio since the last cut; transcripts stay in order). A
 * failed chunk is retried once. On stop the remainder is transcribed, the chunks are joined, and the
 * transcript goes to POST /v1/plan/voice. Hard cap PLAN_MAX_MS.
 */
export function createPlanListen(d: PlanListenDeps) {
  let run: Run | null = null

  const clearTimers = (r: Run) => { for (const t of r.timers) { clearTimeout(t); clearInterval(t) } r.timers = [] }
  const heard = (r: Run) => r.texts.filter(Boolean).join(' ').trim()

  /** STT for one chunk with roster hints from the class. 422 = nothing heard (''); other failures retry once. */
  async function transcribe(wav: Uint8Array, classId: string): Promise<string> {
    const blob = new Blob([wav as BlobPart], { type: 'audio/wav' })
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return (await d.api.transcribe(blob, { classId }, PLAN_TRANSCRIBE_TIMEOUT_MS)).trim() } catch (err) {
        if (err instanceof ApiError && err.status === 422) return ''
        console.warn('[plan] chunk transcribe failed', attempt ? '(dropped)' : '(retrying)', d.errText(err))
      }
    }
    return ''
  }

  /** Queue one chunk's transcript at its place in the order. */
  function addChunk(r: Run, wav: Uint8Array): void {
    const i = r.texts.length
    r.texts.push('')
    r.parts.push(transcribe(wav, r.classId).then(text => {
      r.texts[i] = text
      if (run === r) d.dispatch({ type: 'planHeard', text: heard(r) })
    }))
  }

  function cut(r: Run): void {
    if (run !== r || !d.recorder.recording) return
    const res = d.recorder.cut()
    if (res.wav) addChunk(r, res.wav)
  }

  async function start(classId: string): Promise<void> {
    if (run) cancelRun(run)
    const r: Run = { classId, startedAt: Date.now(), texts: [], parts: [], timers: [] }
    run = r
    try { await d.recorder.start() } catch (err) {
      console.error('[plan] mic start failed', err)
      if (run === r) run = null
      return d.dispatch({ type: 'planFailed', message: 'Mic unavailable · check permission' })
    }
    if (run !== r) return
    r.timers.push(setInterval(() => cut(r), PLAN_CHUNK_MS))
    r.timers.push(setInterval(() => {
      if (run === r) d.dispatch({ type: 'planTick', sec: Math.floor((Date.now() - r.startedAt) / 1000) })
    }, PLAN_TICK_MS))
    r.timers.push(setTimeout(() => { if (run === r && d.screen() === 'planning') d.dispatch({ type: 'tap', now: Date.now() }) }, PLAN_MAX_MS))
  }

  /** Stop: transcribe the remainder, join every chunk in order, then apply the plan edit. */
  async function stop(): Promise<void> {
    const r = run
    if (!r) return
    clearTimers(r)
    try {
      const res = await d.recorder.stop()
      if (res.wav) addChunk(r, res.wav)
    } catch (err) { console.warn('[plan] mic stop failed', err) }
    await Promise.all(r.parts)
    if (run !== r) return
    run = null
    const transcript = heard(r)
    if (!transcript) return d.dispatch({ type: 'planFailed', message: "Didn't catch that · 2× to try again" })
    d.dispatch({ type: 'planApplying' })
    try {
      d.dispatch({ type: 'planResult', res: await d.api.voicePlan(r.classId, transcript) })
    } catch (err) {
      const why = err instanceof ApiError && err.status === 409 ? err.message : d.errText(err)
      d.dispatch({ type: 'planFailed', message: `Plan not changed · ${why}` })
    }
  }

  function cancelRun(r: Run): void {
    clearTimers(r)
    if (run === r) run = null
  }

  /** Cancel: drop everything heard and release the mic. */
  async function cancel(): Promise<void> {
    if (run) cancelRun(run)
    await d.recorder.cancel()
  }

  return { start, stop, cancel, get active() { return run !== null } }
}
