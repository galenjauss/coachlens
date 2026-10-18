import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { waitUntil } from '@vercel/functions'
import * as schema from './db/schema'
import type { Db } from './db/client'
import type { Deps } from './deps'
import { anthropicLlm, MODEL_FAST, MODEL_SMART } from './agents/llm'
import { dbBudget } from './agents/budget'

const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`missing env ${k}`)
  return v
}

export function prodDeps(): Deps {
  const db = drizzle({ client: neon(need('DATABASE_URL')), schema }) as unknown as Db
  need('ANTHROPIC_API_KEY') // read by @ai-sdk/anthropic; fail fast if absent
  const openaiKey = need('OPENAI_API_KEY')
  const resendKey = need('RESEND_API_KEY')
  const from = need('MAIL_FROM')
  const pairingCode = need('PAIRING_CODE')
  if (pairingCode.length < 6) throw new Error('PAIRING_CODE must be at least 6 characters')
  const cronSecret = need('CRON_SECRET')
  const allowedOrigins = need('ALLOWED_ORIGINS').split(',').map(s => s.trim())
  if (allowedOrigins.includes('*')) console.warn('[prod] ALLOWED_ORIGINS=* (any origin); narrow it to the WebView origin')
  const cap = Number(process.env.AI_DAILY_CAP || 400)
  if (!Number.isFinite(cap) || cap <= 0) throw new Error('AI_DAILY_CAP must be a positive number')
  const timeZone = process.env.TZ_NAME ?? 'America/Los_Angeles'
  return {
    db,
    llm: anthropicLlm({
      fast: process.env.MODEL_FAST || MODEL_FAST,
      smart: process.env.MODEL_SMART || MODEL_SMART,
      budget: dbBudget(db, cap, timeZone, () => new Date()),
    }),
    stt: {
      async transcribe(wav, hints) {
        const { default: OpenAI, toFile } = await import('openai')
        const openai = new OpenAI({ apiKey: openaiKey })
        const r = await openai.audio.transcriptions.create({
          file: await toFile(Buffer.from(wav), 'note.wav', { type: 'audio/wav' }),
          model: process.env.STT_MODEL ?? 'gpt-4o-transcribe',
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
    },
  }
}
