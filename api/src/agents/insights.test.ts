import { describe, it, expect } from 'vitest'
import {
  attendanceDecline, billingRepeat, dedupeKey, detectAll, gradeDrop, isoWeek, issueResolved, liveNoFeedback, newPr, noFeedback,
  readyToTest, returningStudent, runSummary, type AttendanceRec, type DetectCtx, type StudentFacts,
} from './insights'
import { addDays } from '../logic/dates'

const TODAY = '2026-10-19' // Monday
const NOW = new Date('2026-10-20T00:30:00Z')
const ctx: DetectCtx = { today: TODAY, now: NOW, sessionId: null }
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)

const facts = (o: Partial<StudentFacts> = {}): StudentFacts => ({
  id: 'st1', name: 'Jake Ross', classId: 'c1', mode: 'martial_arts', belt: 'yellow', rankSince: null,
  attendance: [], notes: [], openIssues: [], metrics: [], openBilling: [], ...o,
})
/** Oldest first; the last status is `lastDate` (default today), earlier ones a week apart. */
const att = (statuses: string, lastDate = TODAY, ended = true): AttendanceRec[] =>
  [...statuses].map((c, i, all) => ({ sessionId: `s${i}`, forDate: addDays(lastDate, -7 * (all.length - 1 - i)), status: c === 'P' ? 'present' : 'absent', ended }))

describe('isoWeek + dedupe key', () => {
  it('computes ISO-8601 weeks across year edges', () => {
    expect(isoWeek('2026-10-19')).toBe('2026-W43')
    expect(isoWeek('2026-10-25')).toBe('2026-W43') // Sunday stays in the same week
    expect(isoWeek('2024-12-30')).toBe('2025-W01')
    expect(isoWeek('2021-01-03')).toBe('2020-W53')
  })
  it('is kind + student + ISO week, so the same finding never repeats within a week', () => {
    expect(dedupeKey('attendance_decline', 'st1', TODAY)).toBe('attendance_decline:st1:2026-W43')
    expect(attendanceDecline(facts({ attendance: att('PAA') }), ctx)!.dedupeKey).toBe(attendanceDecline(facts({ attendance: att('PAA') }), { ...ctx, today: '2026-10-23' })!.dedupeKey)
    expect(attendanceDecline(facts({ attendance: att('PAA') }), { ...ctx, today: '2026-10-26' })!.dedupeKey).toBe('attendance_decline:st1:2026-W44')
  })
})

describe('attendance_decline', () => {
  it('fires when absent in ≥2 of the last 3 sessions', () => {
    const d = attendanceDecline(facts({ attendance: att('PPAA') }), ctx)!
    expect(d).toMatchObject({ kind: 'attendance_decline', urgency: 'low', title: 'Jake missed 2 of last 3 classes', action: { type: 'draft_email', purpose: 'check_in', label: 'Draft check-in email' } })
    expect(attendanceDecline(facts({ attendance: att('APA') }), ctx)).not.toBeNull()
    expect(attendanceDecline(facts({ attendance: att('AAPP') }), ctx)).toBeNull() // only 1 of the last 3
    expect(attendanceDecline(facts({ attendance: att('A') }), ctx)).toBeNull()
  })
  it('fires when the last-4-weeks rate is below half the prior 4 weeks (strictly)', () => {
    // two sessions a week; prior window all present, recent window 2 of 5 present (last 3 has only one absence)
    const prior = [31, 35, 42, 49].map((n, i) => ({ sessionId: `p${i}`, forDate: addDays(TODAY, -n), status: 'present' as const, ended: true }))
    const recent = (s: string) => [...s].map((c, i, all) => ({ sessionId: `r${i}`, forDate: addDays(TODAY, -3 * (all.length - 1 - i)), status: c === 'P' ? 'present' as const : 'absent' as const, ended: true }))
    const old = [...prior].sort((a, b) => a.forDate.localeCompare(b.forDate))
    const d = attendanceDecline(facts({ attendance: [...old, ...recent('AAAPP')] }), ctx)!
    expect(d.title).toBe("Jake's attendance has dropped")
    expect(d.detail).toContain('2 of 5 classes in the last 4 weeks vs 4 of 4')
    expect(attendanceDecline(facts({ attendance: [...old, ...recent('AAPP')] }), ctx)).toBeNull() // exactly half: no
  })
  it('a session exactly 28 days ago belongs to the prior window', () => {
    const rows: AttendanceRec[] = [
      { sessionId: 'a', forDate: addDays(TODAY, -28), status: 'present', ended: true },
      { sessionId: 'b', forDate: addDays(TODAY, -20), status: 'absent', ended: true },
      { sessionId: 'c', forDate: addDays(TODAY, -10), status: 'present', ended: true },
      { sessionId: 'd', forDate: addDays(TODAY, -5), status: 'absent', ended: true },
      { sessionId: 'e', forDate: TODAY, status: 'present', ended: true },
    ]
    // last 3 = P A P (1 absent); recent = 2/4 = .5 vs prior 1/1: .5 is not < .5
    expect(attendanceDecline(facts({ attendance: rows }), ctx)).toBeNull()
  })
})

describe('returning_student', () => {
  it('fires high when present today after ≥2 consecutive absences', () => {
    const d = returningStudent(facts({ attendance: att('PAAAP') }), ctx)!
    expect(d).toMatchObject({ kind: 'returning_student', urgency: 'high', title: "Jake's back after 3 missed", action: { type: 'draft_email', purpose: 'welcome_back', label: 'Draft welcome email' } })
    expect(d.detail).toBe('Missed 3 classes in a row before today · welcome Jake back.')
    expect(returningStudent(facts({ attendance: att('AAP') }), ctx)!.title).toBe("Jake's back after 2 missed")
  })
  it('boundaries: one absence, absent today, or no session today', () => {
    expect(returningStudent(facts({ attendance: att('PAP') }), ctx)).toBeNull()
    expect(returningStudent(facts({ attendance: att('AAA') }), ctx)).toBeNull()
    expect(returningStudent(facts({ attendance: att('AAP', addDays(TODAY, -1)) }), ctx)).toBeNull()
  })
  it('matches the live session even when its date differs from today', () => {
    const rows = att('AAP', addDays(TODAY, -1))
    expect(returningStudent(facts({ attendance: rows }), { ...ctx, sessionId: 's2' })).not.toBeNull()
  })
})

describe('no_feedback', () => {
  it('fires when present in the last 3 finished sessions with zero notes', () => {
    const d = noFeedback(facts({ attendance: att('PPP') }), ctx)!
    expect(d).toMatchObject({ kind: 'no_feedback', urgency: 'low', title: 'No notes on Jake in 3 classes', action: { type: 'plan_focus', classId: 'c1', studentId: 'st1', label: 'Put first next time' } })
    expect(d.action.type === 'plan_focus' && d.action.text).toContain('Jake Ross [st1]')
  })
  it('a note in any of them, an absence, too few sessions or an unfinished session: no', () => {
    expect(noFeedback(facts({ attendance: att('PPP'), notes: [{ sessionId: 's1', tags: [], createdAt: daysAgo(7) }] }), ctx)).toBeNull()
    expect(noFeedback(facts({ attendance: att('PAP') }), ctx)).toBeNull()
    expect(noFeedback(facts({ attendance: att('PP') }), ctx)).toBeNull()
    const live = [...att('PP', addDays(TODAY, -7)), { sessionId: 'now', forDate: TODAY, status: 'present' as const, ended: false }]
    expect(noFeedback(facts({ attendance: live }), ctx)).toBeNull()
  })
  it('uses the mode word', () => {
    expect(noFeedback(facts({ mode: 'tutoring', attendance: att('PPP') }), ctx)!.title).toBe('No notes on Jake in 3 lessons')
  })
})

describe('liveNoFeedback (high, in class)', () => {
  const snap = (elapsed: number) => ({
    sessionId: 'live', today: TODAY, elapsed, notedIds: new Set(['st2']),
    present: [{ id: 'st1', name: 'Jake Ross', classId: 'c1', mode: 'martial_arts' as const }, { id: 'st2', name: 'Maria Lopez', classId: 'c1', mode: 'martial_arts' as const }],
  })
  it('only once 70% of class time has passed, for present students with no note', () => {
    expect(liveNoFeedback(snap(0.69))).toEqual([])
    const out = liveNoFeedback(snap(0.7))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'no_feedback', urgency: 'high', studentId: 'st1', title: 'Jake: no note yet today', action: { type: 'none', label: null }, dedupeKey: 'no_feedback_high:st1:2026-W43' })
    expect(out[0]!.detail).toContain('70% done')
  })
})

describe('ready_to_test (martial arts only)', () => {
  it('fires at ≥90 days in rank with no open issues', () => {
    const d = readyToTest(facts({ rankSince: addDays(TODAY, -90) }), ctx)!
    expect(d).toMatchObject({ kind: 'ready_to_test', title: 'Jake may be ready to test', action: { type: 'draft_email', purpose: 'ready_to_test' } })
    expect(d.detail).toContain('yellow belt')
    expect(readyToTest(facts({ rankSince: addDays(TODAY, -89) }), ctx)).toBeNull()
  })
  it('open issue, no rank date, or another mode: no', () => {
    expect(readyToTest(facts({ rankSince: '2026-01-01', openIssues: [{ id: 'i', tag: 'guard', openedAt: daysAgo(3) }] }), ctx)).toBeNull()
    expect(readyToTest(facts({ rankSince: null }), ctx)).toBeNull()
    expect(readyToTest(facts({ rankSince: '2026-01-01', mode: 'tutoring' }), ctx)).toBeNull()
    expect(readyToTest(facts({ rankSince: '2026-01-01', mode: 'personal_training' }), ctx)).toBeNull()
  })
})

describe('new_pr (personal training only)', () => {
  const m = (num: number, ago: number, unit = 'lb', key = 'deadlift') => ({ key, value: `${num} ${unit}`, num, unit, recordedAt: daysAgo(ago) })
  it('fires for a personal best in the last 7 days', () => {
    const d = newPr(facts({ mode: 'personal_training', name: 'Maria Lopez', metrics: [m(200, 30), m(215, 14), m(225, 3)] }), ctx)!
    expect(d).toMatchObject({ kind: 'new_pr', title: 'Maria hit a PR: deadlift 225 lb', action: { type: 'draft_email', purpose: 'praise', label: 'Draft praise email' } })
    expect(d.detail).toContain('(+10)')
  })
  it('older than 7 days, not a best, first reading, other unit, or another mode: no', () => {
    expect(newPr(facts({ mode: 'personal_training', metrics: [m(200, 30), m(225, 8)] }), ctx)).toBeNull()
    expect(newPr(facts({ mode: 'personal_training', metrics: [m(230, 30), m(225, 2)] }), ctx)).toBeNull()
    expect(newPr(facts({ mode: 'personal_training', metrics: [m(225, 2)] }), ctx)).toBeNull()
    expect(newPr(facts({ mode: 'personal_training', metrics: [m(200, 30, 'lb'), m(110, 2, 'kg')] }), ctx)).toBeNull()
    expect(newPr(facts({ mode: 'martial_arts', metrics: [m(200, 30), m(225, 3)] }), ctx)).toBeNull()
  })
})

describe('grade_drop (tutoring only)', () => {
  const t = (num: number, ago: number, key = 'algebra_test') => ({ key, value: `${num}%`, num, unit: '%', recordedAt: daysAgo(ago) })
  it('fires when the latest test is ≥10 points below the previous', () => {
    const d = gradeDrop(facts({ mode: 'tutoring', name: 'Ava Kim', metrics: [t(92, 20), t(82, 2)] }), ctx)!
    expect(d).toMatchObject({ kind: 'grade_drop', title: "Ava's algebra test down 10 pts", action: { type: 'plan_focus', classId: 'c1', label: 'Plan a review' } })
    expect(d.detail).toContain('82%')
    expect(d.detail).toContain('92%')
  })
  it('a 9-point drop, a rise, a lone test or another mode: no', () => {
    expect(gradeDrop(facts({ mode: 'tutoring', metrics: [t(92, 20), t(83, 2)] }), ctx)).toBeNull()
    expect(gradeDrop(facts({ mode: 'tutoring', metrics: [t(70, 20), t(90, 2)] }), ctx)).toBeNull()
    expect(gradeDrop(facts({ mode: 'tutoring', metrics: [t(70, 2)] }), ctx)).toBeNull()
    expect(gradeDrop(facts({ mode: 'personal_training', metrics: [t(92, 20), t(70, 2)] }), ctx)).toBeNull()
    expect(gradeDrop(facts({ mode: 'martial_arts', metrics: [t(92, 20), t(70, 2)] }), ctx)).toBeNull()
  })
  it('compares the latest test with the previous of the same key', () => {
    expect(gradeDrop(facts({ mode: 'tutoring', metrics: [t(80, 30, 'geometry'), t(95, 20), t(85, 2, 'geometry')] }), ctx)).toBeNull()
  })
})

describe('issue_resolved', () => {
  const issue = { id: 'iss1', tag: 'guard', openedAt: daysAgo(40) }
  it('fires when the tag has had no new notes for 21 days', () => {
    const d = issueResolved(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(21) }] }), ctx)!
    expect(d).toMatchObject({ kind: 'issue_resolved', title: "Jake's guard looks resolved", action: { type: 'resolve_issue', issueId: 'iss1', studentId: 'st1', notify: true, label: 'Resolve + praise' } })
    expect(d.detail).toContain('guard drops')
  })
  it('a recent note on the tag, or a recently opened issue: no; other tags do not count', () => {
    expect(issueResolved(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(20) }] }), ctx)).toBeNull()
    expect(issueResolved(facts({ openIssues: [{ ...issue, openedAt: daysAgo(10) }] }), ctx)).toBeNull()
    expect(issueResolved(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['kicks'], createdAt: daysAgo(1) }] }), ctx)).not.toBeNull()
  })
})

describe('billing_repeat', () => {
  it('fires at ≥2 open billing flags, no action button', () => {
    const b = (note: string) => ({ note, createdAt: daysAgo(2) })
    const d = billingRepeat(facts({ openBilling: [b('owes October'), b('needs new gloves')] }), ctx)!
    expect(d).toMatchObject({ kind: 'billing_repeat', title: 'Jake has 2 open billing flags', action: { type: 'none', label: null } })
    expect(d.detail).toContain('needs new gloves')
    expect(billingRepeat(facts({ openBilling: [b('owes October')] }), ctx)).toBeNull()
  })
})

describe('detectAll + limits + summary', () => {
  it('runs only the chosen detectors', () => {
    const s = facts({ attendance: att('PAAP') })
    expect(detectAll([s], ctx).map(d => d.kind).sort()).toEqual(['attendance_decline', 'returning_student'])
    expect(detectAll([s], ctx, ['returning_student']).map(d => d.kind)).toEqual(['returning_student'])
  })
  it('keeps titles ≤60 and details ≤160 even with long names', () => {
    const long = facts({ name: 'Bartholomew-Maximilian Featherstonehaugh-Worthington', attendance: att('PAAP'), openBilling: [{ note: 'x'.repeat(300), createdAt: NOW }, { note: 'y '.repeat(200), createdAt: NOW }] })
    for (const d of detectAll([long], ctx)) {
      expect(d.title.length).toBeLessThanOrEqual(60)
      expect(d.detail.length).toBeLessThanOrEqual(160)
    }
  })
  it('summarizes a run', () => {
    expect(runSummary([])).toBe('No new insights')
    expect(runSummary([{ kind: 'attendance_decline', studentName: 'Jake Ross' }, { kind: 'ready_to_test', studentName: 'Maria Lopez' }])).toBe('2 new: Jake attendance, Maria ready to test')
  })
})
