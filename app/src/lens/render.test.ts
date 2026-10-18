import { describe, it, expect } from 'vitest'
import type { Today } from '@matside/shared'
import { render, minutesLeft, bar } from './render'
import { initialState } from './reducer'
import type { LensState, Screen } from './state'

const drill = { id: 'd1', position: 1, name: 'Horse stance holds', minutes: 4, kind: 'technique' as const, cues: ['knees out', 'back tall'], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null }
const today = {
  classId: 'c', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: 's', theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  deck: { id: 'k', classId: 'c', forDate: '2026-10-20', status: 'active', drills: [drill] },
} as Today
const s: LensState = {
  ...initialState(true), screen: 'peek', today,
  session: { id: 's', startedAt: 0 }, active: { drillId: 'd1', startedAt: 0 },
  coverage: { covered: 3, present: 12 }, nextStudent: { id: 'p', name: 'Priya', reason: 'guard' },
}
const ALL: Screen[] = ['firstRun', 'home', 'attendance', 'attendanceDone', 'dark', 'peek', 'deck', 'recording', 'sending', 'card', 'disambiguation', 'confirmEnd', 'wrapup']

describe('minutesLeft', () => {
  it('whole minutes left, <1m, and minutes over', () => {
    expect(minutesLeft(4, 0, 79_000)).toBe('2m left')
    expect(minutesLeft(4, 0, 0)).toBe('4m left')
    expect(minutesLeft(1, 0, 15_000)).toBe('<1m left')
    expect(minutesLeft(1, 0, 60_000)).toBe('<1m left')
    expect(minutesLeft(1, 0, 75_000)).toBe('+1m over')
    expect(minutesLeft(1, 0, 180_000)).toBe('+2m over')
  })
  it('bar fills proportionally and clamps', () => {
    expect(bar(0.5, 10)).toBe('━━━━━─────')
    expect(bar(2, 4)).toBe('━━━━')
    expect(bar(-1, 4)).toBe('────')
  })
})

describe('render', () => {
  it('dark is one empty full-screen capturing text', () => {
    const p = render({ ...s, screen: 'dark' }, 0)
    expect(p).toEqual({ key: 'dark', list: null, texts: [{ id: 1, name: 'dark', x: 0, y: 0, w: 576, h: 288, border: false, capture: true, content: '' }] })
  })
  it('dark page does not depend on time (no repaint while dark)', () => {
    expect(render({ ...s, screen: 'dark' }, 0)).toEqual(render({ ...s, screen: 'dark' }, 999_999))
  })
  it('peek layout A: header, boxed drill with capture, next line, no hint row', () => {
    const p = render(s, 79_000)
    expect(p.key).toBe('peek')
    expect(p.texts.find(t => t.name === 'hdrL')?.content).toBe('STANCES · Kids · Tue')
    expect(p.texts.find(t => t.name === 'hdrR')?.content).toBe('Feedback 3/12')
    const box = p.texts.find(t => t.name === 'box')!
    expect(box).toMatchObject({ border: true, capture: true })
    expect(box.content).toContain('HORSE STANCE HOLDS  2m left')
    expect(box.content).toContain('cue: knees out · back tall')
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('> Next feedback: Priya (guard)')
    expect(p.texts.find(t => t.name === 'hint')).toBeUndefined()
  })
  it('peek shows a status line instead of next feedback when set', () => {
    const p = render({ ...s, status: 'Time · next: Kata 2' }, 0)
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('Time · next: Kata 2')
  })
  it('peek content is stable within a minute (sparse updates)', () => {
    expect(render(s, 61_000).texts.find(t => t.name === 'box')?.content.split('\n')[0]).toBe(render(s, 89_000).texts.find(t => t.name === 'box')?.content.split('\n')[0])
  })
  it('recording panel: drill + time header, listening body, next-feedback footer', () => {
    const p = render({ ...s, screen: 'recording', pending: { mode: 'note', returnTo: 'dark', viaLongPress: false } }, 79_000)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('HORSE STANCE HOLDS · 2m left')
    expect(p.texts.find(t => t.name === 'body')?.content).toBe('● Listening… tap to send')
    expect(p.texts.find(t => t.name === 'foot')?.content).toBe('> Next feedback: Priya (guard)')
  })
  it('long-press recording says release to send', () => {
    const p = render({ ...s, screen: 'recording', pending: { mode: 'note', returnTo: 'dark', viaLongPress: true } }, 0)
    expect(p.texts.find(t => t.name === 'body')?.content).toBe('● Listening… release to send')
  })
  it('deck uses a capturing list with ≤64-char items and the planUnit header', () => {
    const p = render({ ...s, screen: 'deck' }, 0)
    expect(p.list?.items[0]).toBe('Horse stance holds · 4m')
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('DRILL DECK · 1 · tap to run')
    expect(p.texts.every(t => !t.capture)).toBe(true)
  })
  it('list items are capped at 20 × 64 chars and never empty', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...drill, id: `d${i}`, name: 'x'.repeat(80) }))
    const p = render({ ...s, screen: 'deck', today: { ...today, deck: { ...today.deck, drills: many } } }, 0)
    expect(p.list?.items).toHaveLength(20)
    expect(p.list?.items.every(i => i.length <= 64)).toBe(true)
    const empty = render({ ...s, screen: 'deck', today: { ...today, deck: { ...today.deck, drills: [] } } }, 0)
    expect(empty.list?.items.length).toBeGreaterThan(0)
  })
  it('first run welcomes and teaches gestures', () => {
    const p = render(initialState(false), 0)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('WELCOME TO COACHLENS')
    expect(p.texts.find(t => t.name === 'body')?.content).toContain('tap')
  })
  it('home without a class shows the load error', () => {
    const p = render({ ...initialState(true), loadError: 'Not paired' }, 0)
    const body = p.texts.find(t => t.name === 'body')!.content
    expect(body).toContain("Can't load class")
    expect(body).toContain('Not paired')
  })
  it('home with a class shows starting state', () => {
    const p = render({ ...s, screen: 'home', starting: true }, 0)
    expect(p.texts.find(t => t.name === 'body')?.content).toContain('Starting')
  })
  it('every page has exactly one capturing container, ≤8 texts, names ≤16 chars', () => {
    const dis = { noteId: 'n', heard: 'Mia', options: [{ id: 'a', name: 'Mia R' }, { id: 'b', name: 'Mya K' }] }
    const wrap = { sessionId: 's', minutes: 45, drillsRun: 5, coverage: { covered: 10, present: 12 }, missed: [{ id: 'j', name: 'Jake' }], agentActions: 4, pendingReview: 2 }
    for (const screen of ALL) {
      for (const st of [s, { ...initialState(true), screen }]) {
        const p = render({ ...st, screen, card: { lines: ['✓ x'], utteranceId: 'u' }, disambiguation: dis, wrapup: wrap } as LensState, 0)
        expect(p.texts.length).toBeLessThanOrEqual(8)
        expect(p.texts.filter(t => t.capture).length + (p.list ? 1 : 0)).toBe(1)
        for (const t of p.texts) expect(t.name.length).toBeLessThanOrEqual(16)
        if (p.list) expect(p.list.name.length).toBeLessThanOrEqual(16)
        for (const t of p.texts) expect(t.x + t.w).toBeLessThanOrEqual(576)
        for (const t of p.texts) expect(t.y + t.h).toBeLessThanOrEqual(288)
      }
    }
  })
})
