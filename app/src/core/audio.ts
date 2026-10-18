import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { pcmToWav } from './wav'

export const MAX_RECORD_MS = 20_000
/** Below this the clip is not sent (0.4 s of 16 kHz s16le mono). */
export const MIN_BYTES = 16000 * 2 * 0.4
export type MicSource = 'glasses' | 'phone'
/** Why a recording produced nothing to send. */
export type EmptyReason = 'no_audio' | 'too_short' | 'not_understood'

type AudioBridge = { audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean> }
export type StopResult = { wav: Uint8Array; bytes: number } | { wav: null; bytes: number; reason: Exclude<EmptyReason, 'not_understood'> }
export interface RecorderOptions {
  /** Open the glasses and phone mics together and buffer both (see `selectMic`). */
  dual?: boolean
}

const SDK_SOURCE: Record<MicSource, AudioInputSource> = { glasses: AudioInputSource.Glasses, phone: AudioInputSource.Phone }

/**
 * Dual-mic pick on stop: the glasses audio when it has at least `minBytes` (0.4 s), otherwise the
 * phone audio; with no phone audio either, the glasses buffer (so the empty reason stays right).
 */
export function selectMic(glassesBytes: number, phoneBytes: number, minBytes = MIN_BYTES): MicSource {
  if (glassesBytes >= minBytes) return 'glasses'
  return phoneBytes > 0 ? 'phone' : 'glasses'
}

type Buffer = { chunks: Uint8Array[]; bytes: number }
const emptyBuffers = (): Record<MicSource, Buffer> => ({ glasses: { chunks: [], bytes: 0 }, phone: { chunks: [], bytes: 0 } })

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
      this.buf.phone = { chunks: [], bytes: 0 }
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
  }

  /**
   * The host sends untagged PCM: with both mics open the two streams would interleave in one buffer.
   * Close the phone mic and record this note from the glasses only.
   */
  private untaggedInDual(): void {
    console.warn('[mic] untagged audio with both mics open: closing the phone mic for this recording')
    this.phoneOpen = false
    this.buf.phone = { chunks: [], bytes: 0 }
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
    const src = this.dual ? selectMic(this.buf.glasses.bytes, this.buf.phone.bytes) : this.source
    const { chunks, bytes } = this.buf[src]
    this.buf = emptyBuffers()
    if (bytes === 0) return { wav: null, bytes, reason: 'no_audio' }
    if (bytes < MIN_BYTES) return { wav: null, bytes, reason: 'too_short' }
    return { wav: pcmToWav(chunks), bytes }
  }

  async stop(): Promise<StopResult> {
    this.recording = false
    await this.release()
    if (this.dual) this.source = selectMic(this.buf.glasses.bytes, this.buf.phone.bytes)
    const { chunks, bytes } = this.buf[this.source]
    if (bytes === 0) return { wav: null, bytes, reason: 'no_audio' }
    if (bytes < MIN_BYTES) return { wav: null, bytes, reason: 'too_short' }
    return { wav: pcmToWav(chunks), bytes }
  }

  async cancel() { this.recording = false; this.buf = emptyBuffers(); await this.release() }
}
