import { describe, it, expect } from 'vitest'
import type { StudentMetric } from '@matside/shared'
import { groupMetrics, parseCustomField, reading, signedDelta, sparkline } from './metricsLogic'

const m = (id: string, key: string, num: number | null, at: string, unit: string | null = 'lb', value = ''): StudentMetric =>
  ({ id, key, value: value || (num === null ? 'x' : `${num} ${unit}`), num, unit, recordedAt: at, source: 'voice' })

describe('metricsLogic', () => {
  it('formats readings', () => {
    expect(reading(m('1', 'deadlift', 225, '2026-10-01'))).toBe('225 lb')
    expect(reading(m('1', 'test', 88, '2026-10-01', '%'))).toBe('88%')
    expect(reading(m('1', 'rank', null, '2026-10-01', null, 'green'))).toBe('green')
    expect(reading({ value: '7.25', num: 7.25, unit: null })).toBe('7.3')
  })
  it('draws a text sparkline, oldest first', () => {
    expect(sparkline([1])).toBe('')
    expect(sparkline([1, 5, 9])).toBe('▁▅█')
    expect(sparkline([3, 3])).toBe('▄▄')
  })
  it('groups by key with latest, delta and best', () => {
    const groups = groupMetrics([
      m('4', 'deadlift', 225, '2026-10-08'), m('3', 'squat', 185, '2026-10-05'),
      m('2', 'deadlift', 215, '2026-10-01'), m('1', 'deadlift', 205, '2026-09-20'),
    ])
    expect(groups.map(g => g.key)).toEqual(['deadlift', 'squat'])
    const d = groups[0]!
    expect(d.latest.id).toBe('4')
    expect(d.history).toHaveLength(3)
    expect(d.delta).toBe(10)
    expect(d.best).toBe(true)
    expect(d.spark).toBe('▁▅█')
    expect(groups[1]).toMatchObject({ delta: null, best: false, spark: '' })
  })
  it('a lower latest is not a best', () => {
    const g = groupMetrics([m('2', 'test', 70, '2026-10-08', '%'), m('1', 'test', 88, '2026-10-01', '%')])[0]!
    expect(g.best).toBe(false)
    expect(g.delta).toBe(-18)
    expect(signedDelta(g.delta!)).toBe('−18')
    expect(signedDelta(0)).toBe('±0')
  })
  it('never compares readings in different units', () => {
    const g = groupMetrics([m('2', 'squat', 120, '2026-10-08', 'kg'), m('1', 'squat', 100, '2026-10-01', 'lb')])[0]!
    expect(g).toMatchObject({ delta: null, best: false, spark: '' })
    const same = groupMetrics([m('2', 'squat', 120, '2026-10-08', 'LB'), m('1', 'squat', 100, '2026-10-01', 'lb')])[0]!
    expect(same).toMatchObject({ delta: 20, best: true })
  })
  it('validates the custom field form', () => {
    expect(parseCustomField({ key: ' ', value: 'x', num: '', unit: '' })).toEqual({ ok: false, error: 'Give the field a name.' })
    expect(parseCustomField({ key: 'k', value: '', num: '', unit: '' })).toEqual({ ok: false, error: 'Add a value or a number.' })
    expect(parseCustomField({ key: 'k', value: 'x', num: 'abc', unit: '' })).toMatchObject({ ok: false })
    expect(parseCustomField({ key: 'Mile', value: '', num: '7.5', unit: 'min' })).toEqual({ ok: true, body: { key: 'Mile', value: '7.5 min', num: 7.5, unit: 'min' } })
    expect(parseCustomField({ key: 'Goal', value: 'Handstand', num: '', unit: '' })).toEqual({ ok: true, body: { key: 'Goal', value: 'Handstand', num: null, unit: null } })
  })
})
