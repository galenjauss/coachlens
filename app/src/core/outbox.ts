import type { UtteranceResponse } from '@matside/shared'
import { ApiError, NetworkError } from './api'
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
  // Short mutex for read-modify-write on storage; separate from flush serialization so
  // enqueue never waits on a slow network send.
  private lock: Promise<unknown> = Promise.resolve()
  private mutate<T>(fn: (items: OutboxItem[]) => { items: OutboxItem[]; value: T }): Promise<T> {
    const run = this.lock.then(async () => {
      const { items, value } = fn(await this.list())
      await this.kv.set(KEYS.outbox, JSON.stringify(items))
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
      for (;;) {
        const head = (await this.list())[0]
        if (!head) break
        try {
          results.set(head.id, await send(head))
          await this.remove(head.id)
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) break // needs re-pairing; keep the item
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
            dropped.set(head.id, e.status)
            await this.remove(head.id)
            continue
          }
          if (e instanceof NetworkError) break // offline: keep, uncounted
          // 5xx, 429, or any unknown error: counted retry, stop to keep order
          const attempts = await this.bump(head.id)
          if (attempts >= MAX_ATTEMPTS) { dropped.set(head.id, e instanceof ApiError ? e.status : 0); continue }
          break
        }
      }
      return { results, dropped, remaining: (await this.list()).length }
    })
    this.busy = run.catch(() => undefined)
    return run
  }
}
