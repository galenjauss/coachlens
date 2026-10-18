import { describe, expect, it } from 'vitest'
import type { DeckDiff, Drill } from '@matside/shared'
import { ApiError, NetworkError } from '../core/api'
import {
  appendItem, blankItem, buildPatch, canAdd, canDelete, chipsFor, clampCues, deckErrorOutcome, diffCountsText, diffTotalText,
  labelsFor, moveItem, replaceConfirmText, START_OPTIONS, removeItem, replaceItem, toEditable, totalMinutes,
} from './deckLogic'

const drill = (id: string, over: Partial<Drill> = {}): Drill => ({
  id, position: 0, startedAt: null, endedAt: null, name: id, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: 'why', ...over,
})

describe('chipsFor / labelsFor', () => {
  it('has four mode-specific chips each', () => {
    expect(chipsFor('martial_arts')).toEqual(['More games', 'Shorter', 'More sparring', 'Low energy day'])
    expect(chipsFor('personal_training')).toEqual(['More conditioning', 'Shorter', 'Lighter load', 'Recovery day'])
    expect(chipsFor('tutoring')).toEqual(['More practice', 'Shorter', 'Review basics', 'Test prep'])
  })
  it('pluralizes per mode', () => {
    const words = { martial_arts: ['drill', 'drills'], personal_training: ['exercise', 'exercises'], tutoring: ['activity', 'activities'] } as const
    for (const m of ['martial_arts', 'personal_training', 'tutoring'] as const) {
      const l = labelsFor(m)
      expect([1, 2].map(n => (n === 1 ? l.item : l.itemPlural))).toEqual(words[m])
    }
  })
  it('uses mode wording', () => {
    expect(labelsFor('martial_arts')).toMatchObject({ planUnit: 'Drill deck', item: 'drill' })
    expect(labelsFor('personal_training').item).toBe('exercise')
    expect(labelsFor('tutoring').item).toBe('activity')
  })
})

describe('patch building', () => {
  const list = ['a', 'b', 'c'].map(id => toEditable(drill(id)))
  it('reorder keeps ids', () => {
    const p = buildPatch(moveItem(list, 0, 1))
    expect(p.drills.map(d => d.id)).toEqual(['b', 'a', 'c'])
  })
  it('move out of range is a no-op copy', () => {
    const m = moveItem(list, 0, -1)
    expect(m).toEqual(list); expect(m).not.toBe(list)
    expect(moveItem(list, 2, 1)).toEqual(list)
  })
  it('does not mutate input', () => {
    const copy = [...list]; moveItem(list, 0, 1); removeItem(list, 1)
    expect(list).toEqual(copy)
  })
  it('delete keeps remaining ids', () => {
    expect(buildPatch(removeItem(list, 1)).drills.map(d => d.id)).toEqual(['a', 'c'])
  })
  it('add sends id null and trims name', () => {
    const p = buildPatch(appendItem(list, { ...blankItem(), name: '  Pad work  ' }))
    expect(p.drills.at(-1)).toMatchObject({ id: null, name: 'Pad work' })
    expect(p.drills.slice(0, 3).map(d => d.id)).toEqual(['a', 'b', 'c'])
  })
  it('replace keeps the id and clamps minutes', () => {
    const p = buildPatch(replaceItem(list, 1, { ...list[1]!, minutes: 99 }))
    expect(p.drills[1]).toMatchObject({ id: 'b', minutes: 30 })
    expect(buildPatch([{ ...list[0]!, minutes: 0 }]).drills[0]!.minutes).toBe(1)
    expect(buildPatch([{ ...list[0]!, minutes: NaN }]).drills[0]!.minutes).toBe(1)
  })
  it('limits', () => {
    expect(canAdd(19)).toBe(true); expect(canAdd(20)).toBe(false)
    expect(canDelete(1)).toBe(false); expect(canDelete(2)).toBe(true)
  })
})

describe('cue clamping', () => {
  it('max 2 cues of 40 chars, drops blanks', () => {
    expect(clampCues(['  knees out ', '', 'x'.repeat(120), 'third'])).toEqual(['knees out', 'x'.repeat(90)])
  })
  it('applies in patch', () => {
    const e = { ...toEditable(drill('a')), cues: ['1', '2', '3'] }
    expect(buildPatch([e]).drills[0]!.cues).toEqual(['1', '2'])
  })
})

describe('diff formatting', () => {
  it('totals', () => {
    expect(diffTotalText(40, 45)).toBe('40 → 45 min (+5)')
    expect(diffTotalText(45, 40)).toBe('45 → 40 min (−5)')
    expect(diffTotalText(45, 45)).toBe('45 min (no change)')
  })
  it('counts', () => {
    const d: DeckDiff = { added: [], changed: [], removed: [], rememberSuggestion: null }
    expect(diffCountsText(d)).toBe('no changes')
    const full = { ...d, removed: [{ drillId: 'x', reason: '' }], changed: [{ drillId: 'y', after: toEditable(drill('y')), reason: '' }] } as DeckDiff
    expect(diffCountsText(full)).toBe('1 changed · 1 removed')
  })
  it('sums minutes', () => expect(totalMinutes([{ minutes: 3 }, { minutes: 4 }])).toBe(7))
})

describe('deckErrorOutcome', () => {
  it('planner 502 and accept 409', () => {
    expect(deckErrorOutcome(new ApiError(502, 'x'), 'suggest').text).toBe('Planner unavailable right now.')
    expect(deckErrorOutcome(new ApiError(502, 'x'), 'alternatives').text).toBe('Planner unavailable right now.')
    expect(deckErrorOutcome(new ApiError(409, 'x'), 'accept')).toEqual({ kind: 'gone', text: 'Already applied — reloaded.' })
  })
  it('409 elsewhere is an error, network is generic', () => {
    expect(deckErrorOutcome(new ApiError(409, 'x'), 'save').kind).toBe('error')
    expect(deckErrorOutcome(new NetworkError('n'), 'save').text).toMatch(/connection/)
    expect(deckErrorOutcome(new ApiError(400, 'dup'), 'save').text).toMatch(/rejected/)
  })
})

describe('start-from helpers', () => {
  it('lists the four starting points', () => {
    expect(START_OPTIONS.map(o => o.label)).toEqual(['Repeat last class', 'Copy another class’s plan', 'Blank', 'Let AI draft'])
  })
  it('confirm text counts the items being replaced', () => {
    expect(replaceConfirmText(1, 'Blank')).toContain('replaces the 1 item in')
    expect(replaceConfirmText(6, 'Blank')).toContain('replaces the 6 items')
    expect(replaceConfirmText(0, 'Blank')).toContain('empty')
  })
  it('replace errors name the cause', () => {
    expect(deckErrorOutcome(new ApiError(409, 'x'), 'replace').text).toMatch(/already started/)
    expect(deckErrorOutcome(new ApiError(404, 'x'), 'replace').text).toMatch(/Nothing to copy/)
    expect(deckErrorOutcome(new ApiError(502, 'x'), 'replace').text).toMatch(/plan was kept/)
  })
})
