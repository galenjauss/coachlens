import { describe, it, expect } from 'vitest'
import type { Today } from '@matside/shared'
import { CARD_MS, PEEK_MS, initialState, reduce } from './reducer'
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
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
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
  const inDark = () => run(inPeek(), { type: 'hide' }).state

  it('resumed session goes straight to a peek of the drill', () => {
    expect(inPeek().screen).toBe('peek')
    expect(inDark().screen).toBe('dark')
  })

  it('tap in dark starts talking (no lead word)', () => {
    const r = run(inDark(), { type: 'tap' })
    expect(r.state.screen).toBe('recording')
    expect(r.effects).toContainEqual({ type: 'startMic' })
  })

  it('headTilt in dark peeks and schedules the hide; hide returns to dark', () => {
    let r = run(inDark(), { type: 'headTilt' })
    expect(r.state.screen).toBe('peek')
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: 5000 })
    r = run(r.state, { type: 'hide' })
    expect(r.state.screen).toBe('dark')
    expect(run(inDark(), { type: 'hide' }).state.screen).toBe('dark')
  })

  it('hide does not interrupt other screens', () => {
    const rec = run(inDark(), { type: 'tap' }).state
    expect(reduce(rec, { type: 'hide' }).state.screen).toBe('recording')
  })

  it('timerEnded peeks with the next drill name, or wrap up after the last', () => {
    let r = run(inDark(), { type: 'timerEnded' })
    expect(r.state).toMatchObject({ screen: 'peek', status: 'Time · next: Holds' })
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
    r = run(inDark(), { type: 'swipeDown' }, { type: 'listSelect', index: 1, now: 5 }, { type: 'hide' }, { type: 'timerEnded' })
    expect(r.state.status).toBe('Time · next: wrap up')
  })

  it('tap to talk, tap to send, card then timeout back to dark', () => {
    let r = run(inPeek(), { type: 'tap' })
    expect(r.state.screen).toBe('recording')
    r = run(r.state, { type: 'tap' })
    expect(r.effects).toContainEqual({ type: 'stopMicAndSend', mode: 'note', sessionId: 's1', drillId: 'd1' })
    r = run(r.state, { type: 'utteranceResult', res: { utteranceId: 'u1', transcript: 't', cardLines: ['✓ Priya · guard (3rd time)'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null } })
    expect(r.state.screen).toBe('card')
    expect(r.state.coverage.covered).toBe(1)
    expect(r.effects).toContainEqual({ type: 'scheduleCardTimeout', ms: CARD_MS })
    r = run(r.state, { type: 'cardTimeout' })
    expect(r.state.screen).toBe('dark')
  })

  it('double-tap on a card undoes', () => {
    let r = run(inDark(), { type: 'tap' }, { type: 'tap' },
      { type: 'utteranceResult', res: { utteranceId: 'u1', transcript: 't', cardLines: ['✓ x'], coverage: cov, nextStudent: null, disambiguation: null } })
    r = run(r.state, { type: 'doubleTap' })
    expect(r.effects).toContainEqual({ type: 'undo', utteranceId: 'u1' })
    expect(r.state).toMatchObject({ screen: 'peek', status: 'Undone' })
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
  })

  it('long press records and release sends', () => {
    let r = run(inDark(), { type: 'longPress' })
    expect(r.state.screen).toBe('recording')
    r = run(r.state, { type: 'longPressRelease' })
    expect(r.state.screen).toBe('sending')
  })

  it('queued and empty results show a one-line peek with a status, then hide', () => {
    let r = run(inDark(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceQueued' })
    expect(r.state).toMatchObject({ screen: 'peek', status: '● Saved · will sync' })
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
    r = run(inDark(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceEmpty' })
    expect(r.state.status).toBe("Didn't catch that · tap to retry")
    r = run(r.state, { type: 'hide' })
    expect(r.state).toMatchObject({ screen: 'dark', status: null })
  })

  it('disambiguation picks a student', () => {
    let r = run(inDark(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: {
      utteranceId: 'u', transcript: 't', cardLines: [], coverage: cov, nextStudent: null,
      disambiguation: { noteId: 'n1', heard: 'Mya', options: [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Mia Lopez' }] } } })
    expect(r.state.screen).toBe('disambiguation')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.effects).toContainEqual({ type: 'assignNote', noteId: 'n1', studentId: 'b' })
    expect(r.state.screen).toBe('dark')
  })

  it('swipe opens deck; selecting switches drill and peeks', () => {
    let r = run(inDark(), { type: 'swipeDown' })
    expect(r.state.screen).toBe('deck')
    r = run(r.state, { type: 'listSelect', index: 1 })
    expect(r.state.screen).toBe('peek')
    expect(r.state.active?.drillId).toBe('d2')
    expect(r.effects).toContainEqual({ type: 'logDrill', sessionId: 's1', drillId: 'd2', event: 'start' })
    expect(run(inDark(), { type: 'swipeDown' }, { type: 'doubleTap' }).state.screen).toBe('dark')
  })

  it('end class needs confirm, then wrap-up and remind', () => {
    let r = run(inDark(), { type: 'doubleTap' })
    expect(r.state.screen).toBe('confirmEnd')
    r = run(r.state, { type: 'swipeUp' })
    expect(r.state.screen).toBe('dark')
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
  const wrapEnd = () => run(inDark(), { type: 'doubleTap' }, { type: 'tap' })

  it('failed end-class escapes the wrapup spinner and keeps the session', () => {
    let r = wrapEnd()
    expect(r.state).toMatchObject({ screen: 'wrapup', wrapup: null })
    r = run(r.state, { type: 'actionFailed', message: 'offline' })
    expect(r.state).toMatchObject({ screen: 'peek', status: "Couldn't end class · offline" })
    expect(r.state.session?.id).toBe('s1')
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
    expect(run(wrapEnd().state, { type: 'doubleTap' }).state.screen).toBe('dark')
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
    expect(r.effects).toContainEqual({ type: 'scheduleHide', ms: PEEK_MS })
  })

  it('double-tap in sending escapes to dark', () => {
    expect(run(inDark(), { type: 'tap' }, { type: 'tap' }, { type: 'doubleTap' }).state.screen).toBe('dark')
  })

  it('attendance empty/queued report that roll call was not saved', () => {
    const att = () => run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'sessionStarted', res: resumeRes, resumed: false, now: 1 }, { type: 'tap' })
    expect(run(att().state, { type: 'utteranceEmpty' }).state.status).toBe('Roll call not saved · use phone roster')
    expect(run(att().state, { type: 'utteranceQueued' }).state.status).toBe('Roll call not saved · use phone roster')
  })

  it('clears the card on disambiguation skip and pick', () => {
    const dis = () => run(inDark(), { type: 'tap' }, { type: 'tap' }, { type: 'utteranceResult', res: {
      utteranceId: 'u', transcript: 't', cardLines: [], coverage: cov, nextStudent: null,
      disambiguation: { noteId: 'n1', heard: 'Mya', options: [{ id: 'a', name: 'Maya Chen' }, { id: 'b', name: 'Mia Lopez' }] } } }).state
    expect(run(dis(), { type: 'doubleTap' }).state.card).toBeNull()
    expect(run(dis(), { type: 'listSelect', index: 0 }).state.card).toBeNull()
  })

  it('cancel paths emit cancelMic; firstRun tap loads today', () => {
    expect(run(inDark(), { type: 'tap' }, { type: 'doubleTap' }).effects).toContainEqual({ type: 'cancelMic' })
    const att = run(initialState(true), { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'sessionStarted', res: resumeRes, resumed: false, now: 1 }, { type: 'doubleTap' })
    expect(att.effects).toContainEqual({ type: 'cancelMic' })
    expect(att.state).toMatchObject({ screen: 'peek', status: 'Roll call skipped · use phone' })
    expect(run(initialState(false), { type: 'tap' }).effects).toContainEqual({ type: 'loadToday' })
  })
})
