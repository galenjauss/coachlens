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
    UtteranceResponse.parse({ utteranceId: 'u1', transcript: 't', cardLines: ['✓ Priya · guard'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null })
  })

  it('discriminates review items by kind', () => {
    const item = ReviewItem.parse({ kind: 'billing', id: 'b1', studentName: 'Leo', urgency: 'high', note: 'gear', amount: null, createdAt: '2026-10-17T00:00:00Z' })
    expect(item.kind).toBe('billing')
  })
})
