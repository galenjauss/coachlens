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
  /** The pepper before a change (PAIRING_PEPPER_PREVIOUS): codes hashed with it still match once and are upgraded. */
  pairingPepperPrevious?: string
  /** Per-instructor daily Anthropic-call cap (AI_INSTRUCTOR_DAILY_CAP); absent = the global cap. The global cap stays the ceiling. */
  aiInstructorDailyCap?: number | null
  /** Self-serve accounts' own AI pool (PUBLIC_AI_DAILY_CAP / PUBLIC_AI_ACCOUNT_DAILY_CAP); absent = the operator caps. */
  publicAi?: { cap: number; instructorCap: number }
  /** New self-serve accounts allowed per local day across the deployment (SIGNUP_DAILY_CAP); absent = 100. */
  signupDailyCap?: number
  /** Instructor emails whose approved parent emails CoachLens sends itself (MAIL_SENDERS, plus the demo coach). */
  mailSenders?: string[]
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
