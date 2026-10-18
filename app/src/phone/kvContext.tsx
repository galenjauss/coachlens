import { createContext, useContext, useEffect, useState } from 'react'
import { MODES, type ModeId } from '@matside/shared'
import type { Api } from '../core/api'
import { bus } from '../core/bus'
import { KEYS, type KV } from '../core/storage'
import { CLASS_ID_KEY } from './classPref'
import { usePoll } from './usePoll'

/** The phone's KV (bridge storage in the Even app), provided once in mount.tsx. */
export const KVContext = createContext<KV | null>(null)
export const useKV = (): KV | null => useContext(KVContext)

/** Forget this phone's pairing and show the Pairing screen (App listens for `unauthorized`). */
export async function rePair(kv: KV | null): Promise<void> {
  try { await kv?.set(KEYS.token, '') } catch (e) { console.warn('[pair] could not clear the token', e) }
  bus.emit('unauthorized', undefined)
}

/** The class picked on this phone or the lens (null = server default; undefined = still reading). */
export function useStoredClassId(): string | null | undefined {
  const kv = useKV()
  const [id, setId] = useState<string | null | undefined>(kv ? undefined : null)
  useEffect(() => {
    if (!kv) return
    let live = true
    void kv.get(CLASS_ID_KEY).then(v => { if (live) setId(v || null) }, () => { if (live) setId(null) })
    const off = bus.on('classChanged', v => setId(v))
    return () => { live = false; off() }
  }, [kv])
  return id
}

/**
 * "students" / "clients" for the coach's current class, from the cheap classes list (never
 * api.today(), which can start a plan draft and may pick a different class).
 */
export function usePeopleLabel(api: Api): string {
  const classId = useStoredClassId()
  const { data } = usePoll(() => api.classes(), null)
  const mode: ModeId | undefined = (data?.find(c => c.id === classId) ?? data?.[0])?.mode
  return mode ? MODES[mode].people : 'students'
}
