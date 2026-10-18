import { describe, expect, it } from 'vitest'
import type { AgentTile } from '@matside/shared'
import { addAlias, latestTile, relTime, removeAlias, sortTiles, steeringFor, taskLabel, tileStatus } from './agentsLogic'

const run = (createdAt: string) => ({ id: createdAt, agent: 'x', summary: 's', reason: 'r', status: 'ok' as const, createdAt })
const tile = (task: AgentTile['task'], color: AgentTile['color'], today: number, urgent = 0, pending = 0, latest: AgentTile['latest'] = null): AgentTile =>
  ({ task, label: task, counts: { today, pending, urgent }, color, latest })

describe('sortTiles', () => {
  it('puts red first, then amber, then green, then by volume', () => {
    const out = sortTiles([tile('planner', 'green', 9), tile('billing', 'red', 1), tile('parent_email', 'amber', 2), tile('progress', 'red', 5)])
    expect(out.map(t => t.task)).toEqual(['progress', 'billing', 'parent_email', 'planner'])
  })
  it('does not mutate the input', () => {
    const input = [tile('planner', 'green', 1), tile('billing', 'red', 1)]
    sortTiles(input)
    expect(input[0]!.task).toBe('planner')
  })
})
describe('tileStatus', () => {
  it('prioritizes urgent, then pending, then done', () => {
    expect(tileStatus(tile('billing', 'red', 3, 2, 1))).toBe('2 urgent')
    expect(tileStatus(tile('parent_email', 'amber', 3, 0, 2))).toBe('2 to review')
    expect(tileStatus(tile('planner', 'green', 3))).toBe('all done')
    expect(tileStatus(tile('planner', 'green', 0))).toBe('quiet today')
  })
})
describe('latestTile', () => {
  it('picks the newest latest run', () => {
    const a = tile('planner', 'green', 1, 0, 0, run('2026-10-17T10:00:00Z'))
    const b = tile('billing', 'red', 1, 1, 0, run('2026-10-17T11:00:00Z'))
    expect(latestTile([a, b, tile('progress', 'green', 0)])?.task).toBe('billing')
    expect(latestTile([tile('progress', 'green', 0)])).toBeNull()
  })
})
describe('taskLabel', () => {
  it('maps known tasks and falls back to the raw id', () => {
    expect(taskLabel('parent_email')).toBe('Parent emails')
    expect(taskLabel('mystery')).toBe('mystery')
  })
})
describe('steeringFor', () => {
  const base = { task: null, outbox: null, diff: null, note: null, billing: null } as const
  it('maps linked items to steering', () => {
    expect(steeringFor({ ...base, outbox: { id: 'o', kind: 'parent_email', to: '', subject: '', body: '', status: 'pending_review', urgent: false } })).toBe('redraft')
    expect(steeringFor({ ...base, outbox: { id: 'o', kind: 'parent_email', to: '', subject: '', body: '', status: 'sent', urgent: false } })).toBe('none')
    expect(steeringFor({ ...base, billing: { id: 'b', note: '', urgency: 'high', amount: null, status: 'open' } })).toBe('billing_note')
    expect(steeringFor({ ...base, billing: { id: 'b', note: '', urgency: 'high', amount: null, status: 'handled' } })).toBe('none')
    expect(steeringFor({ ...base, task: 'progress', note: { id: 'n', text: '', heard: null, studentId: null } })).toBe('reassign')
  })
})
describe('relTime', () => {
  const now = new Date('2026-10-17T12:00:00Z').getTime()
  it('formats', () => {
    expect(relTime('2026-10-17T11:59:40Z', now)).toBe('just now')
    expect(relTime('2026-10-17T11:30:00Z', now)).toBe('30m ago')
    expect(relTime('2026-10-17T09:00:00Z', now)).toBe('3h ago')
    expect(relTime('2026-10-15T12:00:00Z', now)).toBe('2d ago')
  })
})
describe('aliases', () => {
  it('adds trimmed, rejects empty/duplicate/over cap', () => {
    expect(addAlias(['Jo'], '  Joey ')).toEqual({ list: ['Jo', 'Joey'] })
    expect(addAlias(['Jo'], 'jo')).toEqual({ error: 'Already added.' })
    expect(addAlias([], '  ')).toHaveProperty('error')
    expect(addAlias(Array.from({ length: 10 }, (_, i) => `a${i}`), 'zz')).toHaveProperty('error')
    expect(addAlias([], 'x'.repeat(41))).toHaveProperty('error')
  })
  it('removes immutably', () => {
    const l = ['a', 'b']
    expect(removeAlias(l, 'a')).toEqual(['b'])
    expect(l).toEqual(['a', 'b'])
  })
})
