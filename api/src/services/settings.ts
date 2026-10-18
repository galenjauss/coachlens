import { eq } from 'drizzle-orm'
import { AUTONOMY_RULES, AutonomyTask, type Autonomy, type SettingsPatch, type SettingsResponse } from '@matside/shared'
import type { Db } from '../db/client'
import { agentSettings } from '../db/schema'
import { setVocab, vocabHints } from './vocab'

export class SettingsError extends Error {}

const isAllowed = (task: AutonomyTask, v: Autonomy) => AUTONOMY_RULES[task].allowed.includes(v)

/** The task's autonomy: its stored value, or the default when unset (or stored value is no longer allowed). */
export async function getAutonomy(db: Db, task: AutonomyTask): Promise<Autonomy> {
  const [row] = await db.select().from(agentSettings).where(eq(agentSettings.task, task))
  const v = row?.autonomy as Autonomy | undefined
  return v && isAllowed(task, v) ? v : AUTONOMY_RULES[task].default
}

export async function getSettings(db: Db): Promise<SettingsResponse> {
  const rows = await db.select().from(agentSettings)
  const stored = new Map(rows.map(r => [r.task, r.autonomy as Autonomy]))
  const autonomy = Object.fromEntries(AutonomyTask.options.map(t => {
    const v = stored.get(t)
    return [t, v && isAllowed(t, v) ? v : AUTONOMY_RULES[t].default]
  })) as Record<AutonomyTask, Autonomy>
  return { autonomy, vocabulary: await vocabHints(db) }
}

/** Validates every value against the task's allowed set before writing anything; throws SettingsError (-> 400). */
export async function patchSettings(db: Db, patch: SettingsPatch): Promise<SettingsResponse> {
  const entries = Object.entries(patch.autonomy ?? {}) as [AutonomyTask, Autonomy][]
  for (const [task, v] of entries) {
    if (!isAllowed(task, v)) throw new SettingsError(`${task} cannot be set to ${v}`)
  }
  for (const [task, autonomy] of entries) {
    await db.insert(agentSettings).values({ task, autonomy }).onConflictDoUpdate({ target: agentSettings.task, set: { autonomy } })
  }
  if (patch.vocabulary) await setVocab(db, patch.vocabulary)
  return getSettings(db)
}
