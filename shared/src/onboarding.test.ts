import { describe, expect, it } from 'vitest'
import { ExtractRequest, OnboardingCommit, isTimeZone } from './onboarding'

const commit = {
  mode: 'martial_arts',
  basics: { schoolName: 'Tiger Dojo', coachName: 'Coach Ana', timeZone: 'America/Los_Angeles' },
  classes: [{ name: 'Kids Tue', weekday: 2, startTime: '17:00', mode: 'martial_arts' }],
  students: [{ name: 'Priya Rao', nickname: null, level: 'yellow', age: 8, guardianName: null, guardianEmail: null, classNames: ['Kids Tue'] }],
  curriculum: [{ weekStart: '2026-10-19', theme: 'Stances', itemsDue: ['Kata 1'] }],
}

describe('onboarding contracts', () => {
  it('needs text or an image', () => {
    expect(ExtractRequest.safeParse({ step: 'roster' }).success).toBe(false)
    expect(ExtractRequest.safeParse({ step: 'roster', text: '   ' }).success).toBe(false)
    expect(ExtractRequest.safeParse({ step: 'roster', text: 'Priya, Leo' }).success).toBe(true)
    expect(ExtractRequest.safeParse({ step: 'roster', imageBase64: 'iVBORw0KGgoAAAANSUhEUg==', mimeType: 'image/png' }).success).toBe(true)
  })
  it('rejects non-base64 images and unknown steps', () => {
    expect(ExtractRequest.safeParse({ step: 'roster', imageBase64: 'not base64 at all!!' }).success).toBe(false)
    expect(ExtractRequest.safeParse({ step: 'basics', text: 'x' }).success).toBe(false)
  })
  it('validates a commit: times, emails, time zone', () => {
    expect(OnboardingCommit.safeParse(commit).success).toBe(true)
    expect(OnboardingCommit.safeParse({ ...commit, classes: [{ ...commit.classes[0], startTime: '5pm' }] }).success).toBe(false)
    expect(OnboardingCommit.safeParse({ ...commit, students: [{ ...commit.students[0], guardianEmail: 'nope' }] }).success).toBe(false)
    expect(OnboardingCommit.safeParse({ ...commit, basics: { ...commit.basics, timeZone: 'Mars/Base' } }).success).toBe(false)
    expect(OnboardingCommit.safeParse({ ...commit, classes: [] }).success).toBe(false)
  })
  it('knows IANA time zones', () => {
    expect(isTimeZone('America/New_York')).toBe(true)
    expect(isTimeZone('Nowhere/Land')).toBe(false)
  })
})
