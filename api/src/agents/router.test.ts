import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { MODES } from '@matside/shared'
import { routeUtterance, routerInstructions } from './router'
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
    const intents = await routeUtterance(deps, { sessionId: 'sess', transcript: 'Priya guard drops', roster, drillName: 'Jab drill', theme: 'Stances', mode: MODES.martial_arts })
    expect(intents?.[0]?.type).toBe('feedback')
    expect(seenPrompt).toContain('Priya Rao')
    const runs = await db.select().from(agentRuns)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ agent: 'router', status: 'ok', sessionId: 'sess' })
  })

  it('personal_training router prompt speaks of clients and lists only the PT tags', async () => {
    const pt = routerInstructions(MODES.personal_training)
    expect(pt).toContain('client')
    for (const t of MODES.personal_training.tags) expect(pt).toContain(t)
    expect(pt).not.toContain('guard')
    expect(pt).toContain('sessions left in package')
    expect(pt).toContain('nutrition')
    expect(routerInstructions(MODES.martial_arts)).toContain("student's parent")
    expect(routerInstructions(MODES.tutoring)).toContain('procedure')
  })

  it('rejects a tag from another mode (router run errors → null)', async () => {
    const db = await makeTestDb()
    let seenInstructions = ''
    const deps = makeDeps(db, {
      llm: fakeLlm(({ instructions }) => {
        seenInstructions = instructions
        return { intents: [{ type: 'feedback', studentNames: ['Maria'], content: 'x', skillTags: ['guard'], urgency: null, amount: null, minutes: null, attendanceStatus: null }] }
      }),
    })
    const r = await routeUtterance(deps, { sessionId: 's', transcript: 'Maria guard', roster: [{ id: 'm', name: 'Maria Gomez', nickname: null, belt: 'client' }], drillName: null, theme: 'Lower-body strength', mode: MODES.personal_training })
    expect(r).toBeNull()
    expect(seenInstructions).toContain('message the client')
    const [run] = await db.select().from(agentRuns)
    expect(run).toMatchObject({ agent: 'router', status: 'error' })
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
