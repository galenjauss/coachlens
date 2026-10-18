import { and, desc, eq, gt, isNull, notInArray, sql } from 'drizzle-orm'
import { randomInt, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/client'
import { apiTokens, instructors } from '../db/schema'
import { hashToken } from '../http/auth'

/** Pairing and tokens (C4): one reusable, rotatable code per instructor (hashed at rest); tokens expire and can be revoked. */
export const TOKEN_TTL_DAYS = 90
export const MAX_ACTIVE_TOKENS = 20
const DAY = 86_400_000
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O, 1/I/L
export const ROTATED_CODE_LENGTH = 10

export const hashPairingCode = (code: string) => hashToken(`pair:${code.trim()}`)

const sameString = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function setPairingCode(db: Db, instructorId: string, code: string): Promise<void> {
  await db.update(instructors).set({ pairingCodeHash: await hashPairingCode(code) }).where(eq(instructors.id, instructorId))
}

/**
 * The instructor a code pairs to, or null. A code matches exactly one instructor by its stored hash.
 * Env bootstrap: the deployment's PAIRING_CODE claims the instructor only when the deployment has exactly one
 * instructor and no code has been set yet (a fresh single-coach install). There is no "first instructor" pick.
 */
export async function instructorForCode(db: Db, code: string, envCode: string): Promise<string | null> {
  const hash = await hashPairingCode(code)
  const [hit] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.pairingCodeHash, hash))
  if (hit) return hit.id
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
export async function rotatePairingCode(db: Db, instructorId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = Array.from({ length: ROTATED_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
    const hash = await hashPairingCode(code)
    const [taken] = await db.select({ id: instructors.id }).from(instructors).where(sql`${instructors.pairingCodeHash} = ${hash}`)
    if (taken) continue
    await db.update(instructors).set({ pairingCodeHash: hash }).where(eq(instructors.id, instructorId))
    return code
  }
  throw new Error('could not generate a unique pairing code')
}
