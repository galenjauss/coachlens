import type { Db } from './client'

/** A list of not-yet-executed drizzle queries built against a handle (drizzle queries run only when awaited). */
export type AtomicBuild = (h: Db) => PromiseLike<unknown>[]

/**
 * Runs a precomputed list of writes all-or-nothing. Production uses neon-http, which has no interactive
 * transactions but runs `db.batch([...])` as one transaction; PGlite (tests, local) uses `db.transaction`.
 * The writes must be computable up front: read first, then build the list.
 */
export async function atomically(db: Db, build: AtomicBuild): Promise<void> {
  const batchable = db as unknown as { batch?: (qs: PromiseLike<unknown>[]) => Promise<unknown> }
  if (typeof batchable.batch === 'function') {
    const qs = build(db)
    if (qs.length) await batchable.batch(qs)
    return
  }
  await db.transaction(async tx => {
    for (const q of build(tx as unknown as Db)) await q
  })
}
