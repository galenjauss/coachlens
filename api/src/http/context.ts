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
