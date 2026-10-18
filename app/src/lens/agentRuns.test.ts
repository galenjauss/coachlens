import { describe, it, expect } from 'vitest'
import { expectedAgents, progressLines, runsDone } from './agentRuns'

const run = (agent: string, status = 'ok') => ({ agent, summary: '', status, createdAt: '2026-10-20T00:00:00Z' })

describe('agent progress', () => {
  it('expects the router, plus email/planner when the card announces them', () => {
    expect(expectedAgents(['✓ Priya · guard'])).toEqual(['router'])
    expect(expectedAgents(['⚠ urgent · parent note drafting'])).toEqual(['router', 'parent_email'])
    expect(expectedAgents(['✓ Planner: next deck suggestion queued'])).toEqual(['router', 'planner'])
  })

  it('runsDone once every expected agent has reported', () => {
    const lines = ['✓ Priya', '→ parent note for Priya drafting']
    expect(runsDone([run('router'), run('progress')], lines)).toBe(false)
    expect(runsDone([run('router'), run('progress'), run('parent_email')], lines)).toBe(true)
  })

  it('progress lines (ASCII): ok done, x failed, .. still expected; latest run per agent wins', () => {
    const card = { lines: ['✓ Priya', '→ parent note for Priya drafting'], runs: [run('router'), run('progress', 'error'), run('progress')], runsFinal: false }
    expect(progressLines(card)).toEqual(['ok sorted', 'ok logged', '.. email'])
    expect(progressLines({ ...card, runs: [run('router'), run('parent_email', 'error')] })).toEqual(['ok sorted', 'x email'])
  })

  it('after the 30 s timeout, expected agents that never reported show ? instead of vanishing', () => {
    const card = { lines: ['✓ Priya', '→ added to next deck'], runs: [run('router')], runsFinal: true }
    expect(progressLines(card)).toEqual(['ok sorted', '? plan'])
  })

  it('before the first poll: working; endpoint missing: the server card lines', () => {
    expect(progressLines({ lines: ['✓ a'], runs: null, runsFinal: false })).toEqual(['… agents working'])
    expect(progressLines({ lines: ['✓ a', '→ b'], runs: null, runsFinal: true })).toEqual(['✓ a', '→ b'])
  })
})
