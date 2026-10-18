import { describe, expect, it } from 'vitest'
import type { FailedItem, OutboxItem } from '../core/outbox'
import { storageWarning, unsentRows, unsentSummary } from './outboxLogic'
import { classPayload, classUpdatePayload, studentCreatePayload, studentUpdatePayload, WEEKDAYS } from './rosterLogic'
import { filterCandidates, urgentFirst } from './reviewLogic'
import { classInsightsQuery } from './insightsLogic'
import { parseStatus } from './settingsLogic'

const form = { sessionId: 's', drillId: null, mode: 'note' as const, audioB64: null, text: 'Priya kept her guard up' }
const queued = (o: Partial<OutboxItem> = {}): OutboxItem => ({ id: 'q1', createdAt: Date.parse('2026-10-18T17:05:00'), attempts: 2, form, lastError: 'rate_limited', ...o })
const failed = (o: Partial<FailedItem> = {}): FailedItem => ({ ...queued({ id: 'f1' }), failedAt: 0, failure: { status: 413, code: 'too_large', reason: 'Recording too large to send' }, ...o })

describe('F07 · Unsent notes panel rows', () => {
  it('queued rows show the true retry reason; failed rows show the rejection reason and allow Retry/Discard', () => {
    const rows = unsentRows([queued()], [failed()])
    expect(rows).toEqual([
      expect.objectContaining({ id: 'q1', kind: 'queued', preview: '“Priya kept her guard up”', reason: 'Server busy · retrying', canDiscard: false }),
      expect.objectContaining({ id: 'f1', kind: 'failed', reason: 'Recording too large to send', canRetry: true, canDiscard: true }),
    ])
    expect(rows.every(r => !/catch/i.test(r.reason))).toBe(true)
  })
  it('a voice note without text says so; roll call is labelled', () => {
    const [r] = unsentRows([queued({ form: { ...form, text: null, audioB64: 'AAAA' } })], [])
    expect(r!.preview).toBe('Voice note')
    const [a] = unsentRows([queued({ form: { ...form, mode: 'attendance' } })], [])
    expect(a!.preview).toMatch(/^Roll call/)
  })
  it('summary counts both stores', () => {
    expect(unsentSummary(0, 0)).toBeNull()
    expect(unsentSummary(2, 0)).toBe('2 notes waiting to send')
    expect(unsentSummary(1, 1)).toBe('1 note waiting to send · 1 not sent')
    expect(unsentSummary(0, 3)).toBe('3 notes not sent')
  })
})

describe('F23 · student and class forms', () => {
  it('create: needs a name and at least one class; guardians need a name and a valid email', () => {
    expect(studentCreatePayload({ name: ' ', nickname: '', belt: '', classIds: ['c1'], guardians: [] })).toEqual({ ok: false, error: 'Name is required.' })
    expect(studentCreatePayload({ name: 'Ava', nickname: '', belt: '', classIds: [], guardians: [] })).toEqual({ ok: false, error: 'Pick at least one class.' })
    expect(studentCreatePayload({ name: 'Ava', nickname: '', belt: '', classIds: ['c1'], guardians: [{ name: 'Cruz', email: 'nope' }] })).toEqual({ ok: false, error: 'Guardian 1: enter a valid email.' })
    expect(studentCreatePayload({ name: ' Ava Cruz ', nickname: '', belt: 'white', classIds: ['c1'], guardians: [{ name: 'Cruz family', email: ' p@example.com ' }, { name: '', email: '' }] }))
      .toEqual({ ok: true, value: { name: 'Ava Cruz', belt: 'white', classIds: ['c1'], guardians: [{ name: 'Cruz family', email: 'p@example.com' }] } })
  })
  it('update sends only what changed; guardians are sent (replace) only when edited, so an unknown list is never wiped', () => {
    const before = { name: 'Ava Cruz', nickname: '', belt: 'white', classIds: ['c1'], guardians: [{ name: 'Cruz family', email: 'p@example.com' }] }
    expect(studentUpdatePayload(before, before, { guardiansTouched: false })).toEqual({ ok: true, value: {} })
    expect(studentUpdatePayload(before, { ...before, name: 'Ava M. Cruz', classIds: ['c1', 'c2'] }, { guardiansTouched: false }))
      .toEqual({ ok: true, value: { name: 'Ava M. Cruz', classIds: ['c1', 'c2'] } })
    expect(studentUpdatePayload(before, { ...before, guardians: [] }, { guardiansTouched: true })).toEqual({ ok: true, value: { guardians: [] } })
    expect(studentUpdatePayload(before, { ...before, nickname: 'Avi' }, { guardiansTouched: false })).toEqual({ ok: true, value: { nickname: 'Avi' } })
  })
  it('class form: name, HH:MM start, weekday 0-6, a mode', () => {
    expect(WEEKDAYS[0]).toBe('Sunday')
    expect(classPayload({ name: 'Teens', mode: 'martial_arts', startTime: '18:00', weekday: 3 })).toEqual({ ok: true, value: { name: 'Teens', mode: 'martial_arts', startTime: '18:00', weekday: 3 } })
    expect(classPayload({ name: '', mode: 'martial_arts', startTime: '18:00', weekday: 3 })).toEqual({ ok: false, error: 'Class name is required.' })
    expect(classPayload({ name: 'Teens', mode: 'martial_arts', startTime: '6pm', weekday: 3 })).toEqual({ ok: false, error: 'Start time must look like 18:00.' })
  })
})

describe('F16 / F17 · review', () => {
  it('urgent items first, order otherwise kept', () => {
    const items = [{ id: 'a' }, { id: 'b', urgent: true }, { id: 'c', urgent: false }, { id: 'd', urgent: true }]
    expect(urgentFirst(items).map(i => i.id)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('candidate search matches name, nickname and aliases, case-insensitively', () => {
    const students = [
      { id: '1', name: 'Sam Lee', nickname: null, aliases: [] },
      { id: '2', name: 'Samantha Ortiz', nickname: 'Sammy', aliases: [] },
      { id: '3', name: 'Ava Cruz', nickname: null, aliases: ['Eva'] },
    ]
    expect(filterCandidates(students, '').map(s => s.id)).toEqual(['1', '2', '3'])
    expect(filterCandidates(students, 'sam').map(s => s.id)).toEqual(['1', '2'])
    expect(filterCandidates(students, 'eva').map(s => s.id)).toEqual(['3'])
    expect(filterCandidates(students, 'SAMMY').map(s => s.id)).toEqual(['2'])
  })
})

describe('F15 · Today insights are scoped to the selected class', () => {
  it('class scope with the class id; all-classes only when no class is known yet', () => {
    expect(classInsightsQuery('c1')).toEqual({ scope: 'class', classId: 'c1' })
    expect(classInsightsQuery(null)).toEqual({ scope: 'all' })
  })
})

describe('C5 · status line for the phone', () => {
  it('names degraded states plainly', () => {
    const base = { aiCallsToday: 12, aiDailyCap: 200, sttConfigured: true, mailMode: 'review' as const, degraded: false, degradedReasons: [], aiCallsRemaining: 188, aiCallsCounted: 'anthropic' as const, day: '2026-10-18' }
    expect(parseStatus(base)).toEqual({ ok: true, lines: ['AI calls today: 12 of 200'] })
    expect(parseStatus({ ...base, sttConfigured: false, degraded: true, degradedReasons: ['speech_to_text_unconfigured' as const] }).lines).toContain('Speech-to-text is not set up on the server: voice notes wait in the queue')
    expect(parseStatus({ ...base, aiCallsToday: 200, aiCallsRemaining: 0, degraded: true, degradedReasons: ['ai_budget_reached' as const] }))
      .toEqual({ ok: false, lines: ['AI calls today: 200 of 200', 'Daily AI limit reached: notes still save, sorting resumes tomorrow'] })
  })
})

describe('review round 1 · #3 editing a class never moves it', () => {
  const row = { name: 'Teens', mode: 'martial_arts' as const, startTime: '18:00', weekday: 3 }
  it('sends only what changed', () => {
    expect(classUpdatePayload(row, { name: 'Teens', mode: 'martial_arts', startTime: '18:00', weekday: 3 })).toEqual({ ok: true, value: {} })
    expect(classUpdatePayload(row, { name: 'Teens A', mode: 'martial_arts', startTime: '18:00', weekday: 3 })).toEqual({ ok: true, value: { name: 'Teens A' } })
    expect(classUpdatePayload(row, { name: 'Teens', mode: 'martial_arts', startTime: '18:30', weekday: 4 })).toEqual({ ok: true, value: { startTime: '18:30', weekday: 4 } })
  })
  it('an unknown weekday / start time (older server) stays unset: never defaulted to Monday or 17:00', () => {
    const bare = { name: 'Teens', mode: 'martial_arts' as const }
    expect(classUpdatePayload(bare, { name: 'Teens 2', mode: 'martial_arts', startTime: '', weekday: null })).toEqual({ ok: true, value: { name: 'Teens 2' } })
    expect(classUpdatePayload(bare, { name: 'Teens', mode: 'martial_arts', startTime: '', weekday: 5 })).toEqual({ ok: true, value: { weekday: 5 } })
    expect(classUpdatePayload(bare, { name: 'Teens', mode: 'martial_arts', startTime: '7pm', weekday: null })).toEqual({ ok: false, error: 'Start time must look like 18:00.' })
  })
})

describe('review round 1 · #1 storage warning on the phone', () => {
  it('nothing under 70%, a warning from 70%, refusal wording at 100%', () => {
    expect(storageWarning(0.5)).toBeNull()
    expect(storageWarning(0.72)).toBe('Unsent notes are 72% full. Send or discard some soon.')
    expect(storageWarning(1)).toMatch(/full: new voice notes can’t be saved/)
  })
})
