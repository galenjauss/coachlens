import type { UtteranceResponse } from '@matside/shared'
import { ApiError, BadResponseError, NetworkError } from './api'
import { bus } from './bus'
import { KEYS, type KV } from './storage'

export type OutboxForm = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; audioB64: string | null; text: string | null }
/**
 * `holdUntil`: not sent before this time (ms) — the audio waits while transcript-first may swap it to
 * text. A flush stops at a held head (keeps order); after a kill/restart the hold has expired.
 * `nextAttemptAt`: backoff after a temporary failure (Retry-After or exponential); a forced flush ignores it.
 * `lastError`: why the last attempt did not go through, for the phone's Unsent notes panel.
 */
export type OutboxItem = { id: string; createdAt: number; attempts: number; form: OutboxForm; holdUntil?: number; nextAttemptAt?: number; lastError?: RetryReason }

/** Why an item is still waiting: every one of these is temporary and the item is kept. */
export type RetryReason = 'offline' | 'rate_limited' | 'server' | 'unpaired' | 'in_progress' | 'app_error' | 'stt_unavailable'
/** A permanent rejection (invalid input): the item moves to the failed store, kept with its reason, never deleted silently. */
export type FailedInfo = { status: number; code: string; reason: string }
export type FailedItem = OutboxItem & { failedAt: number; failure: FailedInfo }

/**
 * `results`: replies (a C1 replay counts as a reply). `failed`: moved to the failed store by this flush.
 * `delivered`: the server accepted the item but its reply was unreadable (no result; never retried).
 * `retrying`: still queued after a temporary failure, with why. `remaining` / `failedCount`: store sizes after.
 */
export type FlushResult = {
  results: Map<string, UtteranceResponse>; failed: Map<string, FailedInfo>; delivered: Set<string>
  retrying: Map<string, RetryReason>; remaining: number; failedCount: number
}

/** First backoff step after a temporary failure; doubles per attempt up to MAX_BACKOFF_MS. */
export const BASE_BACKOFF_MS = 2_000
export const MAX_BACKOFF_MS = 5 * 60_000
/** Unknown (non-HTTP) errors this many times: the item moves to the failed store (kept) so it can't block the queue. */
export const MAX_APP_ERRORS = 5

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1))
}

/** The true reason in words (never "didn't catch that" for a network or server failure). */
export function retryText(r: RetryReason | undefined): string {
  switch (r) {
    case 'offline': return 'Offline · sends when connected'
    case 'rate_limited': return 'Server busy · retrying'
    case 'server': return 'Server error · retrying'
    case 'unpaired': return 'Not paired · pair to send'
    case 'in_progress': return 'Server still saving · checking'
    case 'app_error': return 'Couldn’t send · retrying'
    case 'stt_unavailable': return 'Speech-to-text is not set up on the server'
    default: return 'Waiting to send'
  }
}

/** A permanent 4xx (or a repeated app error): the reason kept in the failed store. */
export function failureFor(status: number, code: string): FailedInfo {
  if (status === 422 && /empty|transcript/i.test(code)) return { status, code, reason: 'Nothing was heard in this recording' }
  if (status === 413) return { status, code, reason: 'Recording too large to send' }
  if (status === 400 || status === 422) return { status, code, reason: `The server rejected this note (${code || status})` }
  if (status === 404) return { status, code, reason: 'Its class session no longer exists' }
  if (status === 403) return { status, code, reason: 'Not allowed for this account' }
  if (status === 0) return { status, code, reason: `Couldn’t send (app error: ${code || 'unknown'})` }
  return { status, code, reason: `Rejected by the server (${status}${code ? ` ${code}` : ''})` }
}

/** Temporary: kept and retried. 409 is temporary only as C1's `in_progress`. */
function transient(e: ApiError): RetryReason | null {
  if (e.status === 401) return 'unpaired'
  if (e.status === 429) return 'rate_limited'
  if (e.status === 503 && e.message === 'stt_not_configured') return 'stt_unavailable'
  if (e.status === 409 && e.message === 'in_progress') return 'in_progress'
  if (e.status >= 500 || e.status === 408 || e.status === 425) return 'server'
  return null
}

/** Last outbox counts announced on the bus (0 until the first change): a screen mounting late starts from them. */
let knownCount = 0
let knownFailed = 0
bus.on('outboxChanged', n => { knownCount = n })
bus.on('outboxFailedChanged', n => { knownFailed = n })
export const knownOutboxCount = (): number => knownCount
export const knownFailedCount = (): number => knownFailed

const parse = <T>(raw: string | null): T[] => { try { return raw ? (JSON.parse(raw) as T[]) : [] } catch { return [] } }

export class Outbox {
  private busy: Promise<unknown> = Promise.resolve()
  constructor(private kv: KV, private now: () => number = Date.now) {}

  /** Notes waiting to send. */
  async count(): Promise<number> { return (await this.list()).length }
  async list(): Promise<OutboxItem[]> { return parse<OutboxItem>(await this.kv.get(KEYS.outbox)) }
  /** Notes the server rejected as invalid: kept with their reason until the coach retries or discards them. */
  async failed(): Promise<FailedItem[]> { return parse<FailedItem>(await this.kv.get(KEYS.outboxFailed)) }

  // Short mutex for read-modify-write on storage (both stores); separate from flush serialization so
  // enqueue never waits on a slow network send. Every saved change announces the new counts.
  private lock: Promise<unknown> = Promise.resolve()
  private mutate<T>(fn: (items: OutboxItem[], failed: FailedItem[]) => { items: OutboxItem[]; failed?: FailedItem[]; value: T }): Promise<T> {
    const run = this.lock.then(async () => {
      const before = await this.list()
      const failedBefore = await this.failed()
      const { items, failed, value } = fn(before, failedBefore)
      // Failed store first: an item moving queue → failed is never absent from both.
      if (failed) await this.kv.set(KEYS.outboxFailed, JSON.stringify(failed))
      await this.kv.set(KEYS.outbox, JSON.stringify(items))
      if (items.length !== before.length) bus.emit('outboxChanged', items.length)
      if (failed && failed.length !== failedBefore.length) bus.emit('outboxFailedChanged', failed.length)
      return value
    })
    this.lock = run.catch(() => undefined)
    return run
  }

  enqueue(form: OutboxForm, opts: { holdUntil?: number } = {}): Promise<OutboxItem> {
    const item: OutboxItem = { id: crypto.randomUUID(), createdAt: this.now(), attempts: 0, form, ...(opts.holdUntil ? { holdUntil: opts.holdUntil } : {}) }
    return this.mutate(items => ({ items: [...items, item], value: item }))
  }

  /** Replace an item's form (e.g. audio → text) and release its hold. False if the item is gone (already sent/failed). */
  swap(id: string, form: OutboxForm): Promise<boolean> {
    return this.mutate(items => {
      const found = items.some(i => i.id === id)
      return { items: items.map(i => (i.id === id ? { id: i.id, createdAt: i.createdAt, attempts: i.attempts, form } : i)), value: found }
    })
  }

  /** Release an item's hold so the next flush sends it as is. False if the item is gone. */
  unhold(id: string): Promise<boolean> {
    return this.mutate(items => {
      const found = items.some(i => i.id === id)
      return { items: items.map(i => (i.id === id ? { id: i.id, createdAt: i.createdAt, attempts: i.attempts, form: i.form } : i)), value: found }
    })
  }

  /** Remove a queued item without sending it (transcribe heard nothing, or the coach discarded it). False if already gone. */
  drop(id: string): Promise<boolean> {
    return this.mutate(items => ({ items: items.filter(i => i.id !== id), value: items.some(i => i.id === id) }))
  }

  /** The coach chose Retry on a failed note: back to the end of the queue with a clean slate (same id = same C1 key). */
  retryFailed(id: string): Promise<boolean> {
    return this.mutate((items, failed) => {
      const f = failed.find(x => x.id === id)
      if (!f) return { items, value: false }
      const back: OutboxItem = { id: f.id, createdAt: f.createdAt, attempts: 0, form: f.form }
      return { items: [...items, back], failed: failed.filter(x => x.id !== id), value: true }
    })
  }

  /** The coach chose Discard on a failed note: the only way a failed note is deleted. */
  discardFailed(id: string): Promise<boolean> {
    return this.mutate((items, failed) => ({ items, failed: failed.filter(x => x.id !== id), value: failed.some(x => x.id === id) }))
  }

  private remove(id: string) { return this.mutate(items => ({ items: items.filter(i => i.id !== id), value: undefined })) }

  private toFailed(id: string, failure: FailedInfo) {
    return this.mutate((items, failed) => {
      const it = items.find(i => i.id === id)
      if (!it) return { items, value: undefined }
      return { items: items.filter(i => i.id !== id), failed: [...failed, { ...it, failedAt: this.now(), failure }], value: undefined }
    })
  }

  /** A temporary failure: count it, wait (Retry-After or exponential backoff), remember why. Offline is not counted. */
  private defer(id: string, reason: RetryReason, retryAfterMs?: number): Promise<number> {
    return this.mutate(items => {
      const cur = items.find(i => i.id === id)
      const attempts = (cur?.attempts ?? 0) + (reason === 'offline' ? 0 : 1)
      const wait = reason === 'offline' ? 0 : retryAfterMs ?? backoffMs(attempts)
      const next = (i: OutboxItem): OutboxItem => {
        const { nextAttemptAt: _old, ...rest } = i
        return { ...rest, attempts, lastError: reason, ...(wait ? { nextAttemptAt: this.now() + wait } : {}) }
      }
      return { items: items.map(i => (i.id === id ? next(i) : i)), value: attempts }
    })
  }

  /**
   * Serialized: never two flushes at once. Stops at the first temporary failure (and at a head still in
   * backoff) to keep order; `force` (the coach's Retry) ignores the backoff. Only a permanent rejection
   * moves an item aside (to the failed store, kept), so the queue carries on.
   */
  flush(send: (i: OutboxItem) => Promise<UtteranceResponse>, opts: { force?: boolean } = {}): Promise<FlushResult> {
    const run = this.busy.then(async () => {
      const r: FlushResult = { results: new Map(), failed: new Map(), delivered: new Set(), retrying: new Map(), remaining: 0, failedCount: 0 }
      const persist = async (fn: () => Promise<unknown>): Promise<boolean> => {
        try { await fn(); return true } catch (err) { console.error('[outbox] persist failed', err); return false }
      }
      for (;;) {
        let head: OutboxItem | undefined
        try { head = (await this.list())[0] } catch (err) { console.error('[outbox] read failed', err); break }
        if (!head) break
        if (head.holdUntil && head.holdUntil > this.now()) break // held (transcript-first may still swap it): keep order
        if (!opts.force && head.nextAttemptAt && head.nextAttemptAt > this.now()) { r.retrying.set(head.id, head.lastError ?? 'server'); break }
        const id = head.id
        let sent: UtteranceResponse
        try {
          sent = await send(head)
        } catch (e) {
          if (e instanceof BadResponseError) { // saved on the server, reply unreadable: done, never resend (no duplicates)
            r.delivered.add(id)
            if (!(await persist(() => this.remove(id)))) break
            continue
          }
          if (e instanceof NetworkError) { r.retrying.set(id, 'offline'); await persist(() => this.defer(id, 'offline')); break }
          if (e instanceof ApiError) {
            const why = transient(e)
            if (why) { r.retrying.set(id, why); await persist(() => this.defer(id, why, e.retryAfterMs)); break }
            const f = failureFor(e.status, e.message)
            r.failed.set(id, f)
            if (!(await persist(() => this.toFailed(id, f)))) break
            continue
          }
          // Unknown (a bug or a malformed item): retried with backoff, then set aside (kept) so it can't block the queue.
          let attempts = 0
          if (!(await persist(async () => { attempts = await this.defer(id, 'app_error') }))) break
          if (attempts >= MAX_APP_ERRORS) {
            const f = failureFor(0, e instanceof Error ? e.message : 'unknown')
            r.failed.set(id, f)
            if (!(await persist(() => this.toFailed(id, f)))) break
            continue
          }
          r.retrying.set(id, 'app_error')
          break
        }
        r.results.set(id, sent)
        if (!(await persist(() => this.remove(id)))) break
      }
      try { r.remaining = (await this.list()).length; r.failedCount = (await this.failed()).length } catch { /* keep 0 */ }
      return r
    })
    this.busy = run.catch(() => undefined)
    return run
  }
}
