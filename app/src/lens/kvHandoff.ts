import type { KV } from '../core/storage'

/**
 * Copy `keys` from `from` into `to` where `to` has no value yet (never overwrites).
 * Used when the bridge arrives late: anything the user saved to browser storage in the first
 * seconds (pairing token, chosen class) moves to bridge storage. Returns the keys copied.
 */
export async function copyMissing(from: KV, to: KV, keys: readonly string[]): Promise<string[]> {
  const copied: string[] = []
  for (const k of keys) {
    try {
      const v = await from.get(k)
      if (!v || (await to.get(k))) continue
      await to.set(k, v)
      copied.push(k)
    } catch (e) {
      console.error('[kv] handoff failed for', k, e)
    }
  }
  return copied
}
