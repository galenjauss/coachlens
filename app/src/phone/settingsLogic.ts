import type { StatusResponse } from '@matside/shared'
import { KEYS, type KV } from '../core/storage'
import { bus } from '../core/bus'

export type DisplayMode = 'quiet' | 'standard'

/** C6: read the lens display policy (quiet unless "standard" is stored). */
export async function readDisplayMode(kv: KV): Promise<DisplayMode> {
  try { return (await kv.get(KEYS.displayMode)) === 'standard' ? 'standard' : 'quiet' } catch { return 'quiet' }
}
/** C6: save it and tell the lens (which applies it at once). */
export async function writeDisplayMode(kv: KV, mode: DisplayMode): Promise<void> {
  await kv.set(KEYS.displayMode, mode)
  bus.emit('displayModeChanged', mode)
}

/** C5 / F20: the server's degraded-mode status in plain lines; ok=false when something is degraded. */
export function parseStatus(s: StatusResponse): { ok: boolean; lines: string[] } {
  const lines = [s.aiDailyCap != null ? `AI calls today: ${s.aiCallsToday} of ${s.aiDailyCap}` : `AI calls today: ${s.aiCallsToday} (no daily cap)`]
  const reasons = s.degradedReasons ?? []
  if (reasons.includes('ai_budget_reached') || (s.aiDailyCap != null && s.aiCallsToday >= s.aiDailyCap)) lines.push('Daily AI limit reached: notes still save, sorting resumes tomorrow')
  if (reasons.includes('speech_to_text_unconfigured') || !s.sttConfigured) lines.push('Speech-to-text is not set up on the server: voice notes wait in the queue')
  return { ok: lines.length === 1, lines }
}
