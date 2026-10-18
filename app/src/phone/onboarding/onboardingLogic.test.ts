import { describe, expect, it } from 'vitest'
import type { StudentDraft } from '@matside/shared'
import { ApiError, NetworkError } from '../../core/api'
import {
  autoAssign, blankStudent, blankWeek, buildCommit, canLeaveStep, emailSummary, fitWithin, foundHeadline, initialDraft,
  mergeClasses, mergeStudents, mergeWeeks, onboardingErrorText, removeClass, renameClass, restoreDraft, setAllInClass, setMode,
  studentIssues, toggleEnrollment, unassignedCount, updateRow, weekStartFor, type Draft,
} from './onboardingLogic'

const st = (name: string, over: Partial<StudentDraft> = {}): StudentDraft => ({
  name, nickname: null, level: null, age: null, guardianName: null, guardianEmail: null, classNames: [], ...over,
})

function ready(): Draft {
  let d: Draft = { ...setMode(initialDraft(), 'martial_arts'), basics: { schoolName: 'Tiger Dojo', coachName: 'Ana', timeZone: 'America/Los_Angeles' } }
  d = { ...d, classes: mergeClasses([], [{ name: 'Kids Tue', weekday: 2, startTime: '17:00', mode: 'martial_arts' }, { name: 'Teens', weekday: 4, startTime: '18:00', mode: 'martial_arts' }]) }
  d = { ...d, students: mergeStudents([], [st('Priya Rao', { guardianEmail: 'a@x.com', classNames: ['kids tue'] }), st('Leo Diaz')]) }
  d = { ...d, weeks: mergeWeeks([], [{ week: 2, weekStart: null, theme: 'Blocks', itemsDue: [] }, { week: 1, weekStart: null, theme: 'Stances', itemsDue: ['Kata 1'] }]) }
  return d
}

describe('merging proposals', () => {
  it('classes: same name updates, new names append', () => {
    const a = mergeClasses([], [{ name: 'Kids', weekday: 2, startTime: '17:00', mode: 'tutoring' }])
    const b = mergeClasses(a, [{ name: ' kids ', weekday: 3, startTime: '16:00', mode: 'tutoring' }, { name: 'Teens', weekday: 4, startTime: '18:00', mode: 'tutoring' }])
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ key: a[0]!.key, weekday: 3, startTime: '16:00' })
  })
  it('students: fill gaps only, union classes, never erase', () => {
    const a = mergeStudents([], [st('Priya Rao', { level: 'yellow', classNames: ['Tue'] })])
    const b = mergeStudents(a, [st('priya rao', { level: 'orange', guardianEmail: 'm@x.com', classNames: ['tue', 'Thu'] }), st('Leo')])
    expect(b).toHaveLength(2)
    expect(b[0]).toMatchObject({ level: 'yellow', guardianEmail: 'm@x.com', classNames: ['Tue', 'Thu'] })
  })
  it('weeks: replace by week number and sort', () => {
    const w = mergeWeeks(ready().weeks, [{ week: 1, weekStart: null, theme: 'Kicks', itemsDue: [] }])
    expect(w.map(x => [x.week, x.theme])).toEqual([[1, 'Kicks'], [2, 'Blocks']])
  })
})

describe('table edits and class assignment', () => {
  it('updates and renames immutably, keeping assignments', () => {
    const d = ready()
    const r = renameClass(d, d.classes[0]!.key, 'Little Tigers')
    expect(r.students[0]!.classNames).toEqual(['Little Tigers'])
    expect(d.students[0]!.classNames).toEqual(['kids tue'])
    const u = updateRow(d.students, d.students[1]!.key, { age: 9 })
    expect(u[1]!.age).toBe(9)
    expect(d.students[1]!.age).toBeNull()
  })
  it('removing a class drops its assignments', () => {
    const d = ready()
    expect(removeClass(d, d.classes[0]!.key).students[0]!.classNames).toEqual([])
  })
  it('toggles one student and bulk-assigns a class', () => {
    const d = ready()
    const t = toggleEnrollment(d.students, d.students[1]!.key, 'Teens')
    expect(t[1]!.classNames).toEqual(['Teens'])
    expect(toggleEnrollment(t, t[1]!.key, 'teens')[1]!.classNames).toEqual([])
    const all = setAllInClass(d.students, 'Teens', true)
    expect(all.every(s => s.classNames.includes('Teens'))).toBe(true)
    expect(setAllInClass(all, 'Teens', false).every(s => !s.classNames.includes('Teens'))).toBe(true)
  })
  it('autoAssign: single class takes everyone unassigned; stale names drop', () => {
    const d = ready()
    expect(unassignedCount(d)).toBe(1)
    const one = autoAssign({ ...d, classes: [d.classes[1]!] })
    expect(one.students.map(s => s.classNames)).toEqual([['Teens'], ['Teens']])
    expect(autoAssign(d).students.map(s => s.classNames)).toEqual([['Kids Tue'], []])
  })
  it('setMode moves default-mode classes along', () => {
    const d = setMode(ready(), 'tutoring')
    expect(d.classes.every(c => c.mode === 'tutoring')).toBe(true)
  })
})

describe('summaries', () => {
  it('headline and email summary use the mode words', () => {
    expect(foundHeadline('roster', 14, 'martial_arts')).toBe('AI found 14 students — check them')
    expect(foundHeadline('roster', 1, 'personal_training')).toBe('AI found 1 client — check it')
    expect(foundHeadline('classes', 0, 'tutoring')).toContain('didn’t find any classes')
    expect(emailSummary([st('a', { guardianEmail: 'a@x.com' }), st('b'), st('c')], 'martial_arts')).toBe('1 with parent email · 2 missing')
    expect(emailSummary([st('a', { guardianEmail: 'a@x.com' }), st('b', { guardianEmail: 'b@x.com' })], 'personal_training')).toBe('2 with client emails · 0 missing')
  })
})

describe('buildCommit', () => {
  it('shapes a valid commit with week dates and real class names', () => {
    const r = buildCommit(ready(), '2026-10-21')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.commit.students[0]!.classNames).toEqual(['Kids Tue'])
    expect(r.commit.curriculum).toEqual([
      { weekStart: '2026-10-19', theme: 'Stances', itemsDue: ['Kata 1'] },
      { weekStart: '2026-10-26', theme: 'Blocks', itemsDue: [] },
    ])
    expect(r.commit.classes[0]).not.toHaveProperty('key')
  })
  it('drops fully blank rows, flags bad ones', () => {
    const d = ready()
    const withBlank = { ...d, students: [...d.students, blankStudent()], weeks: [...d.weeks, blankWeek(d.weeks)] }
    expect(buildCommit(withBlank, '2026-10-21').ok).toBe(true)
    const bad = { ...d, students: mergeStudents(d.students, [st('', { guardianEmail: 'x@y.com' }), st('Bo', { guardianEmail: 'nope' })]) }
    const r = buildCommit(bad, '2026-10-21')
    expect(r).toEqual({ ok: false, errors: ['2 roster rows have a missing name, bad email or age.'] })
  })
  it('requires mode, basics and a class', () => {
    const r = buildCommit(initialDraft(), '2026-10-21')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors).toHaveLength(4)
    const dup = ready()
    expect(buildCommit({ ...dup, classes: mergeClasses(dup.classes, []).map((c, i) => ({ ...c, name: i ? 'kids tue' : c.name })) }, '2026-10-21'))
      .toEqual({ ok: false, errors: ['Two classes share a name — rename one.'] })
  })
  it('reports two weeks with the same number instead of dropping one', () => {
    const d = ready()
    const clash = { ...d, weeks: d.weeks.map(w => ({ ...w, week: 1 })) }
    expect(buildCommit(clash, '2026-10-21')).toEqual({ ok: false, errors: ['Two weeks share week 1. Change one week number.'] })
    const dated = { ...d, weeks: [d.weeks[0]!, { ...d.weeks[1]!, week: 9, weekStart: '2026-10-21' }] }
    expect(buildCommit(dated, '2026-10-21')).toEqual({ ok: false, errors: ['Two weeks share week 9. Change one week number.'] })
  })
  it('explicit week dates snap to Monday', () => {
    expect(weekStartFor({ week: 5, weekStart: '2026-11-04', theme: 't', itemsDue: [] }, '2026-10-21')).toBe('2026-11-02')
    expect(weekStartFor({ week: 1, weekStart: null, theme: 't', itemsDue: [] }, '2026-10-25')).toBe('2026-10-19')
  })
})

describe('misc', () => {
  it('step gates', () => {
    expect(canLeaveStep('mode', initialDraft())).toBe(false)
    expect(canLeaveStep('basics', ready())).toBe(true)
    expect(canLeaveStep('roster', initialDraft())).toBe(true)
  })
  it('cell issues', () => {
    expect(studentIssues(st('A', { age: 1, guardianEmail: 'bad' }))).toEqual(['email', 'age'])
    expect(studentIssues(st('A'))).toEqual([])
  })
  it('error text', () => {
    expect(onboardingErrorText(new ApiError(413, 'image too large'), 'read')).toContain('too large')
    expect(onboardingErrorText(new ApiError(429, 'ai_budget_reached'), 'read')).toContain('AI limit')
    expect(onboardingErrorText(new ApiError(429, 'slow down'), 'read')).toContain('Wait a moment')
    expect(onboardingErrorText(new ApiError(400, 'unknown classes: X'), 'save')).toBe('Couldn’t save: unknown classes: X.')
    expect(onboardingErrorText(new NetworkError('x'), 'save')).toContain('connection')
  })
  it('fitWithin keeps aspect ratio', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 })
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 })
  })
  it('restoreDraft tolerates junk', () => {
    expect(restoreDraft('{bad').mode).toBeNull()
    expect(restoreDraft(JSON.stringify({ classes: 1 })).classes).toEqual([])
    expect(restoreDraft(JSON.stringify(ready())).basics.schoolName).toBe('Tiger Dojo')
  })
})
