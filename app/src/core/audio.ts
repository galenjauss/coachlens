import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { pcmToWav } from './wav'

export const MAX_RECORD_MS = 20_000
/** Below this the clip is not sent (0.4 s of 16 kHz s16le mono). */
export const MIN_BYTES = 16000 * 2 * 0.4
export type MicSource = 'glasses' | 'phone'
/** Why a recording produced nothing to send. */
export type EmptyReason = 'no_audio' | 'too_short' | 'not_understood' | 'quiet'

type AudioBridge = { audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean> }
/**
 * `lowEnergy`: the clip had less speech-level audio than MIN_SPEECH_MS. It is STILL sent (the gate is not
 * calibrated on hardware; the server's transcriber decides); the lens only uses it to word an empty result
 * as "Couldn't hear you · move closer, speak up".
 */
export type StopResult = { wav: Uint8Array; bytes: number; lowEnergy?: boolean } | { wav: null; bytes: number; reason: Exclude<EmptyReason, 'not_understood' | 'quiet'> }
export interface RecorderOptions {
  /** Open the glasses and phone mics together and buffer both (see `selectMic`). */
  dual?: boolean
}

const SDK_SOURCE: Record<MicSource, AudioInputSource> = { glasses: AudioInputSource.Glasses, phone: AudioInputSource.Phone }

/**
 * F14 speech energy. Used to SELECT the mic (never to discard audio). A 20 ms frame (320 samples of 16 kHz s16le) counts as speech when its RMS is at
 * least SPEECH_RMS (≈ -38 dBFS: well under talking at arm's length, well over a quiet room). A source has
 * usable speech with at least MIN_SPEECH_MS of such frames. Conservative on purpose: a false "quiet" would
 * drop a real note, so the threshold is low; calibrate on G2 hardware.
 */
export const SPEECH_RMS = 400
export const MIN_SPEECH_MS = 200
const FRAME_SAMPLES = 320
const MS_PER_SAMPLE = 1000 / 16000

/** Milliseconds of speech-level frames in one PCM chunk (s16le mono 16 kHz). */
export function speechMsIn(pcm: Uint8Array): number {
  const samples = Math.floor(pcm.length / 2)
  const v = new DataView(pcm.buffer, pcm.byteOffset, samples * 2)
  let ms = 0
  for (let start = 0; start < samples; start += FRAME_SAMPLES) {
    const end = Math.min(samples, start + FRAME_SAMPLES)
    if (end - start < FRAME_SAMPLES / 2) break // a short tail frame is too little to judge
    let sum = 0
    for (let i = start; i < end; i++) { const x = v.getInt16(i * 2, true); sum += x * x }
    if (Math.sqrt(sum / (end - start)) >= SPEECH_RMS) ms += (end - start) * MS_PER_SAMPLE
  }
  return ms
}

export type MicStats = { bytes: number; speechMs: number }
/**
 * Dual-mic pick on stop, by audio ENERGY rather than bytes received (F14): the glasses when they carry
 * usable speech, else the phone when it does (glasses silent → phone fallback), else the louder of the
 * two; with no speech anywhere, the source that has audio (glasses first) so the empty/quiet reason is right.
 */
export function selectMic(glasses: MicStats, phone: MicStats): MicSource {
  if (glasses.speechMs >= MIN_SPEECH_MS) return 'glasses'
  if (phone.speechMs >= MIN_SPEECH_MS) return 'phone'
  if (phone.speechMs > glasses.speechMs) return 'phone'
  if (glasses.bytes >= MIN_BYTES || phone.bytes === 0) return 'glasses'
  return 'phone'
}

type Buffer = { chunks: Uint8Array[]; bytes: number; speechMs: number }
const emptyBuffer = (): Buffer => ({ chunks: [], bytes: 0, speechMs: 0 })
const emptyBuffers = (): Record<MicSource, Buffer> => ({ glasses: emptyBuffer(), phone: emptyBuffer() })

/** A finished buffer → what to send (flagged lowEnergy when quiet: still sent), or why not: no audio or too short. */
function result(b: Buffer): StopResult {
  if (b.bytes === 0) return { wav: null, bytes: 0, reason: 'no_audio' }
  if (b.bytes < MIN_BYTES) return { wav: null, bytes: b.bytes, reason: 'too_short' }
  return { wav: pcmToWav(b.chunks), bytes: b.bytes, ...(b.speechMs < MIN_SPEECH_MS ? { lowEnergy: true } : {}) }
}

export class Recorder {
  private buf = emptyBuffers()
  /** Phone mic opened alongside the glasses one (dual mode). */
  private phoneOpen = false
  recording = false
  /** Single mode: the mic being recorded. Dual mode: 'glasses' while recording, the picked mic after stop. */
  source: MicSource = 'glasses'
  readonly dual: boolean
  constructor(private bridge: AudioBridge, opts: RecorderOptions = {}) { this.dual = opts.dual ?? false }

  /** Bytes buffered so far (dual mode: both mics together). */
  get bytes(): number { return this.dual ? this.buf.glasses.bytes + this.buf.phone.bytes : this.buf[this.source].bytes }
  bytesFrom(src: MicSource): number { return this.buf[src].bytes }
  /** Milliseconds of speech-level audio buffered from one mic. */
  speechFrom(src: MicSource): number { return this.buf[src].speechMs }

  async start() {
    if (this.recording) return
    this.buf = emptyBuffers()
    this.source = 'glasses'
    this.phoneOpen = false
    this.recording = true
    if (this.dual) return this.startBoth()
    try {
      const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses)
      if (!ok) throw new Error('mic unavailable')
    } catch (e) {
      this.recording = false
      throw e
    }
  }

  /** Dual: open both mics at once. Fails only when neither opens. */
  private async startBoth(): Promise<void> {
    const open = (src: MicSource) => this.bridge.audioControl(true, SDK_SOURCE[src]).then(ok => ok, e => { console.warn('[mic] open failed', src, e); return false })
    const [glasses, phone] = await Promise.all([open('glasses'), open('phone')])
    this.phoneOpen = phone
    if (!phone) console.warn('[mic] phone mic unavailable; recording from the glasses only')
    if (!glasses && !phone) {
      this.recording = false
      throw new Error('mic unavailable')
    }
  }

  /**
   * Single mode, no glasses audio arrived: close the glasses mic, then record from the phone mic with
   * a fresh buffer (the two sources never mix in one WAV). Returns false, and re-opens the glasses
   * mic, if the phone mic could not be opened. Dual mode never switches (both are already open).
   */
  async switchToPhone(): Promise<boolean> {
    if (!this.recording || this.dual || this.source === 'phone') return false
    try {
      await this.bridge.audioControl(false)
      const ok = await this.bridge.audioControl(true, AudioInputSource.Phone)
      if (!ok) throw new Error('phone mic refused')
      this.source = 'phone'
      this.buf.phone = emptyBuffer()
      return true
    } catch (e) {
      console.warn('[mic] phone mic unavailable; staying on the glasses mic', e)
      await this.bridge.audioControl(true, AudioInputSource.Glasses).catch(err => console.warn('[mic] glasses re-open failed', err))
      return false
    }
  }

  /** Re-open the open mic(s) (the host may close the mic while backgrounded). */
  async rearm(): Promise<boolean> {
    if (!this.dual) return this.bridge.audioControl(true, SDK_SOURCE[this.source])
    const glasses = await this.bridge.audioControl(true, AudioInputSource.Glasses)
    if (this.phoneOpen) await this.bridge.audioControl(true, AudioInputSource.Phone).catch(e => console.warn('[mic] phone re-arm failed', e))
    return glasses
  }

  /**
   * Add PCM. Single mode: only from the current source (late glasses audio after the switch is
   * dropped). Dual mode: into that source's buffer. Untagged chunks count as the current/glasses mic.
   */
  push(pcm: Uint8Array, source?: string) {
    if (!this.recording) return
    if (this.dual && !source && this.phoneOpen) this.untaggedInDual()
    let src: MicSource = this.source
    if (source === 'glasses' || source === 'phone') src = source
    else if (source) return
    if (!this.dual && src !== this.source) return
    if (this.dual && src === 'phone' && !this.phoneOpen) return // phone mic closed (or never opened)
    const b = this.buf[src]
    b.chunks.push(pcm)
    b.bytes += pcm.length
    b.speechMs += speechMsIn(pcm)
  }

  /**
   * The host sends untagged PCM: with both mics open the two streams would interleave in one buffer.
   * Close the phone mic and record this note from the glasses only.
   */
  private untaggedInDual(): void {
    console.warn('[mic] untagged audio with both mics open: closing the phone mic for this recording')
    this.phoneOpen = false
    this.buf.phone = emptyBuffer()
    void this.bridge.audioControl(false, AudioInputSource.Phone).catch(e => console.warn('[mic] phone close failed', e))
  }

  /** Close every mic this recording opened (dual: both, then the plain close). */
  private async release(): Promise<void> {
    if (this.dual) {
      const close = (src: AudioInputSource) => this.bridge.audioControl(false, src).catch(e => console.warn('[mic] close failed', src, e))
      await Promise.all([close(AudioInputSource.Glasses), ...(this.phoneOpen ? [close(AudioInputSource.Phone)] : [])])
      this.phoneOpen = false
    }
    await this.bridge.audioControl(false)
  }

  /**
   * Long recordings (planning listen): take the audio buffered since the last cut as one WAV and keep
   * the mic open. Dual mode picks the mic per cut (`selectMic`); a later `stop()` returns the remainder.
   */
  cut(): StopResult {
    const src = this.dual ? selectMic(this.buf.glasses, this.buf.phone) : this.source
    const b = this.buf[src]
    this.buf = emptyBuffers()
    return result(b)
  }

  async stop(): Promise<StopResult> {
    this.recording = false
    await this.release()
    if (this.dual) this.source = selectMic(this.buf.glasses, this.buf.phone)
    return result(this.buf[this.source])
  }

  async cancel() { this.recording = false; this.buf = emptyBuffers(); await this.release() }
}
