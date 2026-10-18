// One-off: label pre-0013 notes with a valence. Run deliberately against a database you choose:
//   DATABASE_URL=... npm run backfill:valence -w @matside/api
// Idempotent (only rows with valence null). Review the printed counts.
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import type { Db } from './client'
import { backfillValence } from './backfillValence'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('Set DATABASE_URL to the database to backfill.')
  process.exit(1)
}
const db = drizzle({ client: neon(url), schema }) as unknown as Db
console.log('backfilled', await backfillValence(db))
