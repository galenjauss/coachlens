import { describe, expect, it } from 'vitest'
import type { Insight } from '@matside/shared'
import { ApiError, NetworkError } from '../core/api'
import { AUTONOMY_COPY, autonomyOptions, taskLabel } from './agentsLogic'
import { acceptLabel, insightsMissing, openInsights, sortInsights, statusWord, todayRows } from './insightsLogic'

const ins = (id: string, o: Partial<Insight> = {}): Insight => ({
  id, kind: 'no_feedback', studentId: null, studentName: null, classId: null, title: id, detail: '', urgency: 'low', status: 'new',
  createdAt: '2026-10-20T10:00:00Z', actionLabel: null, ...o,
})

describe('insights logic', () => {
  it('a 404 means the API is not deployed (show nothing); other failures are real errors', () => {
    expect(insightsMissing(new ApiError(404, 'not_found'))).toBe(true)
    expect(insightsMissing(new ApiError(500, 'x'))).toBe(false)
    expect(insightsMissing(new NetworkError('x'))).toBe(false)
  })
  it('open insights: high first, server order kept, settled ones out, input untouched', () => {
    const list = [ins('a'), ins('b', { urgency: 'high' }), ins('c', { status: 'accepted' }), ins('d', { urgency: 'high' })]
    expect(openInsights(list).map(i => i.id)).toEqual(['b', 'd', 'a'])
    expect(list.map(i => i.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('the full list puts open ones first, then history newest first', () => {
    const list = [ins('old', { status: 'dismissed', createdAt: '2026-10-01T00:00:00Z' }), ins('open'), ins('new', { status: 'auto_done', createdAt: '2026-10-19T00:00:00Z' })]
    expect(sortInsights(list).map(i => i.id)).toEqual(['open', 'new', 'old'])
  })
  it('Today rows: up to 3; an accepted row keeps its place with its outcome; a dismissed row leaves', () => {
    const list = [ins('a'), ins('b'), ins('c'), ins('d')]
    expect(todayRows(list, {}, []).map(i => i.id)).toEqual(['a', 'b', 'c'])
    const settled = { a: { kind: 'accepted' as const, text: 'Drafted email to Jake’s parents' }, b: { kind: 'dismissed' as const } }
    const after = [ins('a', { status: 'accepted' }), ins('b', { status: 'dismissed' }), ins('c'), ins('d')]
    expect(todayRows(after, settled, [list[0]!]).map(i => i.id)).toEqual(['a', 'c', 'd'])
  })
  it('a row being accepted stays in place, and stays visible when a poll already shows it settled', () => {
    const list = [ins('a'), ins('b'), ins('c'), ins('d')]
    expect(todayRows(list, { b: { kind: 'pending' } }, [list[1]!]).map(i => i.id)).toEqual(['a', 'b', 'c'])
    const polled = [ins('a'), ins('b', { status: 'accepted' }), ins('c'), ins('d')]
    expect(todayRows(polled, { b: { kind: 'pending' } }, [list[1]!]).map(i => i.id)).toEqual(['b', 'a', 'c'])
    expect(todayRows(polled, {}, [list[1]!]).map(i => i.id)).toEqual(['a', 'c', 'd']) // a failed accept forgets it
  })
  it('labels: Do it with a next step, Got it for news; status words for settled rows', () => {
    expect(acceptLabel({ actionLabel: 'Draft email' })).toBe('Do it')
    expect(acceptLabel({ actionLabel: null })).toBe('Got it')
    expect(statusWord('auto_done')).toBe('Done by the agent')
    expect(statusWord('new')).toBe('')
  })
  it('the Insights task has a label and autonomy copy for every mode it allows', () => {
    expect(taskLabel('insights')).toBe('Insights')
    expect(autonomyOptions('insights')).toEqual(['auto', 'review', 'off'])
    for (const m of autonomyOptions('insights')) expect(AUTONOMY_COPY.insights[m]).toBeTruthy()
  })
})
