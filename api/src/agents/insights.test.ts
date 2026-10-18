import { describe, it, expect } from 'vitest'
import {
  attendanceDecline, billingRepeat, dedupeKey, detectAll, gradeDrop, isoWeek, issueImproving, issueReassess, liveNoFeedback, newPr, noFeedback,
  rankReview, returningStudent, runSummary, DEFAULT_RANK_REVIEW, type AttendanceRec, type DetectCtx, type StudentFacts,
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

describe('liveNoFeedback (F11: one restrained reminder per class)', () => {
  const kid = (id: string, name: string) => ({ id, name, classId: 'c1', mode: 'martial_arts' as const })
  const snap = (elapsed: number, noted = ['st2']) => ({
    sessionId: 'live', today: TODAY, elapsed, notedIds: new Set(noted),
    present: [kid('st1', 'Jake Ross'), kid('st2', 'Maria Lopez'), kid('st3', 'Leo Diaz'), kid('st4', 'Ava Kim')],
  })
  it('only once 70% of class time has passed; one class-level item naming who has no observation yet', () => {
    expect(liveNoFeedback(snap(0.69))).toEqual([])
    const out = liveNoFeedback(snap(0.7))
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ kind: 'no_feedback', studentId: null, classId: 'c1', title: '3 students have no observation yet', action: { type: 'none', label: null }, dedupeKey: 'no_feedback_live:live' })
    expect(out[0]!.detail).toBe('Not noted yet: Jake, Leo, Ava · class 70% done.')
    expect(out[0]!.title).not.toMatch(/feedback/i)
  })
  it('one missing student reads singular; everyone noted gives nothing', () => {
    expect(liveNoFeedback(snap(0.8, ['st2', 'st3', 'st4']))[0]!.title).toBe('1 student has no observation yet')
    expect(liveNoFeedback(snap(0.8, ['st1', 'st2', 'st3', 'st4']))).toEqual([])
  })
  it('uses the mode word', () => {
    const pt = { ...snap(0.9), present: [{ id: 'm', name: 'Maria Lopez', classId: 'c2', mode: 'personal_training' as const }], notedIds: new Set<string>() }
    expect(liveNoFeedback(pt)[0]!.title).toBe('1 client has no observation yet')
  })
})

describe('rank_review (F10: a review reminder with evidence, martial arts only)', () => {
  it('fires at the default thresholds (≥90 days at rank, no open issues) and shows present and missing evidence', () => {
    const d = rankReview(facts({ name: 'Gus Hill', belt: 'green', rankSince: addDays(TODAY, -120), attendance: att('PPPP'), notes: [{ sessionId: 's1', tags: ['kicks'], createdAt: daysAgo(3), valence: 'positive', text: 'sharp kicks' }] }), ctx)!
    expect(d).toMatchObject({ kind: 'rank_review', urgency: 'low', title: 'Gus: review for next rank', action: { type: 'none', label: null } })
    expect(d.detail).toBe('Have: 4 mo at green, 4/4 classes in 8 wk, 0 open issues, 1 positive note. Not tracked: curriculum, your assessment.')
    expect(d.title + d.detail).not.toMatch(/ready/i)
    expect(rankReview(facts({ rankSince: addDays(TODAY, -89) }), ctx)).toBeNull()
  })
  it('open issue, no rank date, or another mode: no (with the default settings)', () => {
    expect(rankReview(facts({ rankSince: '2026-01-01', openIssues: [{ id: 'i', tag: 'guard', openedAt: daysAgo(3) }] }), ctx)).toBeNull()
    expect(rankReview(facts({ rankSince: null }), ctx)).toBeNull()
    expect(rankReview(facts({ rankSince: '2026-01-01', mode: 'tutoring' }), ctx)).toBeNull()
    expect(rankReview(facts({ rankSince: '2026-01-01', mode: 'personal_training' }), ctx)).toBeNull()
  })
  it('school settings change the thresholds: days at rank, minimum attendance in the window, open issues allowed', () => {
    const s = facts({ rankSince: addDays(TODAY, -60), attendance: att('PPAP'), openIssues: [{ id: 'i', tag: 'guard', openedAt: daysAgo(3) }] })
    expect(rankReview(s, ctx)).toBeNull()
    const loose = { ...ctx, rankReview: { ...DEFAULT_RANK_REVIEW, minDaysAtRank: 60, requireNoOpenIssues: false } }
    expect(rankReview(s, loose)!.detail).toContain('3/4 classes in 8 wk, 1 open issue,')
    expect(rankReview(s, { ...loose, rankReview: { ...loose.rankReview, minAttendance: 4 } })).toBeNull()
    expect(rankReview(s, { ...loose, rankReview: { ...loose.rankReview, attendanceWindowDays: 14 } })!.detail).toContain('2/3 classes in 2 wk')
    expect(DEFAULT_RANK_REVIEW).toEqual({ minDaysAtRank: 90, minAttendance: 0, attendanceWindowDays: 56, requireNoOpenIssues: true })
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

describe('issue_reassess (F09: silence is a prompt to check, never a resolution)', () => {
  const issue = { id: 'iss1', tag: 'guard', openedAt: daysAgo(40) }
  it('fires when the tag has had no notes for 21 days; asks for a check-in, never resolves or praises', () => {
    const d = issueReassess(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(21), valence: 'concern', text: 'guard low' }] }), ctx)!
    expect(d).toMatchObject({ kind: 'issue_reassess', urgency: 'low', title: "Jake's guard: no recent notes", action: { type: 'plan_focus', classId: 'c1', studentId: 'st1', label: 'Check next class' } })
    expect(d.detail).toBe('No guard drops notes in 21+ days. No notes is not evidence it improved: check it next class.')
    expect(d.title + d.detail).not.toMatch(/resolved|praise/i)
    expect(d.action.type === 'plan_focus' && d.action.text).toContain('re-check')
  })
  it('a recent note on the tag, or a recently opened issue: no; other tags do not count', () => {
    expect(issueReassess(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(20) }] }), ctx)).toBeNull()
    expect(issueReassess(facts({ openIssues: [{ ...issue, openedAt: daysAgo(10) }] }), ctx)).toBeNull()
    expect(issueReassess(facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['kicks'], createdAt: daysAgo(1) }] }), ctx)).not.toBeNull()
  })
  it('positive evidence since the issue opened is reported as improving instead', () => {
    const s = facts({ openIssues: [issue], notes: [{ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(30), valence: 'positive', text: 'kept his guard up' }] })
    expect(issueReassess(s, ctx)).toBeNull()
    expect(issueImproving(s, ctx)).not.toBeNull()
  })
})

describe('issue_improving (F01/F09: resolution needs positive evidence and the instructor)', () => {
  const issue = { id: 'iss1', tag: 'guard', openedAt: daysAgo(10) }
  it('praise or improvement on the tag since the issue opened suggests resolving, on explicit accept only', () => {
    const d = issueImproving(facts({ openIssues: [issue], notes: [
      { sessionId: 'x', tags: ['guard'], createdAt: daysAgo(12), valence: 'positive', text: 'before the issue' },
      { sessionId: 'x', tags: ['guard'], createdAt: daysAgo(5), valence: 'improving', text: 'guard getting better' },
      { sessionId: 'x', tags: ['guard'], createdAt: daysAgo(2), valence: 'positive', text: 'kept his guard up all class' },
    ] }), ctx)!
    expect(d).toMatchObject({ kind: 'issue_improving', title: "Jake's guard: improving", action: { type: 'resolve_issue', issueId: 'iss1', studentId: 'st1', notify: false, label: 'Mark resolved' } })
    expect(d.detail).toContain('2 positive guard notes since')
    expect(d.detail).toContain('"kept his guard up all class"')
  })
  it('concerns, historical praise or praise before the issue opened: no', () => {
    const n = (valence: 'concern' | 'positive', ago: number, historical = false) => ({ sessionId: 'x', tags: ['guard'], createdAt: daysAgo(ago), valence, text: 't', historical })
    expect(issueImproving(facts({ openIssues: [issue], notes: [n('concern', 2)] }), ctx)).toBeNull()
    expect(issueImproving(facts({ openIssues: [issue], notes: [n('positive', 2, true)] }), ctx)).toBeNull()
    expect(issueImproving(facts({ openIssues: [issue], notes: [n('positive', 12)] }), ctx)).toBeNull()
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
    expect(runSummary([{ kind: 'attendance_decline', studentName: 'Jake Ross' }, { kind: 'rank_review', studentName: 'Maria Lopez' }])).toBe('2 new: Jake attendance, Maria rank review')
    expect(runSummary([{ kind: 'no_feedback', studentName: null }])).toBe('1 new: no observations')
  })
})
