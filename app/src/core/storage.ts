export interface KV { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> }
export const KEYS = { token: 'matside.token', outbox: 'matside.outbox', firstRunSeen: 'matside.firstRun', session: 'matside.session' } as const

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return { async get(k) { return m.get(k) ?? null }, async set(k, v) { m.set(k, v) } }
}

type BridgeStorage = { getLocalStorage(k: string): Promise<string>; setLocalStorage(k: string, v: string): Promise<boolean> }
export function bridgeKV(bridge: BridgeStorage): KV {
  return {
    async get(k) { const v = await bridge.getLocalStorage(k); return v ? v : null },
    async set(k, v) { if (!(await bridge.setLocalStorage(k, v))) console.error('[kv] set failed', k) },
  }
}

export function browserKV(): KV {
  return {
    async get(k) { try { return localStorage.getItem(k) } catch { return null } },
    async set(k, v) { try { localStorage.setItem(k, v) } catch (e) { console.error('[kv]', e) } },
  }
}
