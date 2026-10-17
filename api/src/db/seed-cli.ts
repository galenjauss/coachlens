import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import { seed } from './seed'
import { localDate } from '../logic/dates'
import type { Db } from './client'

const url = process.env.DATABASE_URL
const emails = (process.env.SEED_GUARDIAN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (!url || !emails.length) {
  console.error('Set DATABASE_URL and SEED_GUARDIAN_EMAILS (comma-separated inboxes you own; round-robin across 14 guardians).')
  process.exit(1)
}
const db = drizzle({ client: neon(url), schema }) as unknown as Db
const r = await seed(db, { today: localDate(new Date(), 'America/Los_Angeles'), guardianEmail: i => emails[i % emails.length]! })
console.log('seeded', r)
