import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import type { Db } from '../db/client'
import type { Deps, Llm, LlmImage, MailMsg } from '../deps'

export async function makeTestDb(): Promise<Db> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  return db as unknown as Db
}

export function fakeLlm(handler: (a: { name: string; prompt: string; instructions: string; images?: LlmImage[] }) => unknown): Llm {
  return { async object({ name, prompt, instructions, schema, images }) { return schema.parse(await handler({ name, prompt, instructions, images })) } }
}

export type TestDeps = Deps & { deferred: Promise<unknown>[]; sent: MailMsg[]; flush(): Promise<void> }

export function makeDeps(db: Db, over: Partial<Deps> = {}): TestDeps {
  const deferred: Promise<unknown>[] = []
  const sent: MailMsg[] = []
  return {
    db,
    llm: fakeLlm(() => { throw new Error('llm not stubbed') }),
    stt: { async transcribe() { return 'stub transcript' } },
    mail: { async send(m) { sent.push(m); return { id: `mail_${sent.length}` } } },
    now: () => new Date('2026-10-20T00:30:00Z'), // Mon 2026-10-19 5:30 PM PT
    defer: p => { deferred.push(p) },
    env: { pairingCode: '4242', cronSecret: 'cron', allowedOrigins: ['*'], demoEmailOverride: null, instructorName: 'Coach Galen', timeZone: 'America/Los_Angeles' },
    deferred,
    sent,
    async flush() { while (deferred.length) await Promise.all(deferred.splice(0)) },
    ...over,
  }
}
