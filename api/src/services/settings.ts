import { eq } from 'drizzle-orm'
import { AUTONOMY_RULES, AutonomyTask, DEFAULT_RANK_REVIEW, RankReviewSettings, type Autonomy, type SettingsPatch, type SettingsResponse } from '@matside/shared'
import type { Db } from '../db/client'
import { agentSettings, kv } from '../db/schema'
import { setVocab, vocabHints } from './vocab'

export class SettingsError extends Error {}

const isAllowed = (task: AutonomyTask, v: Autonomy) => AUTONOMY_RULES[task].allowed.includes(v)

/** The task's autonomy: its stored value, or the default when unset (or stored value is no longer allowed). */
export async function getAutonomy(db: Db, task: AutonomyTask): Promise<Autonomy> {
  const [row] = await db.select().from(agentSettings).where(eq(agentSettings.task, task))
  const v = row?.autonomy as Autonomy | undefined
  return v && isAllowed(task, v) ? v : AUTONOMY_RULES[task].default
}

const RANK_REVIEW_KEY = 'settings:rank_review'

/** The school's rank-review thresholds: stored values over the defaults (a corrupt row reads as the defaults). */
export async function getRankReview(db: Db): Promise<RankReviewSettings> {
  const [row] = await db.select().from(kv).where(eq(kv.key, RANK_REVIEW_KEY))
  if (!row) return DEFAULT_RANK_REVIEW
  try {
    const parsed = RankReviewSettings.partial().safeParse(JSON.parse(row.value))
    return parsed.success ? { ...DEFAULT_RANK_REVIEW, ...parsed.data } : DEFAULT_RANK_REVIEW
  } catch {
    return DEFAULT_RANK_REVIEW
  }
}

export async function getSettings(db: Db): Promise<SettingsResponse> {
  const rows = await db.select().from(agentSettings)
  const stored = new Map(rows.map(r => [r.task, r.autonomy as Autonomy]))
  const autonomy = Object.fromEntries(AutonomyTask.options.map(t => {
    const v = stored.get(t)
    return [t, v && isAllowed(t, v) ? v : AUTONOMY_RULES[t].default]
  })) as Record<AutonomyTask, Autonomy>
  return { autonomy, vocabulary: await vocabHints(db), rankReview: await getRankReview(db) }
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
  if (patch.rankReview) {
    const value = JSON.stringify({ ...await getRankReview(db), ...patch.rankReview })
    await db.insert(kv).values({ key: RANK_REVIEW_KEY, value }).onConflictDoUpdate({ target: kv.key, set: { value, updatedAt: new Date() } })
  }
  return getSettings(db)
}
