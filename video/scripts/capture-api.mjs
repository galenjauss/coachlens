#!/usr/bin/env -S npx tsx
/**
 * Local CoachLens API for the phone captures: the REAL api (createApp from api/src/app.ts, real services,
 * real detectors) on port 8787, over a local Postgres (PGlite, persisted in video/.capture-db, migrated
 * with the real drizzle migrations and filled by the real demo seed).
 *
 *   npx tsx video/scripts/capture-api.mjs           # run from the repo root
 *
 * Safety: no network side effects. Mail never leaves the process (a local stub logs and returns a fake id),
 * speech-to-text is off, and the LLM is a scripted stand-in that answers only the parent-email draft the
 * "Do it" capture needs (every other model call fails fast, which the api handles like an outage).
 * Env comes from video/.capture.env (gitignored): PAIRING_CODE, CRON_SECRET, DEMO_EMAIL_OVERRIDE. Never printed.
 *
 * On first run (empty data dir) it also inserts the rows a few minutes of real use would have left behind:
 * Dee's urgent parent-email draft (pending review), Priya's 3rd guard note, agent runs for the Agents tab, and
 * parent emails on Auto (the capture switches them to Review).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { eq } from 'drizzle-orm'
import { serve } from '@hono/node-server'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = join(ROOT, 'api')
const DATA = join(ROOT, 'video', '.capture-db')
const ENV_FILE = join(ROOT, 'video', '.capture.env')
const PORT = 8787
const APP_ORIGIN = 'http://localhost:5190'
const TZ = 'America/Los_Angeles'
const MODEL_LATENCY_MS = 2500

const env = Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
if (!env.PAIRING_CODE || env.PAIRING_CODE.length < 6) throw new Error('video/.capture.env needs PAIRING_CODE (>= 6 chars)')
if (!env.CRON_SECRET) throw new Error('video/.capture.env needs CRON_SECRET')
if (env.RESEND_API_KEY !== 're_test_disabled') throw new Error('RESEND_API_KEY must be re_test_disabled for captures')

const schema = await import(join(API, 'src/db/schema.ts'))
const { createApp } = await import(join(API, 'src/app.ts'))
const { seed } = await import(join(API, 'src/db/seed.ts'))
const { localDate } = await import(join(API, 'src/logic/dates.ts'))

const fresh = !existsSync(join(DATA, 'PG_VERSION'))
const client = new PGlite(DATA)
const db = drizzle({ client, schema })
await migrate(db, { migrationsFolder: join(API, 'drizzle') })

const now = () => new Date()
const minutesAgo = m => new Date(Date.now() - m * 60_000)

if (fresh) {
  const r = await seed(db, { today: localDate(now(), TZ), guardianEmail: () => env.DEMO_EMAIL_OVERRIDE })
  const t = schema
  const [dee] = await db.select().from(t.students).where(eq(t.students.name, 'Dee Park'))
  const [priya] = await db.select().from(t.students).where(eq(t.students.name, 'Priya Rao'))
  const [maria] = await db.select().from(t.students).where(eq(t.students.name, 'Maria Gomez'))

  const [uDee] = await db.insert(t.utterances).values({ transcript: 'Dee rolled her ankle and sat out the last drill', mode: 'note', createdAt: minutesAgo(42) }).returning()
  const [nDee] = await db.insert(t.notes).values({ studentId: dee.id, utteranceId: uDee.id, text: 'Rolled her ankle and sat out the last drill', tags: ['injury'], createdAt: minutesAgo(42) }).returning()
  const [mail] = await db.insert(t.outbox).values({
    kind: 'parent_email', studentId: dee.id, toEmail: env.DEMO_EMAIL_OVERRIDE, trigger: 'urgent', status: 'pending_review', createdAt: minutesAgo(41),
    subject: 'Dee sat out the last drill',
    body: 'Hi Park family,\n\nDee rolled her ankle during class today, so she sat out the last drill and rested it with ice. She was in good spirits and walked out on her own, but please keep an eye on it tonight and let us know if it is still sore before Thursday.\n\nCoach Galen',
  }).returning()

  const [uPriya] = await db.insert(t.utterances).values({ transcript: 'Priya keeps dropping her guard on the jab', mode: 'note', createdAt: minutesAgo(55) }).returning()
  const [nPriya] = await db.insert(t.notes).values({ studentId: priya.id, utteranceId: uPriya.id, text: 'Keeps dropping her guard on the jab', tags: ['guard'], createdAt: minutesAgo(55) }).returning()
  const [uMaria] = await db.insert(t.utterances).values({ transcript: 'Maria hit 225 on deadlift', mode: 'note', createdAt: minutesAgo(30) }).returning()
  const [uRoll] = await db.insert(t.utterances).values({ transcript: 'Everyone except Mia', mode: 'attendance', createdAt: minutesAgo(70) }).returning()

  const run = (agent, trigger, summary, reason, at, extra = {}) => ({ agent, trigger, summary, reason, status: 'ok', ms: 900 + Math.round(Math.random() * 1800), createdAt: minutesAgo(at), ...extra })
  await db.insert(t.agentRuns).values([
    run('attendance', 'roll_call', '13 present · absent: Mia', 'coach said "everyone except Mia"', 70, { utteranceId: uRoll.id }),
    run('router', 'utterance', 'progress note · Priya', 'feedback about a named student', 55, { utteranceId: uPriya.id }),
    run('progress', 'feedback', 'Priya: guard (3rd time)', 'guard noted 3 times this month: recurring', 55, { utteranceId: uPriya.id, links: { noteId: nPriya.id, studentId: priya.id } }),
    run('report_card', 'recurring', 'Priya: guard added to the October report card', 'recurring focus area', 54, { utteranceId: uPriya.id, links: { studentId: priya.id } }),
    run('planner', 'recurring', 'Next deck: +2m on the guard-up jab drill', 'guard is a recurring focus for 4 kids', 54, { utteranceId: uPriya.id }),
    run('router', 'utterance', 'urgent note · Dee', 'injury mentioned: urgent', 42, { utteranceId: uDee.id }),
    run('progress', 'feedback', 'Dee: injury (urgent)', 'urgent: injury', 42, { utteranceId: uDee.id, links: { noteId: nDee.id, studentId: dee.id } }),
    run('parent_email', 'urgent', 'Drafted "Dee sat out the last drill"', 'urgent note: parent email for review', 41, { utteranceId: uDee.id, links: { outboxId: mail.id, studentId: dee.id } }),
    run('progress', 'metric', 'Maria: deadlift 225 lb (PR +10)', 'new personal best', 30, { utteranceId: uMaria.id, links: { studentId: maria.id } }),
  ])
  // Parent emails start on Auto, so the capture can show the coach switching them to Review.
  await db.insert(t.agentSettings).values({ task: 'parent_email', autonomy: 'auto' })
  console.log('seeded', { classes: Object.keys(r.classIds).length })
}

/** Scripted model: only the parent-email draft (the insight "Do it" capture). Anything else fails fast. */
const llm = {
  async object({ name, prompt, schema: out }) {
    if (name === 'parent_email' && /Gus/.test(prompt)) {
      await new Promise(r => setTimeout(r, MODEL_LATENCY_MS)) // a model call takes a moment: the "Working…" state is visible
      return out.parse({
        subject: 'Gus is ready for his next belt test',
        body: 'Hi Hill family,\n\nGus has been at green belt for 120 days and has been at 11 of his last 12 classes. His forms are sharp and he has no open focus areas, so we would love to have him test at the next belt test.\n\nCoach Galen',
      })
    }
    throw new Error(`capture: model call "${name}" is disabled`)
  },
}

const deps = {
  db,
  llm,
  stt: { async transcribe() { throw new Error('capture: speech-to-text is disabled') } },
  mail: { async send(m) { console.log(`[mail stub] not sent: "${m.subject}"`); return { id: `stub_${Date.now()}` } } },
  now,
  defer: p => { p.catch(e => console.error('[defer]', e instanceof Error ? e.message : e)) },
  env: {
    pairingCode: env.PAIRING_CODE, cronSecret: env.CRON_SECRET, allowedOrigins: [APP_ORIGIN],
    demoEmailOverride: env.DEMO_EMAIL_OVERRIDE || null, instructorName: 'Coach Galen', timeZone: TZ,
  },
}

const server = serve({ fetch: createApp(deps).fetch, port: PORT, hostname: '127.0.0.1' }, i => console.log(`capture api on http://localhost:${i.port}`))
const stop = () => { server.close(); void client.close().then(() => process.exit(0)) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
