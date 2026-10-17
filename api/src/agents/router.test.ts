import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { routeUtterance } from './router'
import { withRun } from './runs'
import { agentRuns } from '../db/schema'

const roster = [{ id: 's1', name: 'Priya Rao', nickname: null, belt: 'orange' }]

describe('router', () => {
  it('returns intents and logs a run with the roster in the prompt', async () => {
    const db = await makeTestDb()
    let seenPrompt = ''
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name, prompt }) => {
        expect(name).toBe('router')
        seenPrompt = prompt
        return { intents: [{ type: 'feedback', studentNames: ['Priya'], content: 'guard drops', skillTags: ['guard'], urgency: null, amount: null, minutes: null, attendanceStatus: null }] }
      }),
    })
    const intents = await routeUtterance(deps, { sessionId: 'sess', transcript: 'Priya guard drops', roster, drillName: 'Jab drill', theme: 'Stances' })
    expect(intents?.[0]?.type).toBe('feedback')
    expect(seenPrompt).toContain('Priya Rao')
    const runs = await db.select().from(agentRuns)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ agent: 'router', status: 'ok', sessionId: 'sess' })
  })

  it('withRun records errors and returns null', async () => {
    const db = await makeTestDb()
    const deps = makeDeps(db)
    const r = await withRun(deps, { agent: 'x', trigger: 't', sessionId: null }, async () => { throw new Error('boom') })
    expect(r).toBeNull()
    const [run] = await db.select().from(agentRuns)
    expect(run).toMatchObject({ status: 'error', summary: 'boom' })
  })
})
