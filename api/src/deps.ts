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
