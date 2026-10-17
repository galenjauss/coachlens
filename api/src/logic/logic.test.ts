import { describe, it, expect } from 'vitest'
import { resolveName, jaroWinkler } from './names'
import { parseAttendance } from './attendance'
import { isRecurring } from './recurring'
import { rankNextStudent } from './ranking'
import { applyDiff, totalMinutes } from './deckDiff'
import { buildCardLines } from './cardLines'
import { localDate, localWeekday, weekStart, nextDateForWeekday, addDays } from './dates'

const roster = [
  { id: 's1', name: 'Priya Rao', nickname: null, belt: 'orange' },
  { id: 's2', name: 'Maya Chen', nickname: null, belt: 'yellow' },
  { id: 's3', name: 'Mia Lopez', nickname: null, belt: 'white' },
  { id: 's4', name: 'Leonardo Diaz', nickname: 'Leo', belt: 'yellow' },
]

describe('names', () => {
  it('jaroWinkler is 1 for equal strings and 0 for empty', () => {
    expect(jaroWinkler('priya', 'priya')).toBe(1)
    expect(jaroWinkler('', 'priya')).toBe(0)
  })
  it('matches exact first names, nicknames and close misspellings', () => {
    expect(resolveName('Priya', roster)).toMatchObject({ kind: 'match', student: { id: 's1' } })
    expect(resolveName("Leo's", roster)).toMatchObject({ kind: 'match', student: { id: 's4' } })
    expect(resolveName('Pria', roster)).toMatchObject({ kind: 'match', student: { id: 's1' } })
  })
  it('returns two options when ambiguous', () => {
    const r = resolveName('Mya', roster)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.options.map(o => o.id).sort()).toEqual(['s2', 's3'])
  })
  it('returns none for unknown names', () => {
    expect(resolveName('Bob', roster)).toEqual({ kind: 'none' })
  })
})

describe('attendance', () => {
  it('parses everyone except', () => {
    expect(parseAttendance('Everyone except Jake and Mia')).toEqual({ kind: 'except', names: ['Jake', 'Mia'] })
    expect(parseAttendance("everybody's here but Jake, Mia, and Leo.")).toEqual({ kind: 'except', names: ['Jake', 'Mia', 'Leo'] })
  })
  it('parses everyone here', () => {
    expect(parseAttendance("Everyone's here")).toEqual({ kind: 'all' })
  })
  it('returns null for other speech', () => {
    expect(parseAttendance('Priya guard drops')).toBeNull()
  })
})

describe('recurring', () => {
  it('opens on the third note when no issue is open', () => {
    expect(isRecurring(2, false)).toBe(false)
    expect(isRecurring(3, false)).toBe(true)
    expect(isRecurring(4, true)).toBe(false)
  })
})

describe('ranking', () => {
  const now = new Date('2026-10-20T00:00:00Z')
  const present = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cal' }, { id: 'd', name: 'Dee' }]
  const base = { present, notedIds: new Set<string>(), remindIds: new Set<string>(), openIssue: new Map(), lastNoteAt: new Map(), now }
  it('prefers reminded, then open issue, then oldest note', () => {
    expect(rankNextStudent({ ...base, remindIds: new Set(['c']) })).toEqual({ id: 'c', name: 'Cal', reason: 'missed last class' })
    expect(rankNextStudent({ ...base, openIssue: new Map([['b', 'guard']]) })).toEqual({ id: 'b', name: 'Ben', reason: 'guard' })
    const lastNoteAt = new Map([['a', new Date('2026-10-18T00:00:00Z')], ['b', new Date('2026-10-01T00:00:00Z')], ['c', new Date('2026-10-10T00:00:00Z')], ['d', new Date('2026-10-12T00:00:00Z')]])
    expect(rankNextStudent({ ...base, lastNoteAt })).toEqual({ id: 'b', name: 'Ben', reason: '19 days since note' })
  })
  it('says no notes yet and skips noted students; null when all noted', () => {
    expect(rankNextStudent({ ...base, notedIds: new Set(['a']) })).toMatchObject({ id: 'b', reason: 'no notes yet' })
    expect(rankNextStudent({ ...base, notedIds: new Set(['a', 'b', 'c', 'd']) })).toBeNull()
  })
})

describe('deckDiff', () => {
  const d = (id: string, position: number, name: string, minutes = 5) => ({ id, position, name, minutes, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '' })
  it('removes, changes, and inserts in order', () => {
    const drills = [d('x1', 1, 'Tag'), d('x2', 2, 'Holds'), d('x3', 3, 'Sharks')]
    const out = applyDiff(drills, {
      removed: [{ drillId: 'x3', reason: 'too wild' }],
      changed: [{ drillId: 'x1', after: { ...d('x1', 1, 'Line drills'), id: undefined } as never, reason: 'structure' }],
      added: [{ name: 'Sparring', minutes: 8, kind: 'sparring', cues: [], focusStudentIds: [], rationale: '', afterPosition: 2, reason: 'green belts' },
              { name: 'Bow-in', minutes: 1, kind: 'warmup', cues: [], focusStudentIds: [], rationale: '', afterPosition: 0, reason: 'reset' }],
      rememberSuggestion: null,
    })
    expect(out.map(x => x.name)).toEqual(['Bow-in', 'Line drills', 'Holds', 'Sparring'])
    expect(out.map(x => x.id)).toEqual([null, 'x1', 'x2', null])
    expect(totalMinutes(out)).toBe(1 + 5 + 5 + 8)
  })
})

describe('cardLines', () => {
  it('builds the recurring feedback card', () => {
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: 'guard', count: 3, recurring: true }]))
      .toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ parent note drafting', '→ added to next deck'])
  })
  it('combines feedback and billing and caps at 4 lines', () => {
    const lines = buildCardLines([
      { kind: 'feedback', name: 'Sam', tag: 'forms', count: 1, recurring: false },
      { kind: 'billing', name: 'Leo', urgency: 'high' },
      { kind: 'feedback', name: 'Ava', tag: 'forms', count: 1, recurring: false },
      { kind: 'feedback', name: 'Ben', tag: 'kicks', count: 3, recurring: true },
    ])
    expect(lines).toEqual(['✓ Sam · forms', '✓ Billing flag · Leo · HIGH', '✓ Ava · forms', '+1 more'])
  })
  it('formats attendance', () => {
    expect(buildCardLines([{ kind: 'attendance', present: 12, absentNames: ['Jake', 'Mia'] }])).toEqual(['12 present', 'absent: Jake, Mia'])
  })
})

describe('dates', () => {
  it('computes local date/weekday in a time zone', () => {
    const d = new Date('2026-10-20T00:30:00Z') // Mon Oct 19, 5:30 PM PT
    expect(localDate(d, 'America/Los_Angeles')).toBe('2026-10-19')
    expect(localWeekday(d, 'America/Los_Angeles')).toBe(1)
  })
  it('date arithmetic', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19')
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(nextDateForWeekday('2026-10-20', 2)).toBe('2026-10-27')
    expect(nextDateForWeekday('2026-10-19', 4)).toBe('2026-10-22')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})
