import { describe, expect, it } from 'vitest'
import { ApiError, NetworkError } from '../core/api'
import { approveAllNotice, bulkEmailIds, cap, outcomeFor, studentOutcome, visibleEmailIds } from './reviewLogic'

describe('outcomeFor', () => {
  it('treats 404 and 409 as already handled', () => {
    expect(outcomeFor(new ApiError(404, 'x')).kind).toBe('gone')
    expect(outcomeFor(new ApiError(409, 'x')).kind).toBe('gone')
  })
  it('keeps the item on 502', () => {
    const o = outcomeFor(new ApiError(502, 'x'))
    expect(o.kind).toBe('error'); expect(o.text).toMatch(/still here/)
  })
  it('handles network and unknown errors', () => {
    expect(outcomeFor(new NetworkError('x')).text).toMatch(/connection/)
    expect(outcomeFor(new Error('boom'), 'Send').text).toBe('Send failed. Try again.')
  })
})
describe('studentOutcome', () => {
  it('404 is not found', () => { expect(studentOutcome(new ApiError(404, 'x'))).toBe('Student not found.') })
})
describe('visibleEmailIds', () => {
  it('selects only parent_email and report_card ids', () => {
    expect(visibleEmailIds([{ id: 'a', kind: 'parent_email' }, { id: 'b', kind: 'billing' }, { id: 'c', kind: 'report_card' }, { id: 'd', kind: 'deck_diff' }])).toEqual(['a', 'c'])
    expect(visibleEmailIds(null)).toEqual([])
  })
})
describe('approveAllNotice / cap', () => {
  it('reports sent and failed', () => {
    expect(approveAllNotice({ sent: 3, failed: 0 })).toBe('Sent 3.')
    expect(approveAllNotice({ sent: 2, failed: 1 })).toMatch(/Sent 2, 1 failed/)
  })
  it('capitalizes', () => { expect(cap('clients')).toBe('Clients'); expect(cap('')).toBe('') })
})

describe('bulkEmailIds', () => {
  const items = [{ id: 'a', kind: 'parent_email' }, { id: 'b', kind: 'report_card' }, { id: 'c', kind: 'billing' }, { id: 'd', kind: 'parent_email' }]
  it('excludes edited or in-edit emails', () => {
    expect(bulkEmailIds(items, new Set(['b']))).toEqual(['a', 'd'])
  })
  it('returns all visible emails when none are edited', () => {
    expect(bulkEmailIds(items, new Set())).toEqual(['a', 'b', 'd'])
  })
  it('ignores dirty ids that are no longer visible', () => {
    expect(bulkEmailIds(items, new Set(['zzz']))).toEqual(['a', 'b', 'd'])
  })
})

describe('outcomeFor: delivered replies', () => {
  it('a BadResponseError (2xx, unreadable reply) is treated as done, never "try again"', async () => {
    const { BadResponseError } = await import('../core/api')
    const { outcomeFor: of } = await import('./reviewLogic')
    expect(of(new BadResponseError(), 'Approve')).toEqual({ kind: 'gone', text: 'Done — list refreshed.' })
  })
})
