import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Request scope: the authenticated instructor, plus the utterance a request created (set once it exists).
 * Deferred work started inside a request inherits this store, so per-instructor settings and cancellation
 * links follow background tasks. Reads for authorization always pass the instructor id explicitly; this store
 * only tags writes made deep in generic code (agent runs, settings, vocabulary) and links deferred drafts.
 */
interface Store { instructorId: string; utteranceId: string | null }

const als = new AsyncLocalStorage<Store>()

export function runAs<T>(instructorId: string, fn: () => T): T {
  return als.run({ instructorId, utteranceId: null }, fn)
}

export const currentInstructorId = (): string | null => als.getStore()?.instructorId ?? null
export const currentUtteranceId = (): string | null => als.getStore()?.utteranceId ?? null

/** Called once the utterance row exists, so work deferred from this request can be cancelled by its Undo. */
export function bindUtterance(utteranceId: string): void {
  const s = als.getStore()
  if (s) s.utteranceId = utteranceId
}

/**
 * S4 · per-instructor data must never be read or written without an instructor. Outside a request scope this
 * throws, unless unscoped access was enabled explicitly: `COACHLENS_ALLOW_UNSCOPED=1` (set for the test suite and
 * one-off scripts) or allowUnscoped(true). Unscoped callers then use the legacy deployment-wide rows.
 */
let unscoped = process.env.COACHLENS_ALLOW_UNSCOPED === '1'
export function allowUnscoped(on: boolean): void { unscoped = on }
export class NoInstructorError extends Error {}
export function scopedInstructor(where: string): string | null {
  const id = currentInstructorId()
  if (id || unscoped) return id
  throw new NoInstructorError(`${where}: no instructor in scope`)
}
