import { AudioInputSource } from '@evenrealities/even_hub_sdk'
import { pcmToWav } from './wav'

export const MAX_RECORD_MS = 20_000
const MIN_BYTES = 16000 * 2 * 0.4

type AudioBridge = { audioControl(isOpen: boolean, source?: AudioInputSource): Promise<boolean> }

export class Recorder {
  private chunks: Uint8Array[] = []
  recording = false
  constructor(private bridge: AudioBridge) {}
  async start() {
    this.chunks = []
    this.recording = true
    const ok = await this.bridge.audioControl(true, AudioInputSource.Glasses)
    if (!ok) { this.recording = false; throw new Error('mic unavailable') }
  }
  push(pcm: Uint8Array) { if (this.recording) this.chunks.push(pcm) }
  async stop(): Promise<Uint8Array | null> {
    this.recording = false
    await this.bridge.audioControl(false)
    const bytes = this.chunks.reduce((n, c) => n + c.length, 0)
    return bytes < MIN_BYTES ? null : pcmToWav(this.chunks)
  }
  async cancel() { this.recording = false; this.chunks = []; await this.bridge.audioControl(false) }
}
