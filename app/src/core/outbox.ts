import type { UtteranceResponse } from '@matside/shared'
import { ApiError, BadResponseError, NetworkError } from './api'
import { bus } from './bus'
import { KEYS, type KV } from './storage'

export type OutboxForm = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; audioB64: string | null; text: string | null }
export type OutboxItem = { id: string; createdAt: number; attempts: number; form: OutboxForm }
/** `delivered`: the server accepted the item but its reply was unreadable (no result; never retried). */
export type FlushResult = { results: Map<string, UtteranceResponse>; dropped: Map<string, number>; delivered: Set<string>; remaining: number }
const MAX_ATTEMPTS = 5

/** Last outbox count announced on the bus (0 until the first change): a screen mounting late starts from it. */
let knownCount = 0
bus.on('outboxChanged', n => { knownCount = n })
export const knownOutboxCount = (): number => knownCount

export class Outbox {
  private busy: Promise<unknown> = Promise.resolve()
  constructor(private kv: KV) {}

  /** Notes waiting to send. */
  async count(): Promise<number> { return (await this.list()).length }

  async list(): Promise<OutboxItem[]> {
    const raw = await this.kv.get(KEYS.outbox)
    try { return raw ? (JSON.parse(raw) as OutboxItem[]) : [] } catch { return [] }
  }
  // Short mutex for read-modify-write on storage; separate from flush serialization so
  // enqueue never waits on a slow network send. Every saved change announces the new count.
  private lock: Promise<unknown> = Promise.resolve()
  private mutate<T>(fn: (items: OutboxItem[]) => { items: OutboxItem[]; value: T }): Promise<T> {
    const run = this.lock.then(async () => {
      const before = await this.list()
      const { items, value } = fn(before)
      await this.kv.set(KEYS.outbox, JSON.stringify(items))
      if (items.length !== before.length) bus.emit('outboxChanged', items.length)
      return value
    })
    this.lock = run.catch(() => undefined)
    return run
  }

  enqueue(form: OutboxForm): Promise<OutboxItem> {
    const item: OutboxItem = { id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, form }
    return this.mutate(items => ({ items: [...items, item], value: item }))
  }

  private remove(id: string) { return this.mutate(items => ({ items: items.filter(i => i.id !== id), value: undefined })) }
  private bump(id: string): Promise<number> {
    return this.mutate(items => {
      const attempts = (items.find(i => i.id === id)?.attempts ?? 0) + 1
      return { items: attempts >= MAX_ATTEMPTS ? items.filter(i => i.id !== id) : items.map(i => (i.id === id ? { ...i, attempts } : i)), value: attempts }
    })
  }

  // Serialized: never two flushes at once. Stops at the first network/5xx/429/401/unknown failure to keep order.
  flush(send: (i: OutboxItem) => Promise<UtteranceResponse>): Promise<FlushResult> {
    const run = this.busy.then(async () => {
      const results = new Map<string, UtteranceResponse>()
      const dropped = new Map<string, number>()
      const delivered = new Set<string>()
      const persist = async (fn: () => Promise<unknown>): Promise<boolean> => {
        try { await fn(); return true } catch (err) { console.error('[outbox] persist failed', err); return false }
      }
      for (;;) {
        let head: OutboxItem | undefined
        try { head = (await this.list())[0] } catch (err) { console.error('[outbox] read failed', err); break }
        if (!head) break
        const id = head.id
        let sent: UtteranceResponse
        try {
          sent = await send(head)
        } catch (e) {
          if (e instanceof BadResponseError) { // saved on the server, reply unreadable: done, never resend (no duplicates)
            delivered.add(id)
            if (!(await persist(() => this.remove(id)))) break
            continue
          }
          if (e instanceof ApiError && e.status === 401) break // needs re-pairing; keep the item
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
            dropped.set(id, e.status)
            if (!(await persist(() => this.remove(id)))) break
            continue
          }
          if (e instanceof NetworkError) break // offline: keep, uncounted
          // 5xx, 429, or any unknown error: counted retry, stop to keep order
          let attempts = 0
          if (!(await persist(async () => { attempts = await this.bump(id) }))) break
          if (attempts >= MAX_ATTEMPTS) { dropped.set(id, e instanceof ApiError ? e.status : 0); continue }
          break
        }
        results.set(id, sent)
        if (!(await persist(() => this.remove(id)))) break
      }
      let remaining = 0
      try { remaining = (await this.list()).length } catch { /* keep 0 */ }
      return { results, dropped, delivered, remaining }
    })
    this.busy = run.catch(() => undefined)
    return run
  }
}
