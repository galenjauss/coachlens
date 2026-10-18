import type { z } from 'zod'
import type { Db } from './db/client'

/** An inline image for vision calls (base64, no data: prefix). */
export interface LlmImage { data: string; mediaType: string }
export interface Llm {
  object<T>(args: { name: string; instructions: string; prompt: string; schema: z.ZodType<T>; images?: LlmImage[] }): Promise<T>
}
export interface Transcriber { transcribe(wav: Uint8Array, hints: string[]): Promise<string> }
export interface MailMsg { to: string; subject: string; text: string }
export interface Mailer { send(m: MailMsg): Promise<{ id: string }> }
export interface Env {
  pairingCode: string
  cronSecret: string
  allowedOrigins: string[] // ['*'] allowed in dev only
  demoEmailOverride: string | null
  instructorName: string
  timeZone: string // 'America/Los_Angeles'
  /** Daily Anthropic-call cap (AI_DAILY_CAP), reported by /v1/status; null/absent = no cap. */
  aiDailyCap?: number | null
  /** Server secret keying pairing-code hashes (PAIRING_PEPPER); absent = the development pepper. */
  pairingPepper?: string
  /** Per-instructor daily Anthropic-call cap (AI_INSTRUCTOR_DAILY_CAP); absent = the global cap. The global cap stays the ceiling. */
  aiInstructorDailyCap?: number | null
  /** False when no speech-to-text key is configured (transcription then fails with 503); absent = configured. */
  sttConfigured?: boolean
}

/** Speech-to-text has no provider key: the route answers 503 instead of a generic error. */
export class SttUnavailableError extends Error {
  constructor() {
    super('speech-to-text is not configured')
    this.name = 'SttUnavailableError'
  }
}
export interface Deps {
  db: Db
  llm: Llm
  stt: Transcriber
  mail: Mailer
  now: () => Date
  defer: (p: Promise<unknown>) => void
  env: Env
}
