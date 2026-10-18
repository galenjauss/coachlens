import { and, desc, eq, gt, isNull, notInArray, sql } from 'drizzle-orm'
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/client'
import { apiTokens, instructors, kv } from '../db/schema'
import { hashToken } from '../http/auth'

/** Pairing and tokens (C4): one reusable, rotatable code per instructor (hashed at rest); tokens expire and can be revoked. */
export const TOKEN_TTL_DAYS = 90
export const MAX_ACTIVE_TOKENS = 20
const DAY = 86_400_000
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L
export const ROTATED_CODE_LENGTH = 10

/** Development pepper (no PAIRING_PEPPER set): codes are still keyed, just not with a deployment secret. */
export const DEV_PAIRING_PEPPER = 'coachlens-dev-pairing-pepper'
export const DEMO_INSTRUCTOR_EMAIL = 'coach@matside.dev'

/** The deployment pepper: PAIRING_PEPPER, else derived from CRON_SECRET (also a server secret), else the dev pepper. */
export function pairingPepperFrom(env: Record<string, string | undefined>): string {
  if (env.PAIRING_PEPPER) return env.PAIRING_PEPPER
  if (env.CRON_SECRET) return createHmac('sha256', 'coachlens-pairing-pepper').update(env.CRON_SECRET).digest('hex')
  return DEV_PAIRING_PEPPER
}

/** HMAC-SHA256 of the code with the server pepper (PAIRING_PEPPER): a leaked table cannot be brute-forced offline. */
export const hashPairingCode = async (code: string, pepper: string = DEV_PAIRING_PEPPER) =>
  createHmac('sha256', pepper).update(`pair:${code.trim()}`).digest('hex')
/** The first-version hash (plain SHA-256), still accepted once and upgraded on use. */
const legacyHash = (code: string) => hashToken(`pair:${code.trim()}`)

const sameString = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function setPairingCode(db: Db, instructorId: string, code: string, pepper: string = DEV_PAIRING_PEPPER): Promise<void> {
  await db.update(instructors).set({ pairingCodeHash: await hashPairingCode(code, pepper) }).where(eq(instructors.id, instructorId))
}

const ENV_FINGERPRINT_KEY = 'pairing:env_fingerprint'
const rotatedKey = (instructorId: string) => `pairing:rotated:${instructorId}`
/** Pepper-independent fingerprint of the env value, so a pepper change never looks like a code change. */
const envFingerprint = (envCode: string) => hashToken(`env:${envCode.trim()}`)

/**
 * Boot sync of the demo instructor's code with PAIRING_CODE. The env code is applied only when:
 * - the demo instructor has no code yet (first boot), or
 * - the env value itself changed since the stored fingerprint, AND the code was never rotated in the app.
 * A code rotated in the app always wins (rotation sets a flag); a pepper change alone never resets a code.
 * The first run with an existing code just records the fingerprint and keeps that code.
 */
export async function syncEnvPairingCode(db: Db, envCode: string, pepper: string): Promise<void> {
  if (!envCode) return
  const fingerprint = await envFingerprint(envCode)
  const [seen] = await db.select().from(kv).where(eq(kv.key, ENV_FINGERPRINT_KEY))
  if (seen?.value === fingerprint) return
  const [demo] = await db.select({ id: instructors.id, hash: instructors.pairingCodeHash }).from(instructors).where(eq(instructors.email, DEMO_INSTRUCTOR_EMAIL))
  if (demo) {
    const [rotated] = await db.select().from(kv).where(eq(kv.key, rotatedKey(demo.id)))
    const apply = demo.hash === null || (seen !== undefined && !rotated)
    if (apply) {
      const hash = await hashPairingCode(envCode, pepper)
      const [taken] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.pairingCodeHash, hash))
      if (!taken || taken.id === demo.id) await db.update(instructors).set({ pairingCodeHash: hash }).where(eq(instructors.id, demo.id))
    }
  }
  await db.insert(kv).values({ key: ENV_FINGERPRINT_KEY, value: fingerprint }).onConflictDoUpdate({ target: kv.key, set: { value: fingerprint, updatedAt: new Date() } })
}

/**
 * The instructor a code pairs to, or null. A code matches exactly one instructor by its stored hash.
 * Env bootstrap: the deployment's PAIRING_CODE claims the instructor only when the deployment has exactly one
 * instructor and no code has been set yet (a fresh single-coach install). There is no "first instructor" pick.
 */
export async function instructorForCode(db: Db, code: string, envCode: string, pepper: string = DEV_PAIRING_PEPPER, previousPepper?: string): Promise<string | null> {
  const hash = await hashPairingCode(code, pepper)
  const [hit] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.pairingCodeHash, hash))
  if (hit) return hit.id
  // A hash made with the previous pepper (PAIRING_PEPPER_PREVIOUS, during a pepper change) or the first-version
  // unkeyed hash matches once and is upgraded to the current keyed one.
  const olderHashes = [...(previousPepper ? [await hashPairingCode(code, previousPepper)] : []), await legacyHash(code)]
  for (const older of olderHashes) {
    const [old] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.pairingCodeHash, older))
    if (old) {
      await db.update(instructors).set({ pairingCodeHash: hash }).where(eq(instructors.id, old.id))
      return old.id
    }
  }
  if (!envCode || !sameString(code.trim(), envCode)) return null
  const all = await db.select({ id: instructors.id, hash: instructors.pairingCodeHash }).from(instructors).limit(2)
  if (all.length !== 1 || all[0]!.hash !== null) return null
  const [claimed] = await db.update(instructors).set({ pairingCodeHash: hash })
    .where(and(eq(instructors.id, all[0]!.id), isNull(instructors.pairingCodeHash))).returning({ id: instructors.id })
  return claimed?.id ?? null
}

export async function issueToken(db: Db, instructorId: string, now: Date): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
  await db.insert(apiTokens).values({ instructorId, tokenHash: await hashToken(token), createdAt: now, expiresAt: new Date(now.getTime() + TOKEN_TTL_DAYS * DAY) })
  // At most MAX_ACTIVE_TOKENS live phones per instructor: older ones are revoked.
  const keep = (await db.select({ id: apiTokens.id }).from(apiTokens).where(and(eq(apiTokens.instructorId, instructorId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt)).limit(MAX_ACTIVE_TOKENS)).map(r => r.id)
  await db.update(apiTokens).set({ revokedAt: now })
    .where(and(eq(apiTokens.instructorId, instructorId), isNull(apiTokens.revokedAt), notInArray(apiTokens.id, keep)))
  return token
}

/** The instructor behind a live (unexpired, unrevoked) token, or null. */
export async function authenticate(db: Db, token: string, now: Date): Promise<{ instructorId: string; tokenId: string } | null> {
  const [row] = await db.select({ instructorId: apiTokens.instructorId, tokenId: apiTokens.id }).from(apiTokens)
    .innerJoin(instructors, eq(instructors.id, apiTokens.instructorId))
    .where(and(eq(apiTokens.tokenHash, await hashToken(token)), isNull(apiTokens.revokedAt), gt(apiTokens.expiresAt, now)))
  return row ?? null
}

export async function revokeToken(db: Db, tokenId: string, now: Date): Promise<void> {
  await db.update(apiTokens).set({ revokedAt: now }).where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
}

/** Generates and stores a new code; the plain code is returned once and never stored. Existing tokens stay valid. */
export async function rotatePairingCode(db: Db, instructorId: string, pepper: string = DEV_PAIRING_PEPPER): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: ROTATED_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    const hash = await hashPairingCode(code, pepper)
    const [taken] = await db.select({ id: instructors.id }).from(instructors).where(sql`${instructors.pairingCodeHash} = ${hash}`)
    if (taken) continue
    await db.update(instructors).set({ pairingCodeHash: hash }).where(eq(instructors.id, instructorId))
    // The owner's rotation wins over PAIRING_CODE from now on (see syncEnvPairingCode).
    await db.insert(kv).values({ key: rotatedKey(instructorId), value: new Date().toISOString() }).onConflictDoUpdate({ target: kv.key, set: { value: new Date().toISOString(), updatedAt: new Date() } })
    return code
  }
  throw new Error('could not generate a unique pairing code')
}

/** Revokes every live token of the instructor except the caller's (a lost or stolen phone). Returns how many. */
export async function revokeOtherTokens(db: Db, instructorId: string, keepTokenId: string, now: Date): Promise<number> {
  const rows = await db.update(apiTokens).set({ revokedAt: now })
    .where(and(eq(apiTokens.instructorId, instructorId), isNull(apiTokens.revokedAt), sql`${apiTokens.id} <> ${keepTokenId}`)).returning({ id: apiTokens.id })
  return rows.length
}
