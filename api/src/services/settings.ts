import { and, eq } from 'drizzle-orm'
import { AUTONOMY_RULES, AutonomyTask, type Autonomy, type SettingsPatch, type SettingsResponse } from '@matside/shared'
import type { Db } from '../db/client'
import { agentSettings, instructorSettings } from '../db/schema'
import { currentInstructorId } from '../http/context'
import { setVocab, vocabHints } from './vocab'

export class SettingsError extends Error {}

const isAllowed = (task: AutonomyTask, v: Autonomy) => AUTONOMY_RULES[task].allowed.includes(v)

/**
 * Storage (C4): the request's instructor (request scope, inherited by deferred work) has their own rows.
 * Outside a request scope (scripts, direct service tests) the legacy deployment-wide table is read.
 */
async function storedRows(db: Db, task?: AutonomyTask): Promise<{ task: string; autonomy: string }[]> {
  const ins = currentInstructorId()
  if (!ins) return db.select({ task: agentSettings.task, autonomy: agentSettings.autonomy }).from(agentSettings).where(task ? eq(agentSettings.task, task) : undefined)
  return db.select({ task: instructorSettings.task, autonomy: instructorSettings.autonomy }).from(instructorSettings)
    .where(and(eq(instructorSettings.instructorId, ins), task ? eq(instructorSettings.task, task) : undefined))
}

/** The task's autonomy: its stored value, or the default when unset (or stored value is no longer allowed). */
export async function getAutonomy(db: Db, task: AutonomyTask): Promise<Autonomy> {
  const [row] = await storedRows(db, task)
  const v = row?.autonomy as Autonomy | undefined
  return v && isAllowed(task, v) ? v : AUTONOMY_RULES[task].default
}

export async function getSettings(db: Db): Promise<SettingsResponse> {
  const rows = await storedRows(db)
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
  const ins = currentInstructorId()
  for (const [task, autonomy] of entries) {
    if (ins) await db.insert(instructorSettings).values({ instructorId: ins, task, autonomy }).onConflictDoUpdate({ target: [instructorSettings.instructorId, instructorSettings.task], set: { autonomy } })
    else await db.insert(agentSettings).values({ task, autonomy }).onConflictDoUpdate({ target: agentSettings.task, set: { autonomy } })
  }
  if (patch.vocabulary) await setVocab(db, patch.vocabulary)
  return getSettings(db)
}
