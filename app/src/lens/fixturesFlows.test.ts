import { describe, expect, it } from 'vitest'
import { FLOW_NAMES, flowFrame, flowFrames } from './fixturesFlows'
import { render, type PageSpec } from './render'
import { colsFor, rowsFor } from './text'

const text = (p: PageSpec, name: string) => p.texts.find(t => t.name === name)?.content ?? ''
const frame = (id: string) => { const f = flowFrame(id); if (!f) throw new Error(id); return render(f.state, f.now) }

describe('video flow fixtures', () => {
  it('every frame renders within the G2 limits and has a fixture-control name', () => {
    for (const f of flowFrames()) {
      expect(f.id).toMatch(/^[A-Za-z]{1,32}$/)
      const p = render(f.state, f.now)
      for (const t of p.texts) {
        const lines = t.content ? t.content.split('\n') : []
        expect(lines.length, `${f.id}/${t.name}`).toBeLessThanOrEqual(rowsFor(t.h, t.border))
        for (const l of lines) expect(l.length, `${f.id}/${t.name}: "${l}"`).toBeLessThanOrEqual(colsFor(t.w, t.border))
      }
    }
    expect(FLOW_NAMES).toContain('dark')
  })

  it('the flows show the scripted moments through the real reducer and render', () => {
    expect(text(frame('homeFC'), 'hdr')).toBe('COACHLENS (3/4)')
    expect(text(frame('lobbyFB'), 'insight')).toContain('★ Gus ready to test')
    expect(text(frame('planningFD'), 'hdr')).toBe('● Planning · 0:15')
    expect(text(frame('planningFD'), 'body')).toContain('add partner sparring')
    expect(text(frame('planResultFC'), 'hdr')).toBe('PLAN UPDATED')
    expect(['peekFA', 'peekFB', 'peekFF'].map(id => text(frame(id), 'timer'))).toEqual(['3:45 left', '3:30 left', '2:30 left'])
    expect(text(frame('recordingFB'), 'mic')).toBe('● LISTENING  0:01')
    expect(text(frame('recordingFC'), 'mic')).toBe('○ LISTENING  0:01')
    expect(text(frame('noteFE'), 'agents')).toContain('… sorting')
    expect(text(frame('noteFJ'), 'agents')).toBe('ok sorted · ok report · ok plan\ntap: close · 2×: undo')
    expect(text(frame('rollCallFF'), 'body')).toContain('absent: Mia')
    expect(text(frame('bannerFB'), 'hdr')).toBe('★ Jake\'s back after 3 missed')
    expect(text(frame('urgentFD'), 'agents')).toContain('ok email')
    expect(text(frame('prFB'), 'hdr')).toBe('√ Maria · deadlift 225 lb (PR +10)')
    expect(text(frame('briefFB'), 'hdr')).toBe('1/2 swipe · Priya Rao')
    expect(text(frame('answerFB'), 'said')).toBe('Guard: Priya (3), Sam (3), Ava (1),\nBen (1)')
    expect(text(frame('wrapupFD'), 'body')).toContain('★ Jake\'s back after 3 missed')
    expect(frame('darkFB').key).toBe('dark')
  })

  it('unknown names are not frames', () => {
    expect(flowFrame('nope')).toBeNull()
    expect(flowFrame(null)).toBeNull()
  })
})
