import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Db } from '../db/client'
import type { Deps } from '../deps'
import { deferredTasks, outbox, utterances } from '../db/schema'
import { safeDefer } from '../agents/runs'

/** True once POST /v1/utterances/:id/undo has claimed the utterance (C2). Deferred work checks it before writing and sending. */
export async function isUtteranceUndone(db: Db, utteranceId: string | null | undefined): Promise<boolean> {
  if (!utteranceId) return false
  const [u] = await db.select({ id: utterances.id }).from(utterances).where(and(eq(utterances.id, utteranceId), isNotNull(utterances.undoneAt)))
  return Boolean(u)
}

/** A draft written after its utterance was undone is cancelled at once (the second half of the write-then-recheck guard). */
export async function cancelIfUndone(db: Db, utteranceId: string | null | undefined, outboxId: string): Promise<boolean> {
  if (!(await isUtteranceUndone(db, utteranceId))) return false
  await db.update(outbox).set({ status: 'cancelled' }).where(and(eq(outbox.id, outboxId), inArray(outbox.status, ['pending_review', 'error'])))
  return true
}

const setStatus = (db: Db, id: string, status: 'running' | 'done' | 'failed' | 'cancelled', from: ('pending' | 'running')[]) =>
  db.update(deferredTasks).set({ status, updatedAt: new Date() }).where(and(eq(deferredTasks.id, id), inArray(deferredTasks.status, from))).returning({ id: deferredTasks.id })

/**
 * Deferred agent work keyed by (utterance, kind, subject) (C1): a second call for the same key does nothing, so a
 * re-run utterance never drafts twice. Before starting, the task checks the utterance was not undone (C2), and an
 * Undo flips a pending or running task to cancelled. Without an utterance id the work is simply deferred.
 */
export async function deferOnce(deps: Deps, key: { utteranceId: string | null | undefined; kind: string; subject?: string }, work: () => Promise<unknown>): Promise<void> {
  if (!key.utteranceId) { safeDefer(deps, key.kind, Promise.resolve().then(work)); return }
  const utteranceId = key.utteranceId
  const [row] = await deps.db.insert(deferredTasks).values({ utteranceId, kind: key.kind, subject: key.subject ?? '' })
    .onConflictDoNothing().returning({ id: deferredTasks.id })
  if (!row) return
  safeDefer(deps, key.kind, (async () => {
    if (await isUtteranceUndone(deps.db, utteranceId)) { await setStatus(deps.db, row.id, 'cancelled', ['pending']); return }
    if (!(await setStatus(deps.db, row.id, 'running', ['pending'])).length) return // cancelled before it started
    // Undone while running: the task ends cancelled (its own undone checks stopped the writes), never done or failed.
    const finish = async (ok: boolean) => setStatus(deps.db, row.id, await isUtteranceUndone(deps.db, utteranceId) ? 'cancelled' : ok ? 'done' : 'failed', ['running'])
    try {
      await work()
      await finish(true)
    } catch (e) {
      await finish(false)
      throw e
    }
  })())
}
