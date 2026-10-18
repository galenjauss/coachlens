import { describe, it, expect } from 'vitest'
import type { Today } from '@matside/shared'
import { render, minutesLeft, bar, clock, wrap, micLine, stageLine, peekFit, heardTail, LOBBY_HINT, type PageSpec } from './render'
import { SAID_COLS, classHeader, clip, colsFor, rowsFor, transcriptPages } from './text'
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
const ALL: Screen[] = ['firstRun', 'home', 'attendance', 'attendanceDone', 'dark', 'peek', 'deck', 'drillDetail', 'recording', 'sending', 'card', 'disambiguation', 'confirmEnd', 'wrapup', 'lobby', 'planning', 'planApplying', 'planResult']

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
    expect(clock(4, 0, 240_999)).toBe('0:00 left')
    expect(clock(4, 0, 241_000)).toBe('+0:01 over')
    expect(clock(3, 0, 999)).toBe('3:00 left')
    expect(clock(3, 0, 1000)).toBe('2:59 left')
    expect(clock(4, 0, 305_000)).toBe('+1:05 over')
    expect(clock(12, 0, 0)).toBe('12:00 left')
    expect(/^[\x20-\x7e]+$/.test(clock(4, 0, 305_000))).toBe(true)
  })
  it('wrap breaks on words; nothing is dropped unless a line cap is given', () => {
    expect(wrap('Priya keep your guard up', 20, 3)).toEqual(['Priya keep your', 'guard up'])
    expect(wrap('one two three four five six seven eight nine ten eleven twelve thirteen', 12, 3)).toEqual(['one two', 'three four', 'five six…'])
    expect(wrap('one two three four five six seven eight nine ten eleven twelve thirteen', 12).join(' ')).toBe('one two three four five six seven eight nine ten eleven twelve thirteen')
    expect(wrap('supercalifragilisticexpialidocious', 10)).toEqual(['supercalif', 'ragilistic', 'expialidoc', 'ious'])
    expect(wrap('', 10, 3)).toEqual([])
    expect(wrap('Warm-up: Solve one-step equations', 28, 1)).toEqual(['Warm-up: Solve one-step…']) // never "equat…"
    expect(clip('LINEAR EQUATIONS · TUTORING WEDNESDAY', 28)).toBe('LINEAR EQUATIONS · TUTORING…')
  })
  it('budgets come from container size (~14.5 px/char, ~30 px/line)', () => {
    expect(colsFor(576)).toBe(39)
    expect(colsFor(576, true)).toBe(38)
    expect(rowsFor(40)).toBe(1)
    expect(rowsFor(164, true)).toBe(5)
  })
  it('class header: theme first, then class; drops the mode word, then the class tail; never mid-word', () => {
    expect(classHeader('Linear Equations', 'Algebra · Wed 4:00', 'Tutoring', 39)).toBe('LINEAR EQUATIONS · Algebra · Wed 4:00')
    expect(classHeader('Linear Equations', 'Tutoring Wednesday · Algebra', 'Tutoring', 30)).toBe('LINEAR EQUATIONS · Wednesday')
    expect(classHeader('Linear Equations', 'Algebra · Wed 4:00', 'Tutoring', 27)).toBe('LINEAR EQUATIONS · Algebra')
    expect(classHeader('Linear Equations', 'Algebra · Wed 4:00', 'Tutoring', 20)).toBe('LINEAR EQUATIONS')
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
    expect(p.key).toBe('peek2')
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('STANCES · Kids · Tue')
    expect(p.texts.find(t => t.name === 'cov')?.content).toBe('Feedback 3/12')
    expect(p.texts.find(t => t.name === 'drill')?.content).toBe('Horse stance holds')
    expect(p.texts.find(t => t.name === 'timer')).toMatchObject({ content: '2:41 left', capture: false })
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
  const longSaid = 'Priya keep your guard up when you throw the round kick, reset your stance after every kick, and Jake needs to work on his horse stance because his knees keep collapsing inward during holds today'
  const mkCard = (transcript: string, page = 0) => ({ lines: ['✓ Priya · guard (3rd time)', '→ added to report card'], transcript, utteranceId: 'u', runs: null, runsFinal: false, page })

  it('agent card: result header, FULL-WIDTH transcript (capture), one compact agent line + hints at the bottom', () => {
    let p = render({ ...s, screen: 'card', card: mkCard('Priya keep your guard up') }, 0)
    expect(p.key).toBe('card')
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('✓ Priya · guard (3rd time)')
    const said = p.texts.find(t => t.name === 'said')!
    expect(said).toMatchObject({ capture: true, x: 0, w: 576, content: '"Priya keep your guard up"' })
    const agents = p.texts.find(t => t.name === 'agents')!
    expect(agents).toMatchObject({ x: 0, w: 576 })
    expect(agents.y).toBeGreaterThanOrEqual(said.y + said.h)
    expect(agents.content).toBe('… working\ntap: close · 2×: undo')
    const runs = [{ agent: 'router', summary: '', status: 'ok', createdAt: '' }, { agent: 'progress', summary: '', status: 'ok', createdAt: '' }]
    p = render({ ...s, screen: 'card', card: { ...mkCard('x'), lines: ['✓ x', '→ parent note drafting'], runs } }, 0)
    expect(p.texts.find(t => t.name === 'agents')?.content).toBe('ok sorted · ok logged · .. email\ntap: close · 2×: undo')
    const many = ['router', 'progress', 'billing', 'attendance', 'parent_email', 'planner'].map(agent => ({ agent, summary: '', status: 'ok', createdAt: '' }))
    const lines = p.texts.length && render({ ...s, screen: 'card', card: { ...mkCard('x'), runs: many } }, 0).texts.find(t => t.name === 'agents')!.content.split('\n')
    expect(lines).toHaveLength(2) // progress wraps to 2 lines max (hints yield)
    for (const l of lines as string[]) expect(l.length).toBeLessThanOrEqual(SAID_COLS)
  })

  it('a ~200-char transcript is shown WHOLE across the full width: ≤5 lines × ≤38 cols per page, paged, nothing cut', () => {
    expect(longSaid.length).toBeGreaterThan(190)
    expect(SAID_COLS).toBe(38)
    const said = (transcript: string, page: number) => render({ ...s, screen: 'card', card: mkCard(transcript, page) }, 0).texts.find(t => t.name === 'said')!.content
    const all = (transcript: string) => transcriptPages(transcript).map((_, i) => said(transcript, i).split('\n'))
    const p = all(longSaid)
    expect(p.length).toBe(2)
    expect(p[0]).toHaveLength(5)
    for (const page of p) for (const l of page) expect(l.length).toBeLessThanOrEqual(38)
    expect(p.flat().join(' ')).toBe(`"${longSaid}"`)
    expect(p.flat().join('')).not.toContain('…')
    const hdr = (page: number) => render({ ...s, screen: 'card', card: mkCard(longSaid, page) }, 0).texts.find(t => t.name === 'hdr')!.content
    expect(hdr(1)).toBe('2/2 swipe · ✓ Priya · guard (3rd time)')
    expect(said(longSaid, 9)).toBe(said(longSaid, 1)) // clamped
  })

  it('no clipping: long cue, next line, roll-call result and missed list wrap instead of being cut', () => {
    const long = { ...s, nextStudent: { id: 'p', name: 'Priyanka Venkataraman', reason: 'guard drops on the rear hand' },
      today: { ...today, deck: { ...today.deck, drills: [{ ...drill, cues: ['keep the rear heel light', 'hands high'] }] } } } as LensState
    const p = render(long, 0)
    expect(p.texts.find(t => t.name === 'next')?.content.replace(/\n/g, ' ')).toBe('> Next feedback: Priyanka Venkataraman (guard drops on the rear hand)')
    expect(p.texts.find(t => t.name === 'box')?.content.replace(/\n/g, ' ')).toContain('cue: keep the rear heel light · hands high')
    expect(p.texts.find(t => t.name === 'box')?.content).not.toContain('━') // the bar yields to the cue
    const wrap2 = { sessionId: 's', minutes: 45, drillsRun: 5, coverage: { covered: 4, present: 12 }, agentActions: 4, pendingReview: 2,
      missed: ['Alexander', 'Benjamin', 'Charlotte', 'Dominique', 'Evangeline', 'Francesca', 'Gabriella'].map((name, i) => ({ id: `${i}`, name })) }
    const body = render({ ...s, screen: 'wrapup', wrapup: wrap2 }, 0).texts.find(t => t.name === 'body')!.content
    expect(body.split('\n')[0]).toBe('Missed: Alexander, Benjamin,')
    expect(body.split('\n')[1]).toMatch(/^Charlotte, .*…$/) // two lines max, cut between names
    const att = render({ ...s, screen: 'attendanceDone', attendanceLines: ['11 present', 'absent: Jake Thompson, Mia Rodriguez-Lopez'] }, 0)
    expect(att.texts.find(t => t.name === 'body')?.content.replace(/\n/g, ' ')).toContain('absent: Jake Thompson, Mia Rodriguez-Lopez')
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
  it('recording panel: drill + time header, "speak, then tap" hint with the next-feedback line, live mic line', () => {
    const rec = { ...s, screen: 'recording' as const, pending: { mode: 'note' as const, returnTo: 'peek' as const, viaLongPress: false, at: 79_000 }, mic: { tick: 0, audio: false, source: 'glasses' as const } }
    const p = render(rec, 79_000)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('HORSE STANCE HOLDS · 3m left')
    expect(p.texts.find(t => t.name === 'body')?.content).toBe('speak, then tap\n\n> Next feedback: Priya (guard)')
    expect(p.texts.find(t => t.name === 'mic')?.content).toBe('○ waiting for mic…')
    // static time: minutes later the header still shows the time from when recording started
    expect(render(rec, 79_000 + 120_000).texts.find(t => t.name === 'hdr')?.content).toBe('HORSE STANCE HOLDS · 3m left')
    expect(render({ ...rec, mic: { tick: 8, audio: true, source: 'glasses' } }, 0).texts.find(t => t.name === 'mic')?.content).toBe('● LISTENING  0:04')
  })
  it('mic line: waiting until audio, then a ●/○ pulse per 500 ms tick with m:ss counting up; says (phone) after the fallback', () => {
    expect(micLine(null)).toBe('')
    expect(micLine({ tick: 3, audio: false, source: 'glasses' })).toBe('○ waiting for mic…')
    expect(micLine({ tick: 3, audio: false, source: 'phone' })).toBe('○ waiting for phone mic…')
    expect(micLine({ tick: 8, audio: true, source: 'glasses' })).toBe('● LISTENING  0:04')
    expect(micLine({ tick: 9, audio: true, source: 'glasses' })).toBe('○ LISTENING  0:04')
    expect(micLine({ tick: 10, audio: true, source: 'glasses' })).toBe('● LISTENING  0:05')
    expect(micLine({ tick: 8, audio: true, source: 'phone' })).toBe('● LISTENING (phone)  0:04')
    expect(micLine({ tick: 150, audio: true, source: 'glasses' })).toBe('● LISTENING  1:15')
    for (const tick of [0, 1, 2, 3]) expect(micLine({ tick, audio: true, source: 'glasses' })).not.toMatch(/[▁▂▃▄▅▆▇█✓]/) // no waveform, no ✓
  })
  it('thinking stage line: current stage in caps with a 1–3 dot cycle; fits the box', () => {
    expect(stageLine({ stage: 'heard', tick: 0, since: 0 })).toBe('HEARD· > sending > thinking > agents')
    expect(stageLine({ stage: 'sending', tick: 1, since: 0 })).toBe('heard > SENDING·· > thinking > agents')
    expect(stageLine({ stage: 'thinking', tick: 5, since: 3 })).toBe('heard > sending > THINKING··· > agents')
    expect(stageLine({ stage: 'thinking', tick: 6, since: 3 })).toBe('heard > sending > THINKING· > agents')
    expect(stageLine({ stage: 'thinking', tick: 5, since: 3 }).length).toBeLessThanOrEqual(colsFor(576, true))
    const p = render({ ...s, screen: 'sending', pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 }, thinking: { stage: 'sending', tick: 0, since: 0 } }, 0)
    expect(p.texts.find(t => t.name === 'body')?.content).toBe('heard > SENDING· > thinking > agents')
  })
  it('long-press recording says speak, then release', () => {
    const p = render({ ...s, screen: 'recording', pending: { mode: 'note', returnTo: 'dark', viaLongPress: true, at: 0 } }, 0)
    expect(p.texts.find(t => t.name === 'body')?.content.split('\n')[0]).toBe('speak, then release')
  })
  it('wrap-up says who was missed and what tap and 2x do', () => {
    const w = { sessionId: 's', minutes: 45, drillsRun: 5, coverage: { covered: 9, present: 12 }, agentActions: 4, pendingReview: 2,
      missed: ['Jake', 'Leo', 'Mia'].map((name, i) => ({ id: `${i}`, name })) }
    const p = render({ ...s, screen: 'wrapup', wrapup: w }, 0)
    expect(p.texts.find(t => t.name === 'body')?.content.split('\n')[0]).toBe('Missed: Jake, Leo, Mia')
    expect(p.texts.find(t => t.name === 'foot')?.content).toBe('Tap = coach them first next class\n2x = done')
    expect(render({ ...s, screen: 'wrapup', wrapup: { ...w, missed: [] } }, 0).texts.find(t => t.name === 'foot')?.content).toBe('Tap = done')
  })
  it('deck uses a capturing list with ≤64-char items and the planUnit header', () => {
    const p = render({ ...s, screen: 'deck' }, 0)
    expect(p.list?.items[0]).toBe('Horse stance holds · 4m')
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('DRILL DECK · 1 · tap to view')
    expect(p.texts.every(t => !t.capture)).toBe(true)
  })
  it('list items are capped at 20 × 64 chars and never empty', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...drill, id: `d${i}`, name: 'word '.repeat(16).trim() }))
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
  it('peek shrinks in order: drop the bar → drop later cues → move the next line → point to the deck detail', () => {
    expect(peekFit(['knees out'])).toMatchObject({ bar: true, nextRows: 2, more: false })
    expect(peekFit(['keep the rear heel light and ready', 'hands high at all times please'])).toMatchObject({ bar: false, nextRows: 2, more: false })
    const third = peekFit(['keep the rear heel light and ready at all times', 'hands high at all times please, both of them'])
    expect(third).toMatchObject({ bar: false, nextRows: 2, more: false })
    expect(third.cues.join(' ')).toBe('cue: keep the rear heel light and ready at all times')
    const moved = peekFit(['keep the rear heel light and ready at all times while you circle your partner slowly'])
    expect(moved).toMatchObject({ bar: false, nextRows: 1, more: false })
    const last = peekFit(['x '.repeat(80).trim() + ' end'])
    expect(last).toMatchObject({ nextRows: 1, more: true })
    const s2 = { ...s, today: { ...today, deck: { ...today.deck, drills: [{ ...drill, cues: ['keep the rear heel light and ready at all times while you circle your partner slowly'] }] } } } as LensState
    const p = render(s2, 0)
    expect(p.key).toBe('peek1')
    expect(p.texts.find(t => t.name === 'next')?.content).toBe('> Next: Priya')
  })
  it('the tutoring Wednesday plan shows whole on the peek (instructor case)', () => {
    const tut = { ...s, today: { ...today, theme: 'Linear Equations', className: 'Algebra · Wed 4:00', modeLabel: 'Tutoring',
      deck: { ...today.deck, drills: [{ ...drill, name: 'Warm-up: Solve one-step equations', cues: ['undo the operation', 'check by substituting'] }] } } } as LensState
    const p = render(tut, 0)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('LINEAR EQUATIONS · Algebra · Wed 4:00')
    expect(p.texts.find(t => t.name === 'drill')?.content).toBe('Warm-up: Solve one-step\nequations')
  })
  it('deck item detail shows the full name and every cue (paged with swipe when long)', () => {
    const name = 'Warm-up: Solve one-step equations with a partner, then swap and check each other'
    const st = { ...s, screen: 'drillDetail' as const, detail: { index: 0, page: 0 }, today: { ...today, deck: { ...today.deck, drills: [{ ...drill, name, cues: ['undo the operation on both sides', 'check by substituting'] }] } } } as LensState
    const p = render(st, 0)
    expect(p.texts.find(t => t.name === 'hdr')?.content).toBe('1/1 · 4m · running')
    expect(p.texts.find(t => t.name === 'body')?.content.replace(/\n+/g, ' ')).toBe(`${name} cue: undo the operation on both sides cue: check by substituting`)
    expect(p.texts.find(t => t.name === 'foot')?.content).toBe('tap: start · 2×: back')
    const deckItem = render({ ...st, screen: 'deck' }, 0).list!.items[0]!
    expect(deckItem.endsWith('… · 4m')).toBe(true)
    expect(deckItem.length).toBeLessThanOrEqual(64)
  })

  it('every page has exactly one capturing container, ≤8 texts, names ≤16 chars', () => {
    const dis = { noteId: 'n', heard: 'Mia', options: [{ id: 'a', name: 'Mia R' }, { id: 'b', name: 'Mya K' }] }
    const wrapup = { sessionId: 's', minutes: 45, drillsRun: 5, coverage: { covered: 10, present: 12 }, missed: [{ id: 'j', name: 'Jake' }], agentActions: 4, pendingReview: 2 }
    for (const screen of ALL) {
      for (const st of [s, { ...initialState(true), screen }]) {
        const p = render({ ...st, screen, card: { lines: ['✓ x'], transcript: 't', utteranceId: 'u', runs: null, runsFinal: false, page: 0 }, disambiguation: dis, wrapup } as LensState, 0)
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

/*
 * Layout budget: across every screen, with realistic long tutoring inputs, no rendered line exceeds its
 * container's char budget (from its width, ~14.5 px/char), no container shows more lines than fit, and
 * no word of the plan is split mid-word.
 */
describe('layout budget', () => {
  const LONG_NAME = 'Warm-up: Solve one-step equations'
  const tut: Today = { ...today, className: 'Algebra · Wed 4:00', theme: 'Linear Equations', modeLabel: 'Tutoring', planUnit: 'Lesson plan',
    focus: [{ label: 'Sign errors when moving terms across the equals sign', studentIds: [] } as unknown as Today['focus'][number]],
    deck: { ...today.deck, drills: [
      { ...drill, id: 'd1', name: LONG_NAME, minutes: 5, cues: ['undo the operation on both sides', 'check by substituting back in'] },
      { ...drill, id: 'd2', name: 'Two-step equations: isolate the variable, then divide both sides by the coefficient', minutes: 12, cues: ['inverse operations in reverse order of operations', 'keep the equation balanced', 'circle the variable first'], focusStudentIds: ['a', 'b'] },
    ] } } as Today
  const words = new Set([LONG_NAME, 'Linear Equations', 'Algebra · Wed 4:00', ...tut.deck.drills.flatMap(d => [d.name, ...d.cues])]
    .flatMap(x => x.split(/\s+/)).map(w => w.toUpperCase().replace(/[^A-Z0-9-]/g, '')).filter(w => w.length > 2))
  const base: LensState = { ...s, today: tut, nextStudent: { id: 'p', name: 'Priyanka Venkataraman', reason: 'sign errors moving terms' },
    pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: 0 }, mic: { tick: 9, audio: true, source: 'phone' },
    thinking: { stage: 'thinking', tick: 5, since: 3 }, detail: { index: 1, page: 0 },
    card: { lines: ['✓ Priyanka · sign errors moving terms across'], transcript: 'Priyanka keeps flipping the sign when she moves the constant to the other side of the equation', utteranceId: 'u', runs: null, runsFinal: false, page: 0 },
    disambiguation: { noteId: 'n', heard: 'Priya', options: [{ id: 'a', name: 'Priyanka Venkataraman' }, { id: 'b', name: 'Priya Ramaswamy-Okonkwo' }] },
    wrapup: { sessionId: 's', minutes: 50, drillsRun: 2, coverage: { covered: 10, present: 12 }, agentActions: 7, pendingReview: 3, missed: [{ id: 'j', name: 'Jake' }, { id: 'l', name: 'Leo' }, { id: 'm', name: 'Mia' }] },
    attendanceLines: ['11 present', 'absent: Jake Thompson, Mia Rodriguez-Lopez'],
    classes: [{ id: 'c', name: 'Algebra · Wed 4:00', modeLabel: 'Tutoring' }, { id: 'c2', name: 'Geometry · Thu 5:30', modeLabel: 'Tutoring' }] }
  const norm = (w: string) => w.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  /** A cut word: a token shown with an ellipsis that is only a prefix of a plan word, or a plan word hard-broken across two lines. */
  const cutWords = (lines: string[]): string[] => {
    const bad: string[] = []
    lines.forEach((l, i) => {
      for (const raw of l.split(/\s+/)) {
        const tok = norm(raw)
        if (raw.endsWith('…') && tok && !words.has(tok) && [...words].some(w => w.startsWith(tok))) bad.push(raw)
      }
      const next = lines[i + 1]
      if (next) {
        const [tail, head] = [norm(l.split(/\s+/).at(-1) ?? ''), norm(next.split(/\s+/)[0] ?? '')]
        if (tail && head && words.has(tail + head)) bad.push(`${l} | ${next}`)
      }
    })
    return bad
  }
  const check = (p: PageSpec, where: string) => {
    for (const t of p.texts) {
      const lines = t.content ? t.content.split('\n') : []
      expect(lines.length, `${where}/${t.name} rows: ${t.content}`).toBeLessThanOrEqual(rowsFor(t.h, t.border))
      for (const l of lines) expect(l.length, `${where}/${t.name}: "${l}"`).toBeLessThanOrEqual(colsFor(t.w, t.border))
      expect(cutWords(lines), `${where}/${t.name}`).toEqual([])
    }
    if (p.list) for (const i of p.list.items) {
      expect(i.length, `${where}/list: "${i}"`).toBeLessThanOrEqual(Math.min(64, colsFor(p.list.w)))
      expect(cutWords([i]), `${where}/list`).toEqual([])
    }
  }
  it('no line overflows its container and no plan word is cut, on every screen', () => {
    expect(cutWords(['Warm-up: Solve one-step equat…'])).toEqual(['equat…']) // the detector catches the old bug
    expect(cutWords(['Warm-up: Solve one-step equ', 'ations'])).toHaveLength(1)
    for (const screen of ALL) {
      for (const active of ['d1', 'd2']) {
        const st = { ...base, screen, active: { drillId: active, startedAt: 0 }, detail: { index: active === 'd1' ? 0 : 1, page: 0 } }
        check(render(st, 61_000), `${screen}:${active}`)
        check(render({ ...st, status: 'Time · next: Two-step equations: isolate the variable' }, 61_000), `${screen}:${active}:status`)
      }
    }
  })
})

describe('queued suffix + provisional card', () => {
  it('peek and home add a compact queued suffix to the status row only when notes wait', async () => {
    const { QUEUED_GLYPH } = await import('../config')
    const next = (st: LensState) => render(st, 0).texts.find(t => t.name === 'next')!.content
    expect(next(s)).toBe('> Next feedback: Priya (guard)')
    expect(next({ ...s, queued: 2 })).toBe(`> Next feedback: Priya (guard)\n${QUEUED_GLYPH} 2 queued`) // spare row
    expect(next({ ...s, nextStudent: { id: 'p', name: 'Al', reason: 'x' }, queued: 2 })).toBe(`> Next feedback: Al (x) ${QUEUED_GLYPH} 2 queued`)
    expect(next({ ...s, status: '● Saved · will sync', queued: 1 })).toBe(`● Saved · will sync ${QUEUED_GLYPH} 1 queued`)
    const foot = (st: LensState) => render({ ...st, screen: 'home', session: null }, 0).texts.find(t => t.name === 'foot')!.content
    expect(foot(s)).toBe('2×: exit')
    expect(foot({ ...s, queued: 3 })).toBe(`2×: exit ${QUEUED_GLYPH} 3 queued`)
    for (const st of [{ ...s, queued: 12, status: 'x '.repeat(80) }, { ...s, queued: 12, screen: 'home' as const }]) {
      for (const t of render(st, 0).texts) for (const line of t.content.split('\n')) expect(line.length).toBeLessThanOrEqual(colsFor(576))
    }
  })

  it('a provisional card shows the transcript and "… sorting" (no undo hint)', () => {
    const card = { lines: [], transcript: 'Priya guard up', utteranceId: null, runs: null, runsFinal: false, page: 0, provisional: true }
    const p = render({ ...s, screen: 'card', card }, 0)
    expect(p.texts.find(t => t.name === 'said')?.content).toContain('Priya guard up')
    expect(p.texts.find(t => t.name === 'agents')?.content).toBe('… sorting\ntap: close')
  })
})

describe('lobby and planning screens', () => {
  const pre = { ...s, session: null, active: null }
  const txt = (p: PageSpec, name: string) => p.texts.find(t => t.name === name)?.content
  const drills = ['Tag', 'Holds', 'Sprawls', 'Kata'].map((name, i) => ({ ...drill, id: `d${i}`, name, minutes: 5 }))
  const t4 = { ...today, deck: { ...today.deck, drills } } as Today

  it('lobby: class · start · plan length, the first 3 items, an empty insight slot, the hint', () => {
    const p = render({ ...pre, screen: 'lobby', today: t4 }, 0)
    expect(txt(p, 'hdr')).toBe('Kids · Tue · 17:00 · 20m')
    expect(txt(p, 'body')).toBe('1 Tag · 5m\n2 Holds · 5m\n3 Sprawls · 5m\n+1 more')
    expect(txt(p, 'insight')).toBe('')
    expect(txt(p, 'foot')).toBe('tap start · 2× plan · swipe back')
    expect(LOBBY_HINT.length).toBeLessThanOrEqual(colsFor(576))
    expect(p.texts.filter(t => t.capture)).toHaveLength(1)
  })

  it('lobby: a status replaces the hint; starting and errors show in the body; no plan says how to make one', () => {
    expect(txt(render({ ...pre, screen: 'lobby', status: 'Plan change undone' }, 0), 'foot')).toBe('Plan change undone')
    expect(txt(render({ ...pre, screen: 'lobby', starting: true }, 0), 'body')).toContain('Starting class…')
    expect(txt(render({ ...pre, screen: 'lobby', loadError: 'Offline' }, 0), 'body')).toContain('Offline · tap to retry')
    const empty = { ...today, deck: { ...today.deck, drills: [] } } as Today
    expect(txt(render({ ...pre, screen: 'lobby', today: empty }, 0), 'body')).toContain('No plan yet')
  })

  it('planning: "● Planning · m:ss" and the last ~60 chars heard, starting on a whole word', () => {
    const heard = 'okay so today I want to swap the warmup for sprawls and add five minutes of kata at the end'
    const p = render({ ...pre, screen: 'planning', planning: { stage: 'listening', sec: 75, heard } }, 0)
    expect(txt(p, 'hdr')).toBe('● Planning · 1:15')
    const tail = heardTail(heard)
    expect(tail.startsWith('…')).toBe(true)
    expect(tail.length).toBeLessThanOrEqual(61)
    expect(heard.endsWith(tail.slice(1))).toBe(true)
    expect(heard.split(' ')).toContain(tail.slice(1).split(' ')[0])
    expect(txt(p, 'body')!.replace(/\n/g, ' ')).toBe(tail)
    expect(heardTail('short')).toBe('short')
  })

  it('applying shows a thinking line; the result lists the lines with undo only when something changed', () => {
    expect(txt(render({ ...pre, screen: 'planApplying', planning: { stage: 'applying', sec: 0, heard: '' } }, 0), 'body')).toContain('Thinking')
    const r = render({ ...pre, screen: 'planResult', planResult: { diffId: 'd', lines: ['+ Sprawls · 5m', '- Tag'] } }, 0)
    expect(txt(r, 'body')).toBe('+ Sprawls · 5m\n- Tag')
    expect(txt(r, 'foot')).toBe('tap: ok · 2×: undo')
    expect(txt(render({ ...pre, screen: 'planResult', planResult: { diffId: null, lines: [] } }, 0), 'foot')).toBe('tap: ok')
  })
})
