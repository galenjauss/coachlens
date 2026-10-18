import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { makeTestDb, makeDeps } from '../test/helpers'
import { dbBudget, BudgetExceededError } from './budget'
import { anthropicLlm, modelFor, MODEL_FAST, MODEL_SMART } from './llm'
import { withRun } from './runs'
import { agentRuns, llmUsage } from '../db/schema'

const TZ = 'America/Los_Angeles'

describe('daily AI budget', () => {
  it('cap 2: the third take() throws, and the counter resets on a new local day', async () => {
    const db = await makeTestDb()
    let now = new Date('2026-10-18T06:30:00Z') // Sat 2026-10-17 11:30 PM PT
    const b = dbBudget(db, 2, TZ, () => now)
    await b.take()
    await b.take()
    await expect(b.take()).rejects.toBeInstanceOf(BudgetExceededError)
    await expect(b.take()).rejects.toThrow('Daily AI budget reached')
    now = new Date('2026-10-18T07:30:00Z') // Sun 2026-10-18 12:30 AM PT
    await b.take()
    const rows = await db.select().from(llmUsage)
    expect(Object.fromEntries(rows.map(r => [r.day, r.calls]))).toEqual({ '2026-10-17': 4, '2026-10-18': 1 })
  })

  it('counts concurrent takes atomically', async () => {
    const db = await makeTestDb()
    const b = dbBudget(db, 5, TZ, () => new Date('2026-10-18T18:00:00Z'))
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => b.take()))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(3)
  })
})

describe('anthropicLlm', () => {
  it('routes the router and the class-question answer to the fast model and every other agent to the smart model', () => {
    const opts = { fast: 'f-model', smart: 's-model' }
    expect(modelFor('router', opts)).toBe('f-model')
    expect(modelFor('answer', opts)).toBe('f-model')
    for (const name of ['planner.draft', 'planner.diff', 'planner.alternatives', 'parent_email', 'report_card']) expect(modelFor(name, opts)).toBe('s-model')
    expect(MODEL_FAST).toBe('claude-haiku-5-5')
    expect(MODEL_SMART).toBe('claude-sonnet-5-5')
  })

  it('over the cap, throws BudgetExceededError before calling the provider; withRun logs it', async () => {
    const db = await makeTestDb()
    const llm = anthropicLlm({ fast: 'never-called', smart: 'never-called', budget: { async take() { throw new BudgetExceededError() } } })
    const call = () => llm.object({ name: 'router', instructions: 'x', prompt: 'y', schema: z.object({ a: z.string() }) })
    await expect(call()).rejects.toBeInstanceOf(BudgetExceededError)
    const r = await withRun(makeDeps(db), { agent: 'router', trigger: 'utterance', sessionId: null }, async () => ({ result: await call(), summary: 'ok', reason: 'ok' }))
    expect(r).toBeNull()
    const [run] = await db.select().from(agentRuns)
    expect(run).toMatchObject({ status: 'error', summary: 'Daily AI budget reached' })
  })
})
