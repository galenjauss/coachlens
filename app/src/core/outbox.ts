import type { UtteranceResponse } from '@matside/shared'
import { ApiError } from './api'
import { KEYS, type KV } from './storage'

export type OutboxForm = { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; audioB64: string | null; text: string | null }
export type OutboxItem = { id: string; createdAt: number; attempts: number; form: OutboxForm }
export type FlushResult = { results: Map<string, UtteranceResponse>; dropped: Map<string, number>; remaining: number }
const MAX_ATTEMPTS = 5

export class Outbox {
  private busy: Promise<unknown> = Promise.resolve()
  constructor(private kv: KV) {}

  async list(): Promise<OutboxItem[]> {
    const raw = await this.kv.get(KEYS.outbox)
    try { return raw ? (JSON.parse(raw) as OutboxItem[]) : [] } catch { return [] }
  }
  private save(items: OutboxItem[]) { return this.kv.set(KEYS.outbox, JSON.stringify(items)) }

  async enqueue(form: OutboxForm): Promise<OutboxItem> {
    const item: OutboxItem = { id: crypto.randomUUID(), createdAt: Date.now(), attempts: 0, form }
    await this.save([...(await this.list()), item])
    return item
  }

  // Serialized: never two flushes at once. Stops at the first network/5xx/429/401 failure to keep order.
  flush(send: (i: OutboxItem) => Promise<UtteranceResponse>): Promise<FlushResult> {
    const run = this.busy.then(async () => {
      const results = new Map<string, UtteranceResponse>()
      const dropped = new Map<string, number>()
      let items = await this.list()
      while (items.length) {
        const head = items[0]!
        try {
          results.set(head.id, await send(head))
          items = items.slice(1)
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) break // needs re-pairing; keep the item
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) { dropped.set(head.id, e.status); items = items.slice(1) }
          else if (e instanceof ApiError) { // 5xx or 429: retryable, bounded
            const attempts = head.attempts + 1
            items = attempts >= MAX_ATTEMPTS ? items.slice(1) : [{ ...head, attempts }, ...items.slice(1)]
            if (attempts >= MAX_ATTEMPTS) dropped.set(head.id, e.status)
            break
          } else break
        } finally {
          await this.save(items)
        }
      }
      return { results, dropped, remaining: items.length }
    })
    this.busy = run.catch(() => undefined)
    return run
  }
}
