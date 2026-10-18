import { describe, it, expect } from 'vitest'
import type { Today } from '@matside/shared'
import { STATUS_MS, initialState, reduce } from './reducer'
import type { LensEvent, LensState } from './state'

const today: Today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'drill', people: 'students',
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft' as const, drills: [
    { id: 'd1', position: 1, name: 'Tag', minutes: 5, kind: 'warmup' as const, cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
    { id: 'd2', position: 2, name: 'Holds', minutes: 4, kind: 'technique' as const, cues: ['knees out'], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
  ] },
} as Today
const cov = { covered: 0, present: 12 }
const run = (s: LensState, ...events: LensEvent[]) => events.reduce<{ state: LensState; effects: unknown[] }>((acc, e) => {
  const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }
}, { state: s, effects: [] })

describe('lens reducer', () => {
  it('first run → home → start class → voice attendance', () => {
    let r = run(initialState(false), { type: 'tap' })
    expect(r.state.screen).toBe('home')
    expect(r.effects).toContainEqual({ type: 'markFirstRunSeen' })
    r = run(r.state, { type: 'todayLoaded', today }, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'startSession', classId: 'c1' })
    r = run(r.state, { type: 'sessionStarted', res: { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: null }, resumed: false, now: 1000 })
    expect(r.state.screen).toBe('attendance')
    expect(r.effects).toContainEqual({ type: 'startMic' })
    r = run(r.state, { type: 'tap' })
    expect(r.state.screen).toBe('sending')
    expect(r.effects).toContainEqual({ type: 'stopMicAndSend', mode: 'attendance', sessionId: 's1', drillId: null })
    r = run(r.state, { type: 'utteranceResult', res: { utteranceId: 'u', transcript: 'x', cardLines: ['12 present', 'absent: Jake'], coverage: cov, nextStudent: null, disambiguation: null } })
    expect(r.state.screen).toBe('attendanceDone')
    r = run(r.state, { type: 'tap', now: 2000 })
    expect(r.state.screen).toBe('peek')
    expect(r.state.active?.drillId).toBe('d1')
    expect(r.effects).toContainEqual({ type: 'logDrill', sessionId: 's1', drillId: 'd1', event: 'start' })
    expect(r.effects.some(x => (x as { type: string }).type === 'expireStatus')).toBe(false) // persistent: nothing hides it
  })

  it('first-run double-tap exits (root screen)', () => {
    const r = run(initialState(false), { type: 'doubleTap' })
    expect(r.effects).toEqual([{ type: 'exit' }])
  })

  it('home double-tap exits (root rule)', () => {
    const r = run(initialState(true), { type: 'doubleTap' })
    expect(r.effects).toEqual([{ type: 'exit' }])
  })

  const inPeek = () => run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' },
    { type: 'sessionStarted', res: { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: { id: 'p', name: 'Priya', reason: 'guard' } }, resumed: true, now: 1000 }).state
  const inDark = () => run(inPeek(), { type: 'nod' }).state
  const note = (cardLines: string[], utteranceId = 'u1') => ({ type: 'utteranceResult' as const, res: { utteranceId, transcript: 'Priya keep your guard up', cardLines, coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null } })

  it('resumed session goes straight to a peek of the drill; nod toggles dark and back', () => {
    expect(inPeek().screen).toBe('peek')
    expect(inDark().screen).toBe('dark')
    expect(run(inDark(), { type: 'nod' }).state.screen).toBe('peek')
  })

  it('nod toggles dark on any idle screen (home, peek, deck) and wakes back to that same screen', () => {
    const home = run(initialState(true), { type: 'todayLoaded', today }).state
    let r = run(home, { type: 'nod' })
    expect(r.state).toMatchObject({ screen: 'dark', darkFrom: 'home' })
    expect(run(r.state, { type: 'nod' }).state.screen).toBe('home')
    expect(run(r.state, { type: 'tap' }).state.screen).toBe('home') // tap wakes
    const dbl = run(r.state, { type: 'doubleTap' })
    expect(dbl.state.screen).toBe('home') // before class: wakes, never exits from dark
    expect(dbl.effects).toEqual([])
    const deck = run(inPeek(), { type: 'swipeDown' }).state
    r = run(deck, { type: 'nod' })
    expect(r.state).toMatchObject({ screen: 'dark', darkFrom: 'deck' })
    expect(run(r.state, { type: 'nod' }).state.screen).toBe('deck')
    r = run(inPeek(), { type: 'nod' }, { type: 'nod' })
    expect(r.state.screen).toBe('peek')
  })

  it('nod never acts while recording, sending, on the card, or on other screens', () => {
    const rec = run(inPeek(), { type: 'tap' }).state
    expect(reduce(rec, { type: 'nod' }).state).toBe(rec)
    const sending = run(rec, { type: 'tap', now: Date.now() + 1000 }).state
    expect(sending.screen).toBe('sending')
    expect(reduce(sending, { type: 'nod' }).state).toBe(sending)
    const card = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: { utteranceId: 'u', transcript: 't', cardLines: ['✓ x'], coverage: cov, nextStudent: null, disambiguation: null } }).state
    expect(card.screen).toBe('card')
    expect(reduce(card, { type: 'nod' }).state).toBe(card)
    const first = initialState(false)
    expect(reduce(first, { type: 'nod' }).state).toBe(first)
  })

  it('phone "Start" while the lens is dark before class wakes and starts', () => {
    const dark = run(initialState(true), { type: 'todayLoaded', today }, { type: 'nod' }).state
    const r = run(dark, { type: 'startRequested' })
    expect(r.effects).toContainEqual({ type: 'startSession', classId: 'c1' })
  })

  it('peek is persistent during class: no hide timer, ticks of time do not leave it', () => {
    const p = inPeek()
    expect(p.status).toBeNull()
    expect(reduce(p, { type: 'statusExpired' }).state).toBe(p)
  })

  it('tap in peek starts talking (no lead word)', () => {
    const r = run(inPeek(), { type: 'tap' })
    expect(r.state.screen).toBe('recording')
    expect(r.effects).toContainEqual({ type: 'startMic' })
  })

  it('tap in dark only wakes the lens to peek: it never records', () => {
    const r = run(inDark(), { type: 'tap' })
    expect(r.state.screen).toBe('peek')
    expect(r.effects).not.toContainEqual({ type: 'startMic' })
  })

  it('timerEnded peeks with the next drill name (waking a dark lens), or wrap up after the last', () => {
    let r = run(inDark(), { type: 'timerEnded' })
    expect(r.state).toMatchObject({ screen: 'peek', status: 'Time · next: Holds' })
    expect(r.effects).toContainEqual({ type: 'expireStatus', ms: STATUS_MS })
    r = run(r.state, { type: 'statusExpired' })
    expect(r.state).toMatchObject({ screen: 'peek', status: null })
    r = run(inDark(), { type: 'swipeDown' }, { type: 'listSelect', index: 1, now: 5 }, { type: 'timerEnded' })
    expect(r.state.status).toBe('Time · next: wrap up')
  })

  it('tap to talk, tap to send; the card stays (no timeout) and polls agent runs until tapped away', () => {
    let r = run(inPeek(), { type: 'tap' })
    expect(r.state.screen).toBe('recording')
    r = run(r.state, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'stopMicAndSend', mode: 'note', sessionId: 's1', drillId: 'd1' })
    r = run(r.state, note(['✓ Priya · guard (3rd time)']))
    expect(r.state.screen).toBe('card')
    expect(r.state.card).toMatchObject({ transcript: 'Priya keep your guard up', utteranceId: 'u1', runs: null, runsFinal: false, page: 0 })
    expect(r.state.coverage.covered).toBe(1)
    expect(r.effects).toEqual([{ type: 'pollRuns', utteranceId: 'u1' }])
    for (const e of [{ type: 'statusExpired' }, { type: 'swipeDown' }, { type: 'swipeUp' }, { type: 'longPress' }, { type: 'nod' }] as const) {
      expect(reduce(r.state, e).state.screen).toBe('card')
    }
    r = run(r.state, { type: 'tap' })
    expect(r.state).toMatchObject({ screen: 'peek', card: null })
  })

  it('swipe pages through a long transcript on the card (clamped); a short one ignores swipes', () => {
    const long = 'word '.repeat(90).trim()
    let c = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { ...note(['✓ x']), res: { ...note(['✓ x']).res, transcript: long } }).state
    expect(c.card?.page).toBe(0)
    c = run(c, { type: 'swipeUp' }).state
    expect(c.card?.page).toBe(0)
    c = run(c, { type: 'swipeDown' }, { type: 'swipeDown' }).state
    expect(c.card?.page).toBe(2)
    c = run(c, { type: 'swipeDown' }, { type: 'swipeDown' }).state
    expect(c.card?.page).toBe(2) // 90 words → 13 lines → 3 pages
    expect(run(c, { type: 'swipeUp' }).state.card?.page).toBe(1)
    expect(c.screen).toBe('card')
    const short = run(inPeek(), { type: 'tap' }, { type: 'tap' }, note(['✓ x'])).state
    expect(reduce(short, { type: 'swipeDown' }).state).toBe(short)
  })

  it('utteranceDelivered: a neutral card for notes (no undo), a status for roll call', () => {
    const r = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceDelivered' })
    expect(r.state.screen).toBe('card')
    expect(r.state.card).toMatchObject({ lines: ['Saved · details unavailable'], utteranceId: null, runsFinal: true })
    expect(r.effects.some(x => (x as { type: string }).type === 'pollRuns')).toBe(false)
    expect(run(r.state, { type: 'doubleTap' }).effects).toEqual([]) // nothing to undo
  })

  it('an empty recording says why: no audio from glasses vs too short vs not understood', () => {
    const empty = (reason: 'no_audio' | 'too_short' | 'not_understood') => run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceEmpty', reason }).state.status
    expect(empty('no_audio')).toBe("No audio from glasses — tap and speak after 'Listening'")
    expect(empty('too_short')).toBe('Too short — speak, then tap')
    expect(empty('not_understood')).toBe("Didn't catch that · tap to retry")
  })

  it('recording keeps a start time (static header) and a live mic indicator; micLevel only applies while recording', () => {
    let r = run(inPeek(), { type: 'tap', now: 5000 })
    expect(r.state.pending?.at).toBe(5000)
    expect(r.state.mic).toEqual({ seconds: 0, wave: '', source: 'glasses' })
    r = run(r.state, { type: 'micLevel', seconds: 2, wave: '▂▅▇', source: 'phone' })
    expect(r.state.mic).toEqual({ seconds: 2, wave: '▂▅▇', source: 'phone' })
    const same = reduce(r.state, { type: 'micLevel', seconds: 2, wave: '▂▅▇', source: 'phone' })
    expect(same.state).toBe(r.state)
    const p = inPeek()
    expect(reduce(p, { type: 'micLevel', seconds: 1, wave: '▁', source: 'glasses' }).state).toBe(p)
  })

  it('runsLoaded updates only the matching card', () => {
    const c = run(inPeek(), { type: 'tap' }, { type: 'tap' }, note(['✓ x'])).state
    const runs = [{ agent: 'router', summary: 's', status: 'ok', createdAt: 'x' }]
    expect(reduce(c, { type: 'runsLoaded', utteranceId: 'other', runs, final: false }).state).toBe(c)
    const r = reduce(c, { type: 'runsLoaded', utteranceId: 'u1', runs, final: true })
    expect(r.state.card).toMatchObject({ runs, runsFinal: true })
    expect(reduce(r.state, { type: 'runsLoaded', utteranceId: 'u1', runs: null, final: true }).state.card?.runs).toEqual(runs)
  })

  it('double-tap on a card undoes', () => {
    let r = run(inPeek(), { type: 'tap' }, { type: 'tap' }, note(['✓ x']))
    r = run(r.state, { type: 'doubleTap' })
    expect(r.effects).toContainEqual({ type: 'undo', utteranceId: 'u1' })
    expect(r.state).toMatchObject({ screen: 'peek', status: 'Undone' })
    expect(r.effects).toContainEqual({ type: 'expireStatus', ms: STATUS_MS })
  })

  it('long press records (from peek or dark) and release sends', () => {
    for (const start of [inPeek(), inDark()]) {
      let r = run(start, { type: 'longPress' })
      expect(r.state.screen).toBe('recording')
      r = run(r.state, { type: 'longPressRelease' })
      expect(r.state.screen).toBe('sending')
    }
  })

  it('queued and empty results show a status on the peek, then the status expires (peek stays)', () => {
    let r = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceQueued' })
    expect(r.state).toMatchObject({ screen: 'peek', status: '● Saved · will sync' })
    expect(r.effects).toContainEqual({ type: 'expireStatus', ms: STATUS_MS })
    r = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceEmpty', reason: 'not_understood' })
    expect(r.state.status).toBe("Didn't catch that · tap to retry")
    r = run(r.state, { type: 'statusExpired' })
    expect(r.state).toMatchObject({ screen: 'peek', status: null })
  })

  it('disambiguation picks a student', () => {
    let r = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: {
      utteranceId: 'u', transcript: 't', cardLines: [], coverage: cov, nextStudent: null,
      disambiguation: { noteId: 'n1', heard: 'Mya', options: [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Mia Lopez' }] } } })
    expect(r.state.screen).toBe('disambiguation')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.effects).toContainEqual({ type: 'assignNote', noteId: 'n1', studentId: 'b' })
    expect(r.state.screen).toBe('peek')
  })

  it('swipe opens deck (from peek or dark); selecting switches drill and peeks', () => {
    expect(run(inPeek(), { type: 'swipeUp' }).state.screen).toBe('deck')
    let r = run(inDark(), { type: 'swipeDown' })
    expect(r.state.screen).toBe('deck')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.state.screen).toBe('peek')
    expect(r.state.active?.drillId).toBe('d2')
    expect(r.effects).toContainEqual({ type: 'logDrill', sessionId: 's1', drillId: 'd2', event: 'start' })
    expect(run(inDark(), { type: 'swipeDown' }, { type: 'doubleTap' }).state.screen).toBe('peek')
  })

  it('end class needs confirm, then wrap-up and remind', () => {
    let r = run(inPeek(), { type: 'doubleTap' })
    expect(r.state.screen).toBe('confirmEnd')
    r = run(r.state, { type: 'swipeUp' })
    expect(r.state.screen).toBe('peek')
    expect(run(inDark(), { type: 'doubleTap' }).state.screen).toBe('confirmEnd')
    r = run(r.state, { type: 'doubleTap' }, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'endSession', sessionId: 's1' })
    r = run(r.state, { type: 'wrapupLoaded', wrapup: { sessionId: 's1', minutes: 47, drillsRun: 7, coverage: { covered: 9, present: 12 }, missed: [{ id: 'j', name: 'Jake' }], agentActions: 11, pendingReview: 3 } })
    expect(r.state.screen).toBe('wrapup')
    r = run(r.state, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'remind', sessionId: 's1', studentIds: ['j'] })
    expect(r.state.screen).toBe('home')
    expect(r.state.session).toBeNull()
  })

  const resumeRes = { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: null }
  const wrapEnd = () => run(inPeek(), { type: 'doubleTap' }, { type: 'tap' })

  it('failed end-class escapes the wrapup spinner and keeps the session', () => {
    let r = wrapEnd()
    expect(r.state).toMatchObject({ screen: 'wrapup', wrapup: null })
    r = run(r.state, { type: 'actionFailed', message: 'offline' })
    expect(r.state).toMatchObject({ screen: 'peek', status: "Couldn't end class · offline" })
    expect(r.state.session?.id).toBe('s1')
    expect(r.effects).toContainEqual({ type: 'expireStatus', ms: STATUS_MS })
    expect(run(wrapEnd().state, { type: 'doubleTap' }).state.screen).toBe('peek')
  })

  it('home tap twice starts the session once; duplicate sessionStarted is ignored', () => {
    const r = run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'tap' })
    expect(r.effects.filter(x => (x as { type: string }).type === 'startSession')).toHaveLength(1)
    const cur = inPeek()
    const dup = reduce(cur, { type: 'sessionStarted', res: resumeRes, resumed: false, now: 9 })
    expect(dup.state).toBe(cur)
    expect(dup.effects).toEqual([])
    const failed = run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'actionFailed', message: 'x' })
    expect(failed.state.starting).toBe(false)
  })

  it('resume lands on the drill already in progress without logging', () => {
    const t2: Today = { ...today, deck: { ...today.deck, drills: [
      { ...today.deck.drills[0]!, startedAt: '2026-10-20T00:00:00Z', endedAt: '2026-10-20T00:05:00Z' },
      { ...today.deck.drills[1]!, startedAt: '2026-10-20T00:05:00Z', endedAt: null },
    ] } }
    const r = run(initialState(true), { type: 'todayLoaded', today: t2 }, { type: 'tap' }, { type: 'sessionStarted', res: resumeRes, resumed: true, now: 1 })
    expect(r.state.screen).toBe('peek')
    expect(r.state.active?.drillId).toBe('d2')
    expect(r.effects.some(x => (x as { type: string }).type === 'logDrill')).toBe(false)
  })

  it('double-tap in sending escapes to peek', () => {
    expect(run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'doubleTap' }).state.screen).toBe('peek')
  })

  it('attendance empty/queued report that roll call was not saved', () => {
    const att = () => run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'sessionStarted', res: resumeRes, resumed: false, now: 1 }, { type: 'tap' })
    expect(run(att().state, { type: 'utteranceEmpty', reason: 'not_understood' }).state.status).toBe('Roll call not saved · use phone roster')
    expect(run(att().state, { type: 'utteranceEmpty', reason: 'no_audio' }).state.status).toBe('No audio from glasses · use phone roster')
    expect(run(att().state, { type: 'utteranceQueued' }).state.status).toBe('Roll call not saved · use phone roster')
  })

  it('clears the card on disambiguation skip and pick', () => {
    const dis = () => run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: {
      utteranceId: 'u', transcript: 't', cardLines: [], coverage: cov, nextStudent: null,
      disambiguation: { noteId: 'n1', heard: 'Mya', options: [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Mia Lopez' }] } } }).state
    expect(run(dis(), { type: 'doubleTap' }).state.card).toBeNull()
    expect(run(dis(), { type: 'listSelect', index: 0 }).state.card).toBeNull()
  })

  it('cancel paths emit cancelMic; firstRun tap loads today', () => {
    expect(run(inPeek(), { type: 'tap' }, { type: 'doubleTap' }).effects).toContainEqual({ type: 'cancelMic' })
    const att = run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'sessionStarted', res: resumeRes, resumed: false, now: 1 }, { type: 'doubleTap' })
    expect(att.effects).toContainEqual({ type: 'cancelMic' })
    expect(att.state).toMatchObject({ screen: 'peek', status: 'Roll call skipped · use phone' })
    expect(run(initialState(false), { type: 'tap' }).effects).toContainEqual({ type: 'loadToday' })
  })

  describe('home class choice', () => {
    const classes = [{ id: 'c1', name: 'Kids · Tue', modeLabel: 'Martial arts' }, { id: 'c2', name: 'PT · Sam', modeLabel: 'Personal training' }, { id: 'c3', name: 'Algebra', modeLabel: 'Tutoring' }]
    const home = () => run(initialState(true), { type: 'todayLoaded', today }, { type: 'classesLoaded', classes }).state

    it('swipe down/up cycles classes (wrapping) and saves the pick', () => {
      let r = run(home(), { type: 'swipeDown' })
      expect(r.state.selectedClassId).toBe('c2')
      expect(r.effects).toEqual([{ type: 'selectClass', classId: 'c2' }])
      r = run(r.state, { type: 'swipeDown' }, { type: 'swipeDown' })
      expect(r.state.selectedClassId).toBe('c1')
      r = run(home(), { type: 'swipeUp' })
      expect(r.state.selectedClassId).toBe('c3')
    })

    it('tap waits for the shown class to load, then starts it', () => {
      let r = run(home(), { type: 'swipeDown' }, { type: 'tap' })
      expect(r.effects.some(x => (x as { type: string }).type === 'startSession')).toBe(false)
      r = run(r.state, { type: 'todayLoaded', today: { ...today, classId: 'c2', className: 'PT · Sam' } })
      expect(r.state.selectedClassId).toBeNull()
      r = run(r.state, { type: 'tap' })
      expect(r.effects).toContainEqual({ type: 'startSession', classId: 'c2' })
    })

    it('one class (or none loaded): swipe does nothing', () => {
      const one = run(initialState(true), { type: 'todayLoaded', today }, { type: 'classesLoaded', classes: classes.slice(0, 1) }).state
      expect(run(one, { type: 'swipeDown' }).effects).toEqual([])
      expect(run(initialState(true), { type: 'todayLoaded', today }, { type: 'swipeDown' }).effects).toEqual([])
    })

    it('swipe is ignored while a class is starting', () => {
      const starting = run(home(), { type: 'tap' }).state
      expect(run(starting, { type: 'swipeDown' }).effects).toEqual([])
    })

    it('a load failure keeps the pending pick; tap retries that class and never starts the previous one', () => {
      let r = run(home(), { type: 'swipeDown' }, { type: 'loadFailed', message: 'Offline' })
      expect(r.state.selectedClassId).toBe('c2')
      r = run(r.state, { type: 'tap' })
      expect(r.effects).toEqual([{ type: 'loadToday' }])
      expect(r.state.loadError).toBeNull()
      expect(r.effects.some(x => (x as { type: string }).type === 'startSession')).toBe(false)
    })

    it('resume reloads classes too', () => {
      expect(run(home(), { type: 'resumed' }).effects).toContainEqual({ type: 'loadClasses' })
    })
  })
})
