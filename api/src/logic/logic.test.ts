import { describe, it, expect } from 'vitest'
import { resolveName, jaroWinkler, addAlias } from './names'
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
  it('scores learned aliases', () => {
    expect(resolveName('Bree', roster)).toEqual({ kind: 'none' })
    const learned = roster.map(r => (r.id === 's1' ? { ...r, aliases: ['Bree ah'] } : r))
    expect(resolveName('Bree ah', learned)).toMatchObject({ kind: 'match', student: { id: 's1' } })
  })
  it('addAlias dedupes, skips known names and keeps the latest 10', () => {
    const s = { name: 'Priya Rao', nickname: null, aliases: ['Bree ah'] }
    expect(addAlias(s, 'bree ah')).toBe(s.aliases)
    expect(addAlias(s, 'Priya')).toBe(s.aliases)
    expect(addAlias(s, null)).toBe(s.aliases)
    expect(addAlias(s, ' Pria ')).toEqual(['Bree ah', 'Pria'])
    const full = { ...s, aliases: Array.from({ length: 10 }, (_, i) => `a${'x'.repeat(i)}`) }
    const next = addAlias(full, 'Preeya')
    expect(next).toHaveLength(10)
    expect(next[9]).toBe('Preeya')
    expect(next[0]).toBe('ax')
  })
  it('addAlias learns only name-like strings and collapses spelling variants', () => {
    const s = { name: 'Priya Rao', nickname: null, aliases: [] as string[] }
    for (const junk of ['he', 'She', 'the new kid', 'the twins', 'everyone', 'that kid', 'Priya 2', 'x', 'a b', 'one two three four']) expect(addAlias(s, junk)).toBe(s.aliases)
    const once = addAlias(s, 'Pree-ya')
    expect(once).toEqual(['Pree-ya'])
    expect(addAlias({ ...s, aliases: once }, 'Preeya')).toEqual(['Pree-ya'])
    expect(addAlias(s, "O'Neil")).toEqual(["O'Neil"])
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
    expect(parseAttendance('here comes Jake')).toBeNull()
  })
  it('parses roll call by presence', () => {
    expect(parseAttendance('Present: Priya, Leo, and Maya.')).toEqual({ kind: 'present', names: ['Priya', 'Leo', 'Maya'] })
    expect(parseAttendance('here: Jake, Mia')).toEqual({ kind: 'present', names: ['Jake', 'Mia'] })
    expect(parseAttendance('Only Jake and Mia are here')).toEqual({ kind: 'present', names: ['Jake', 'Mia'] })
    expect(parseAttendance('only Priya is here.')).toEqual({ kind: 'present', names: ['Priya'] })
    expect(parseAttendance('present: the kids from the morning class')).toBeNull()
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
      .toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ added to report card', '→ added to next deck'])
  })
  it('urgent notes say so; urgent + recurring still fits 4 lines', () => {
    expect(buildCardLines([{ kind: 'feedback', name: 'Leo', tag: 'focus', count: 1, recurring: false, urgent: true }]))
      .toEqual(['✓ Leo · focus', '⚠ urgent · parent note drafting'])
    expect(buildCardLines([{ kind: 'feedback', name: 'Leo', tag: 'focus', count: 3, recurring: true, urgent: true }]))
      .toEqual(['✓ Leo · focus (3rd time)', '⚠ urgent · parent note drafting', '→ added to report card', '→ added to next deck'])
  })
  it('urgent lines go first so overflow never cuts them', () => {
    expect(buildCardLines([
      { kind: 'feedback', name: 'Sam', tag: 'forms', count: 3, recurring: true },
      { kind: 'billing', name: 'Leo', urgency: 'high' },
      { kind: 'urgent_unassigned' },
    ])).toEqual(['⚠ urgent · pick student', '+2 more'])
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

describe('review regressions', () => {
  const dr = (id: string, position: number, name: string) => ({ id, position, name, minutes: 5, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '' })
  const add = (name: string, afterPosition: number) => ({ name, minutes: 1, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '', afterPosition, reason: '' })
  const diff = (o: object) => ({ removed: [], changed: [], added: [], rememberSuggestion: null, ...o }) as never
  it('add anchored to a removed drill lands at its original spot', () => {
    const out = applyDiff([dr('a', 1, 'A'), dr('b', 2, 'B'), dr('c', 3, 'C')], diff({ removed: [{ drillId: 'b', reason: '' }], added: [add('Z', 2)] }))
    expect(out.map(x => x.name)).toEqual(['A', 'Z', 'C'])
  })
  it('keeps diff order for adds at the same anchor', () => {
    const drills = [dr('a', 1, 'A'), dr('b', 2, 'B')]
    expect(applyDiff(drills, diff({ added: [add('P', 1), add('Q', 1)] })).map(x => x.name)).toEqual(['A', 'P', 'Q', 'B'])
    expect(applyDiff(drills, diff({ added: [add('P', 0), add('Q', 0)] })).map(x => x.name)).toEqual(['P', 'Q', 'A', 'B'])
  })
  it('exact name beats a near name; weak lone match is none', () => {
    const r = [{ id: '1', name: 'Leo Park', nickname: null, belt: 'white' }, { id: '2', name: 'Leon Diaz', nickname: null, belt: 'white' }]
    expect(resolveName('Leo', r)).toMatchObject({ kind: 'match', student: { id: '1' } })
    expect(resolveName('Mya', [{ id: '3', name: 'Maya Chen', nickname: null, belt: 'white' }])).toEqual({ kind: 'none' })
  })
  it('card overflow reserves a +N more line', () => {
    expect(buildCardLines([
      { kind: 'feedback', name: 'Priya', tag: 'guard', count: 3, recurring: true },
      { kind: 'billing', name: 'Leo', urgency: 'high' },
    ])).toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ added to report card', '+1 more'])
  })
  it('attendance ignores feedback sentences', () => {
    expect(parseAttendance('Everyone but Priya needs to work on guard')).toBeNull()
  })
  it('accepts curly apostrophes', () => {
    expect(parseAttendance('Everyone’s here')).toEqual({ kind: 'all' })
    expect(resolveName('Leo’s', roster)).toMatchObject({ kind: 'match', student: { id: 's4' } })
  })
})

describe('cardLines name_unclear', () => {
  it('renders an honest not-saved line', () => {
    const l = buildCardLines([{ kind: 'name_unclear', name: 'Zed' }])
    expect(l).toEqual(['? Didn\'t catch "Zed" · say again'])
    expect(l[0]!.length).toBeLessThanOrEqual(38)
  })
})

describe('cardLines rollcall_unclear', () => {
  it('asks for a repeat', () => {
    expect(buildCardLines([{ kind: 'rollcall_unclear', names: ['Mya'] }])).toEqual(["Didn't catch: Mya", 'Say it again or use phone roster'])
  })
})
