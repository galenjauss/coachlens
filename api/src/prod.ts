import { pairingPepperFrom } from './services/pairing'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { waitUntil } from '@vercel/functions'
import * as schema from './db/schema'
import type { Db } from './db/client'
import { SttUnavailableError, type Deps } from './deps'
import { anthropicLlm, MODEL_FAST, MODEL_SMART } from './agents/llm'
import { dailyMeter, dbBudget } from './agents/budget'
import { isSelfServe } from './services/accounts'

/** Self-serve per-account daily defaults: about one busy class of notes plus its follow-up and planning. */
const DEFAULT_AI_PER_COACH = 40
const DEFAULT_STT_PER_COACH = 60

const positive = (k: string, fallback: number): number => {
  const v = Number(process.env[k] || fallback)
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${k} must be a positive number`)
  return v
}

const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export function prodDeps(): Deps {
  const db = drizzle({ client: neon(need('DATABASE_URL')), schema }) as unknown as Db
  need('ANTHROPIC_API_KEY') // read by @ai-sdk/anthropic; fail fast if absent
  // Optional: without it the API still runs (typed notes work) and /v1/status reports speech-to-text as unconfigured.
  const openaiKey = process.env.OPENAI_API_KEY || null
  if (!openaiKey) console.warn('[prod] OPENAI_API_KEY not set: speech-to-text disabled (503)')
  const resendKey = need('RESEND_API_KEY')
  const from = need('MAIL_FROM')
  const pairingCode = need('PAIRING_CODE')
  if (pairingCode.length < 6) throw new Error('PAIRING_CODE must be at least 6 characters')
  const cronSecret = need('CRON_SECRET')
  const allowedOrigins = need('ALLOWED_ORIGINS').split(',').map(s => s.trim())
  if (allowedOrigins.includes('*')) console.warn('[prod] ALLOWED_ORIGINS=* (any origin); narrow it to the WebView origin')
  // Spend ceilings. Anyone can create an account, so every paid call is capped per account AND per day overall:
  // the deployment-wide caps bound the worst-case daily bill however many accounts exist.
  const cap = positive('AI_DAILY_CAP', 400)
  // Operator accounts (demo coach, schools you set up): unset per-account cap = the whole operator pool, as before.
  const instructorCap = Math.min(cap, positive('AI_INSTRUCTOR_DAILY_CAP', cap))
  const sttCap = positive('STT_DAILY_CAP', 1500)
  const sttInstructorCap = Math.min(sttCap, positive('STT_INSTRUCTOR_DAILY_CAP', sttCap))
  // Self-serve accounts spend from a separate pool, so sign-ups can never use up the operator's day.
  const publicAiCap = positive('PUBLIC_AI_DAILY_CAP', 300)
  const publicAi = { cap: publicAiCap, instructorCap: Math.min(publicAiCap, positive('PUBLIC_AI_ACCOUNT_DAILY_CAP', DEFAULT_AI_PER_COACH)) }
  const publicSttCap = positive('PUBLIC_STT_DAILY_CAP', 1000)
  const publicStt = { cap: publicSttCap, instructorCap: Math.min(publicSttCap, positive('PUBLIC_STT_ACCOUNT_DAILY_CAP', DEFAULT_STT_PER_COACH)) }
  const isPublic = (id: string) => isSelfServe(db, id)
  const signupDailyCap = positive('SIGNUP_DAILY_CAP', 100)
  // Pairing-code hashes are keyed by a server secret: PAIRING_PEPPER, else one derived from CRON_SECRET.
  const pairingPepper = pairingPepperFrom({ PAIRING_PEPPER: process.env.PAIRING_PEPPER, CRON_SECRET: need('CRON_SECRET') })
  const timeZone = process.env.TZ_NAME ?? 'America/Los_Angeles'
  const sttBudget = dailyMeter(db, { meter: 'stt', cap: sttCap, instructorCap: sttInstructorCap, tz: timeZone, now: () => new Date(), publicPool: { ...publicStt, isPublic } })
  return {
    db,
    llm: anthropicLlm({
      fast: process.env.MODEL_FAST || MODEL_FAST,
      smart: process.env.MODEL_SMART || MODEL_SMART,
      budget: dbBudget(db, cap, timeZone, () => new Date(), instructorCap, { ...publicAi, isPublic }),
    }),
    stt: {
      async transcribe(wav, hints) {
        if (!openaiKey) throw new SttUnavailableError()
        await sttBudget.take() // BudgetExceededError('stt') -> 429 stt_budget_reached; the phone keeps the note and retries
        const { default: OpenAI, toFile } = await import('openai')
        const openai = new OpenAI({ apiKey: openaiKey })
        const r = await openai.audio.transcriptions.create({
          file: await toFile(Buffer.from(wav), 'note.wav', { type: 'audio/wav' }),
          model: process.env.STT_MODEL || 'gpt-4o-mini-transcribe',
          prompt: `A coach or instructor speaking during a session. Student names: ${hints.join(', ')}.`,
        })
        return r.text
      },
    },
    mail: {
      async send(m) {
        const { Resend } = await import('resend')
        const resend = new Resend(resendKey)
        const { data, error } = await resend.emails.send({ from, to: m.to, subject: m.subject, text: m.text })
        if (error || !data) throw new Error(error?.message ?? 'send failed')
        return { id: data.id }
      },
    },
    now: () => new Date(),
    defer: p => waitUntil(p.catch(e => console.error('[defer]', e))),
    env: {
      pairingCode,
      cronSecret,
      allowedOrigins,
      demoEmailOverride: process.env.DEMO_EMAIL_OVERRIDE || null,
      instructorName: process.env.INSTRUCTOR_NAME ?? 'Coach',
      timeZone,
      aiDailyCap: cap,
      aiInstructorDailyCap: instructorCap,
      publicAi,
      signupDailyCap,
      // Only these accounts' approved emails are sent by CoachLens (the demo coach by default); everyone else gets
      // drafts to send from their own email app, so the service never mails strangers on a new account's say-so.
      mailSenders: (process.env.MAIL_SENDERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
      pairingPepper,
      pairingPepperPrevious: process.env.PAIRING_PEPPER_PREVIOUS || undefined,
      sttConfigured: Boolean(openaiKey),
    },
  }
}
