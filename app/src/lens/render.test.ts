import { describe, it, expect } from 'vitest'
import type { Today } from '@matside/shared'
import { render, minutesLeft, bar, clock, wrap } from './render'
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
    expect(minutesLeft(4, 0, 79_000)).toBe('3m left')
    expect(minutesLeft(4, 0, 1_000)).toBe('4m left')
    expect(minutesLeft(2, 0, 60_000)).toBe('1m left')
    expect(minutesLeft(2, 0, 61_000)).toBe('<1m left')
    expect(minutesLeft(4, 0, 0)).toBe('4m left')
    expect(minutesLeft(1, 0, 15_000)).toBe('<1m left')
    expect(minutesLeft(1, 0, 60_000)).toBe('<1m left')
    expect(minutesLeft(1, 0, 75_000)).toBe('+1m over')
    expect(minutesLeft(1, 0, 180_000)).toBe('+2m over')
  })
  it('clock counts m:ss down, then up as over (ASCII only)', () => {
    expect(clock(4, 0, 0)).toBe('4:00 left')
    expect(clock(4, 0, 1)).toBe('4:00 left')
    expect(clock(4, 0, 1000)).toBe('3:59 left')
    expect(clock(4, 0, 228_500)).toBe('0:12 left')
    expect(clock(4, 0, 240_000)).toBe('0:00 left')
    expect(clock(4, 0, 240_999)).toBe('+0:00 over')
    expect(clock(4, 0, 305_000)).toBe('+1:05 over')
    expect(clock(12, 0, 0)).toBe('12:00 left')
    expect(/^[\x20-\x7e]+$/.test(clock(4, 0, 305_000))).toBe(true)
  })
  it('wrap breaks on words into at most n lines, with an ellipsis when cut', () => {
    expect(wrap('Priya keep your guard up', 20, 3)).toEqual(['Priya keep your', 'guard up'])
    expect(wrap('one two three four five six seven eight nine ten eleven twelve thirteen', 12, 3)).toEqual(['one two', 'three four', 'five six…'])
    expect(wrap('supercalifragilisticexpialidocious', 10, 3)).toEqual(['supercali…'])
    expect(wrap('', 10, 3)).toEqual([])
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
  it('peek layout: header, drill name, dedicated partial clock, boxed bar+cue with capture, next line', () => {
    const p = render(s, 79_000)
    expect(p.key).toBe('peek')
    expect(p.texts.find(t => t.name === 'hdrL')?.content).toBe('STANCES · Kids · Tue')
    expect(p.texts.find(t => t.name === 'hdrR')?.content).toBe('Feedback 3/12')
    expect(p.texts.find(t => t.name === 'drill')?.content).toBe('HORSE STANCE HOLDS')
    expect(p.texts.find(t => t.name === 'timer')).toMatchObject({ content: '2:41 left', partial: true, capture: false })
    expect(p.texts.filter(t => t.partial).map(t => t.name)).toEqual(['timer'])
    const box = p.texts.find(t => t.name === 'box')!
    expect(box).toMatchObject({ border: true, capture: true })
    expect(box.content).toContain('━')
    expect(box.content).toContain('cue: knees out · back tall')
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('> Next feedback: Priya (guard)')
    expect(p.texts.find(t => t.name === 'hint')).toBeUndefined()
  })
  it('peek shows a status line instead of next feedback when set', () => {
    const p = render({ ...s, status: 'Time · next: Kata 2' }, 0)
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('Time · next: Kata 2')
  })
  it('per second only the clock changes; the bar moves at most every 5 s', () => {
    const at = (ms: number) => Object.fromEntries(render(s, ms).texts.map(t => [t.name, t.content]))
    const a = at(60_000); const b = at(61_000)
    expect(Object.keys(a).filter(k => a[k] !== b[k])).toEqual(['timer'])
    const boxes = new Set(Array.from({ length: 5 }, (_, i) => at(60_000 + i * 1000).box))
    expect(boxes.size).toBe(1)
    expect(at(60_000).box).not.toBe(at(120_000).box)
  })
  it('peek without a running drill: no clock', () => {
    const p = render({ ...s, active: null }, 0)
    expect(p.texts.find(t => t.name === 'timer')?.content).toBe('')
    expect(p.texts.find(t => t.name === 'drill')?.content).toBe('No drill running')
  })
  it('agent card: result header, said (left, capture) wrapped to 3 lines, agent progress (right)', () => {
    const card = { lines: ['✓ Priya · guard (3rd time)', '→ added to report card'], transcript: 'Priya keep your guard up when you throw the round kick and reset your stance after', utteranceId: 'u', runs: null, runsFinal: false }
    let p = render({ ...s, screen: 'card', card }, 0)
    expect(p.key).toBe('card')
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('✓ Priya · guard (3rd time) · → added to…')
    const said = p.texts.find(t => t.name === 'said')!
    expect(said).toMatchObject({ capture: true })
    expect(said.content.split('\n')).toHaveLength(4) // label + 3 lines
    expect(said.content.endsWith('…')).toBe(true)
    expect(p.texts.find(t => t.name === 'agents')?.content).toBe('… agents working')
    const runs = [{ agent: 'router', summary: '', status: 'ok', createdAt: '' }, { agent: 'progress', summary: '', status: 'ok', createdAt: '' }]
    p = render({ ...s, screen: 'card', card: { ...card, runs } }, 0)
    expect(p.texts.find(t => t.name === 'agents')?.content).toBe('✓ sorted\n✓ logged')
    expect(p.texts.find(t => t.name === 'foot')?.content).toContain('2×: undo')
  })
  it('attendance shows the enrolled count and both phrasings', () => {
    const roster = [{ id: 'a', name: 'Ava', nickname: null, belt: 'white' }, { id: 'b', name: 'Ben', nickname: null, belt: 'white' }]
    const body = render({ ...s, screen: 'attendance', today: { ...today, roster } }, 0).texts.find(t => t.name === 'body')!.content
    expect(body).toContain('2 enrolled')
    expect(body).toContain('"Everyone except …"')
    expect(body).toContain('"Present: …"')
  })
  it('home with several classes shows position and the swipe hint; a pending pick shows its name', () => {
    const classes = [{ id: 'c', name: 'Kids · Tue', modeLabel: 'Martial arts' }, { id: 'c2', name: 'PT · Sam', modeLabel: 'Personal training' }]
    let p = render({ ...s, screen: 'home', classes }, 0)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('COACHLENS (1/2)')
    expect(p.texts.find(t => t.name === 'foot')?.content).toBe('swipe: change class · 2×: exit')
    expect(p.texts.find(t => t.name === 'body')?.content).toContain('Martial arts')
    p = render({ ...s, screen: 'home', classes, selectedClassId: 'c2' }, 0)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('COACHLENS (2/2)')
    expect(p.texts.find(t => t.name === 'body')?.content).toBe('PT · Sam\nPersonal training\n\nLoading class…')
    expect(render({ ...s, screen: 'home' }, 0).texts.find(t => t.name === 'foot')?.content).toBe('2×: exit')
  })
  it('recording panel: drill + time header, listening body, next-feedback footer', () => {
    const p = render({ ...s, screen: 'recording', pending: { mode: 'note', returnTo: 'dark', viaLongPress: false } }, 79_000)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('HORSE STANCE HOLDS · 3m left')
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
  it('peek truncates a long header and a long cue to one line', () => {
    const long = {
      ...s,
      today: { ...today, theme: 'Advanced competition sparring footwork', className: 'Adult black belt · Saturday morning',
        deck: { ...today.deck, drills: [{ ...drill, cues: ['keep the rear heel light and ready', 'hands high at all times please'] }] } },
    } as LensState
    const p = render(long, 0)
    const hdrL = p.texts.find(t => t.name === 'hdrL')!.content
    expect(hdrL.length).toBeLessThanOrEqual(28)
    expect(hdrL.endsWith('…')).toBe(true)
    const cue = p.texts.find(t => t.name === 'box')!.content.split('\n').find(l => l.startsWith('cue:'))!
    expect(cue.length).toBeLessThanOrEqual(40)
    expect(cue.endsWith('…')).toBe(true)
    expect(render(s, 0).texts.find(t => t.name === 'hdrL')!.content).toBe('STANCES · Kids · Tue')
  })

  it('every page has exactly one capturing container, ≤8 texts, names ≤16 chars', () => {
    const dis = { noteId: 'n', heard: 'Mia', options: [{ id: 'a', name: 'Mia R' }, { id: 'b', name: 'Mya K' }] }
    const wrapup = { sessionId: 's', minutes: 45, drillsRun: 5, coverage: { covered: 10, present: 12 }, missed: [{ id: 'j', name: 'Jake' }], agentActions: 4, pendingReview: 2 }
    for (const screen of ALL) {
      for (const st of [s, { ...initialState(true), screen }]) {
        const p = render({ ...st, screen, card: { lines: ['✓ x'], transcript: 't', utteranceId: 'u', runs: null, runsFinal: false }, disambiguation: dis, wrapup } as LensState, 0)
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
