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

/** RMS of little-endian s16 PCM. */
function rms(pcm: Uint8Array): number {
  const n = Math.floor(pcm.length / 2)
  if (!n) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2)
  let sum = 0
  for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true); sum += v * v }
  return Math.sqrt(sum / n)
}

export class Recorder {
  private chunks: Uint8Array[] = []
  private level = 0
  recording = false
  source: MicSource = 'glasses'
  bytes = 0
  constructor(private bridge: AudioBridge) {}

  async start() {
    if (this.recording) return
    this.chunks = []
    this.bytes = 0
    this.level = 0
    this.source = 'glasses'
    this.recording = true
    try {
      const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses)
      if (!ok) throw new Error('mic unavailable')
    } catch (e) {
      this.recording = false
      throw e
    }
  }

  /** No glasses audio arrived: record from the phone mic instead. Returns false if it could not switch. */
  async switchToPhone(): Promise<boolean> {
    if (!this.recording || this.source === 'phone') return false
    try {
      const ok = await this.bridge.audioControl(true, AudioInputSource.Phone)
      if (ok) this.source = 'phone'
      return ok
    } catch (e) {
      console.warn('[mic] phone mic unavailable', e)
      return false
    }
  }

  /** Re-open the current source (the host may close the mic while backgrounded). */
  rearm(): Promise<boolean> {
    return this.bridge.audioControl(true, this.source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses)
  }

  push(pcm: Uint8Array) {
    if (!this.recording) return
    this.chunks.push(pcm)
    this.bytes += pcm.length
    this.level = Math.max(rms(pcm), this.level * 0.6) // decays between chunks
  }

  /** Live level 0..5 for the "hearing you" bar. */
  bars(): number {
    if (!this.bytes) return 0
    return Math.max(1, Math.min(5, Math.ceil(this.level / 800)))
  }

  async stop(): Promise<StopResult> {
    this.recording = false
    await this.bridge.audioControl(false)
    const bytes = this.bytes
    if (bytes === 0) return { wav: null, bytes, reason: 'no_audio' }
    if (bytes < MIN_BYTES) return { wav: null, bytes, reason: 'too_short' }
    return { wav: pcmToWav(this.chunks), bytes }
  }

  async cancel() { this.recording = false; this.chunks = []; this.bytes = 0; await this.bridge.audioControl(false) }
}
