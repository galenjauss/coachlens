import { describe, it, expect } from 'vitest'
import { diffSummary, type SummaryDrill } from './diffSummary'

const d = (id: string, name: string, minutes = 5): SummaryDrill => ({ id, name, minutes })

describe('diffSummary', () => {
  it('is empty when nothing changed', () => {
    expect(diffSummary([d('a', 'A'), d('b', 'B')], [d('a', 'A'), d('b', 'B')])).toEqual([])
  })
  it('reports adds, removes and minute changes', () => {
    const lines = diffSummary([d('a', 'Warm-up', 10), d('b', 'Kata 2')], [d('a', 'Warm-up', 5), d('c', 'Partner sparring', 6)])
    expect(lines).toEqual(['+ Partner sparring 6m', '- Kata 2', '~ Warm-up 10→5m'])
  })
  it('reports a rename', () => {
    expect(diffSummary([d('a', 'Pads')], [d('a', 'Pad rounds')])).toEqual(['~ Pad rounds renamed'])
  })
  it('reports a reorder as the moved item and its new place', () => {
    expect(diffSummary([d('a', 'A'), d('b', 'Pads'), d('c', 'C')], [d('b', 'Pads'), d('a', 'A'), d('c', 'C')])).toEqual(['↕ A moved to 2nd'])
    expect(diffSummary([d('a', 'A'), d('b', 'B'), d('c', 'Pads')], [d('c', 'Pads'), d('a', 'A'), d('b', 'B')])).toEqual(['↕ Pads moved to 1st'])
  })
  it('does not call a pure add or remove a reorder', () => {
    expect(diffSummary([d('a', 'A'), d('b', 'B')], [d('b', 'B'), d('x', 'X', 3)])).toEqual(['+ X 3m', '- A'])
  })
  it('keeps every line within 38 chars, trimming the name at a word boundary', () => {
    const long = 'Advanced partner pad combination footwork circuit'
    const lines = diffSummary([d('a', long, 10)], [d('a', long, 4), d('b', long, 12)])
    expect(lines.length).toBe(2)
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(38)
    expect(lines[0]).toMatch(/^\+ Advanced partner pad.*… 12m$/)
    expect(lines[1]).toMatch(/→4m$/)
  })
  it('shows 3 changes and "+N more" when there are more than 4', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => d(i, `Old ${i}`))
    const lines = diffSummary(before, [])
    expect(lines).toEqual(['- Old a', '- Old b', '- Old c', '+3 more'])
  })
  it('shows all 4 when there are exactly 4 changes', () => {
    expect(diffSummary(['a', 'b', 'c', 'd'].map(i => d(i, i)), [])).toHaveLength(4)
  })
})
