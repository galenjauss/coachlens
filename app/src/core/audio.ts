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

/** Even's documented block glyphs, quietest → loudest. */
export const WAVE_GLYPHS = '▁▂▃▄▅▆▇█'
/** Bars in the scrolling waveform (newest on the right). */
export const WAVE_BARS = 14
/** Soft noise floor and "loud" reference (s16 RMS); levels are log-spaced between them. */
export const NOISE_FLOOR_RMS = 150
export const LOUD_RMS = 6000

/** RMS → level 0..7: at/under the noise floor is 0, then log-spaced up to LOUD_RMS (clamped). */
export function levelOf(r: number): number {
  if (!(r > NOISE_FLOOR_RMS)) return 0
  return Math.max(0, Math.min(7, Math.round((Math.log(r / NOISE_FLOOR_RMS) / Math.log(LOUD_RMS / NOISE_FLOOR_RMS)) * 7)))
}

/** The last `n` levels as block glyphs, left-padded with the quietest glyph; newest on the right. */
export function waveform(levels: number[], n = WAVE_BARS): string {
  const recent = levels.slice(-n)
  return WAVE_GLYPHS[0]!.repeat(n - recent.length) + recent.map(l => WAVE_GLYPHS[Math.max(0, Math.min(7, l))]).join('')
}

/** RMS of little-endian s16 PCM. */
export function rms(pcm: Uint8Array): number {
  const n = Math.floor(pcm.length / 2)
  if (!n) return 0
  const view = new DataView(pcm.buffer, pcm.byteOffset, n * 2)
  let sum = 0
  for (let i = 0; i < n; i++) { const v = view.getInt16(i * 2, true); sum += v * v }
  return Math.sqrt(sum / n)
}

export class Recorder {
  private chunks: Uint8Array[] = []
  private levels: number[] = []
  recording = false
  source: MicSource = 'glasses'
  bytes = 0
  constructor(private bridge: AudioBridge) {}

  async start() {
    if (this.recording) return
    this.chunks = []
    this.bytes = 0
    this.levels = []
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

  /**
   * No glasses audio arrived: close the glasses mic, then record from the phone mic with a fresh
   * buffer (the two sources never mix in one WAV). Returns false, and re-opens the glasses mic,
   * if the phone mic could not be opened.
   */
  async switchToPhone(): Promise<boolean> {
    if (!this.recording || this.source === 'phone') return false
    try {
      await this.bridge.audioControl(false)
      const ok = await this.bridge.audioControl(true, AudioInputSource.Phone)
      if (!ok) throw new Error('phone mic refused')
      this.source = 'phone'
      this.chunks = []
      this.bytes = 0
      this.levels = []
      return true
    } catch (e) {
      console.warn('[mic] phone mic unavailable; staying on the glasses mic', e)
      await this.bridge.audioControl(true, AudioInputSource.Glasses).catch(err => console.warn('[mic] glasses re-open failed', err))
      return false
    }
  }

  /** Re-open the current source (the host may close the mic while backgrounded). */
  rearm(): Promise<boolean> {
    return this.bridge.audioControl(true, this.source === 'phone' ? AudioInputSource.Phone : AudioInputSource.Glasses)
  }

  /** Add PCM from the current source; chunks tagged with the other source (e.g. late glasses audio after the switch) are dropped. */
  push(pcm: Uint8Array, source?: string) {
    if (!this.recording) return
    if (source && source !== this.source) return
    this.chunks.push(pcm)
    this.bytes += pcm.length
    this.levels.push(levelOf(rms(pcm))) // one bar per chunk
    if (this.levels.length > 64) this.levels = this.levels.slice(-WAVE_BARS)
  }

  /** Scrolling waveform of recent chunk levels ('' until audio arrives). */
  wave(): string {
    return this.levels.length ? waveform(this.levels) : ''
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
