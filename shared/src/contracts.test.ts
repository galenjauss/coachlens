import { describe, it, expect } from 'vitest'
import { Intent, RouterOutput, DeckDiff, UtteranceResponse, ReviewItem, routerOutputFor } from './contracts'

describe('contracts', () => {
  it('parses a router output with feedback + billing', () => {
    const out = RouterOutput.parse({
      intents: [
        { type: 'feedback', studentNames: ['Priya'], content: 'guard drops on the jab', skillTags: ['guard'], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false },
        { type: 'billing', studentNames: ['Leo'], content: 'owes for sparring gear', skillTags: [], urgency: 'high', amount: null, minutes: null, attendanceStatus: null, urgent: false },
      ],
    })
    expect(out.intents).toHaveLength(2)
  })

  it('rejects unknown skill tags', () => {
    const i = { type: 'feedback', studentNames: [], content: 'x', skillTags: ['karate'], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }
    expect(() => routerOutputFor('martial_arts').parse({ intents: [i] })).toThrow()
    expect(() => Intent.parse({ ...i, skillTags: [''] })).toThrow()
    const { urgent: _u, ...noUrgent } = { ...i, skillTags: ['guard'] }
    expect(() => Intent.parse(noUrgent)).toThrow()
    expect(() => Intent.parse({ ...i, skillTags: ['x'.repeat(25)] })).toThrow()
  })

  it('parses a deck diff and an utterance response', () => {
    DeckDiff.parse({ added: [], changed: [], removed: [{ drillId: 'd1', reason: 'too wild' }], rememberSuggestion: null })
    UtteranceResponse.parse({ utteranceId: 'u1', transcript: 't', cardLines: ['√ Priya · guard'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null })
  })

  it('discriminates review items by kind', () => {
    const item = ReviewItem.parse({ kind: 'billing', id: 'b1', studentName: 'Leo', urgency: 'high', note: 'gear', amount: null, createdAt: '2026-10-17T00:00:00Z' })
    expect(item.kind).toBe('billing')
  })
})

describe('student intelligence contracts', () => {
  const base = { studentNames: ['Maria'], content: 'x', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false }
  it('metric and student_query intents parse with or without the metric fields', async () => {
    const { Intent, routerOutputFor, Brief, StudentPatch } = await import('./contracts')
    expect(Intent.parse({ ...base, type: 'student_query' }).type).toBe('student_query')
    const m = Intent.parse({ ...base, type: 'metric', metricKey: 'deadlift', metricValue: '225 lb', metricNum: 225, metricUnit: 'lb', metricSince: null })
    expect(m.metricNum).toBe(225)
    expect(routerOutputFor('personal_training').parse({ intents: [{ ...base, type: 'metric', metricKey: 'deadlift' }] }).intents).toHaveLength(1)
    expect(Brief.safeParse({ name: 'A', lines: ['x'.repeat(39)] }).success).toBe(false)
    expect(Brief.safeParse({ name: 'A', lines: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false)
    expect(StudentPatch.safeParse({}).success).toBe(false)
    expect(StudentPatch.safeParse({ belt: 'green', rankSince: '2026-03-01' }).success).toBe(true)
  })
})
