import { describe, expect, it } from 'vitest'
import type { Insight, Today } from '@matside/shared'
import { autoDismisses, autoHides, initialState, reduce, resultKey } from './reducer'
import { render } from './render'
import type { Effect, LensEvent, LensState } from './state'

const today = {
  classId: 'c1', className: 'Kids · Tue', startTime: '17:00', forDate: '2026-10-20', sessionId: null, theme: 'Stances', formsDue: [], focus: [], roster: [],
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'drill', people: 'students',
  deck: { id: 'k1', classId: 'c1', forDate: '2026-10-20', status: 'draft', drills: [
    { id: 'd1', position: 1, name: 'Tag', minutes: 5, kind: 'warmup', cues: [], focusStudentIds: [], rationale: '', startedAt: null, endedAt: null },
  ] },
} as unknown as Today
const cov = { covered: 0, present: 12 }
type Acc = { state: LensState; effects: Effect[] }
const run = (s: LensState, ...events: LensEvent[]) => events.reduce<Acc>((acc, e) => {
  const r = reduce(acc.state, e); return { state: r.state, effects: [...acc.effects, ...r.effects] }
}, { state: s, effects: [] })
const inPeek = (mode: 'quiet' | 'standard' = 'quiet') => run(initialState(true), { type: 'displayModeLoaded', mode }, { type: 'todayLoaded', today }, { type: 'tap' }, { type: 'tap' },
  { type: 'sessionStarted', res: { sessionId: 's1', startedAt: '2026-10-20T00:00:00Z', coverage: cov, nextStudent: null }, resumed: true, now: 1000 }).state
const note = (utteranceId = 'u1') => ({ type: 'utteranceResult' as const, res: { utteranceId, transcript: 'Maya black belt', cardLines: ['√ Maya rank: black'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null } })
const onCard = (mode: 'quiet' | 'standard' = 'quiet') => run(inPeek(mode), { type: 'tap' }, { type: 'tap' }, note()).state
const text = (s: LensState) => render(s, 2000).texts.map(t => t.content).join('\n')
const insight: Insight = { id: 'i1', kind: 'returning_student', studentId: 's', studentName: 'Jake', classId: 'c1', title: "Jake's back", detail: 'Missed 3 classes', urgency: 'high', status: 'new', createdAt: '2026-10-20T00:00:00Z', actionLabel: null }

describe('F02 · undo waits for the server', () => {
  it('double-tap on the card shows "Undoing…" (never an optimistic "Undone") and asks the server', () => {
    const r = run(onCard(), { type: 'doubleTap' })
    expect(r.state.screen).toBe('undo')
    expect(r.state.undo).toMatchObject({ utteranceId: 'u1', stage: 'pending' })
    expect(r.effects).toContainEqual({ type: 'undo', utteranceId: 'u1' })
    expect(text(r.state)).toContain('Undoing…')
    expect(text(r.state)).not.toMatch(/Undone/)
    expect(r.state.status).not.toBe('Undone')
  })

  it('a slow response keeps "Undoing…" through unrelated events, then renders the server lines', () => {
    let s = run(onCard(), { type: 'doubleTap' }).state
    s = run(s, { type: 'statusExpired' }, { type: 'outboxChanged', count: 1 }, { type: 'thinkingTick' }, { type: 'resultTimeout' }, { type: 'idleTimeout' }).state
    expect(s.screen).toBe('undo')
    expect(text(s)).toContain('Undoing…')
    s = run(s, { type: 'undoResult', utteranceId: 'u1', res: { reversed: ['Restored Maya rank: brown'], cancelled: ['Cancelled email draft for Dee'], notReversible: [] } }).state
    expect(s.undo?.stage).toBe('done')
    const t = text(s)
    expect(t).toContain('UNDONE')
    expect(t).toContain('Restored Maya rank: brown')
    expect(t).toContain('Cancelled email draft for Dee')
  })

  it('names what could not be reversed (sent email) instead of claiming success', () => {
    const s = run(onCard(), { type: 'doubleTap' }, { type: 'undoResult', utteranceId: 'u1', res: { reversed: ['Removed Dee note'], cancelled: [], notReversible: ["Email already sent to Dee's family"] } }).state
    const t = text(s)
    expect(t).toContain('PARTLY UNDONE')
    expect(t).toContain("Email already sent to Dee's family")
  })

  it('failure shows "Undo failed · tap to retry"; tap retries; double-tap closes', () => {
    let r = run(onCard(), { type: 'doubleTap' }, { type: 'undoFailed', utteranceId: 'u1', kind: 'error', message: 'Offline' })
    expect(r.state.undo?.stage).toBe('failed')
    expect(text(r.state)).toContain('Undo failed · tap to retry')
    r = run(r.state, { type: 'tap' })
    expect(r.state.undo?.stage).toBe('pending')
    expect(r.effects).toContainEqual({ type: 'undo', utteranceId: 'u1' })
    r = run(r.state, { type: 'undoFailed', utteranceId: 'u1', kind: 'error', message: 'Offline' }, { type: 'doubleTap' })
    expect(r.state).toMatchObject({ screen: 'peek', undo: null })
  })

  it('a 409 shows "Already undone"; a 404 says nothing to undo', () => {
    const a = run(onCard(), { type: 'doubleTap' }, { type: 'undoFailed', utteranceId: 'u1', kind: 'already', message: '' }).state
    expect(text(a)).toContain('Already undone')
    const m = run(onCard(), { type: 'doubleTap' }, { type: 'undoFailed', utteranceId: 'u1', kind: 'missing', message: '' }).state
    expect(text(m)).toMatch(/Nothing to undo/)
  })

  it('leaving "Undoing…" early: the late result becomes a status line, never a false success', () => {
    let s = run(onCard(), { type: 'doubleTap' }, { type: 'tap' }).state
    expect(s.screen).toBe('peek')
    expect(s.status).toBe('Undoing…')
    s = run(s, { type: 'undoResult', utteranceId: 'u1', res: { reversed: ['Removed Priya note'], cancelled: [], notReversible: ['Email already sent'] } }).state
    expect(s.status).toBe('Undone · 1 change · 1 not reversible')
    const f = run(onCard(), { type: 'doubleTap' }, { type: 'tap' }, { type: 'undoFailed', utteranceId: 'u1', kind: 'error', message: 'Offline' }).state
    expect(f.status).toBe('Undo failed · Offline')
  })

  it('a result for another utterance is ignored', () => {
    const s = run(onCard(), { type: 'doubleTap' }, { type: 'undoResult', utteranceId: 'other', res: { reversed: ['x'], cancelled: [], notReversible: [] } }).state
    expect(s.undo?.stage).toBe('pending')
  })
})

describe('C6 · quiet display policy (F06)', () => {
  it('quiet is the default', () => {
    expect(initialState(true).displayMode).toBe('quiet')
  })

  it('in class, the idle peek auto-hides to dark on idleTimeout (quiet only)', () => {
    const q = inPeek('quiet')
    expect(autoHides(q)).toBe(true)
    expect(run(q, { type: 'idleTimeout' }).state).toMatchObject({ screen: 'dark', darkFrom: 'peek' })
    const st = inPeek('standard')
    expect(autoHides(st)).toBe(false)
    expect(run(st, { type: 'idleTimeout' }).state.screen).toBe('peek')
    // before class nothing auto-hides
    expect(autoHides(run(initialState(true), { type: 'todayLoaded', today }).state)).toBe(false)
  })

  it('a stale idleTimeout (the coach is recording) changes nothing', () => {
    const rec = run(inPeek(), { type: 'tap' }).state
    expect(run(rec, { type: 'idleTimeout' }).state.screen).toBe('recording')
  })

  it('result cards auto-dismiss in quiet mode; provisional cards and standard mode stay', () => {
    const c = onCard('quiet')
    expect(autoDismisses(c)).toBe(true)
    expect(run(c, { type: 'resultTimeout' }).state).toMatchObject({ screen: 'peek', card: null })
    expect(autoDismisses(onCard('standard'))).toBe(false)
    expect(run(onCard('standard'), { type: 'resultTimeout' }).state.screen).toBe('card')
    const prov = run(inPeek(), { type: 'tap' }, { type: 'tap' }, { type: 'transcriptReady', transcript: 'hi' }).state
    expect(autoDismisses(prov)).toBe(false)
    const undone = run(c, { type: 'doubleTap' }, { type: 'undoResult', utteranceId: 'u1', res: { reversed: ['x'], cancelled: [], notReversible: [] } }).state
    expect(autoDismisses(undone)).toBe(true)
    const failed = run(c, { type: 'doubleTap' }, { type: 'undoFailed', utteranceId: 'u1', kind: 'error', message: 'Offline' }).state
    expect(autoDismisses(failed)).toBe(false) // the retry must stay reachable
  })

  it('the result timer key changes on a new card or a page turn, not on agent progress', () => {
    const c = onCard()
    const progressed = run(c, { type: 'runsLoaded', utteranceId: 'u1', runs: [], final: false }).state
    expect(resultKey(progressed)).toBe(resultKey(c))
    expect(resultKey(run(c, { type: 'doubleTap' }).state)).not.toBe(resultKey(c))
  })

  it('a nod wakes the dark lens', () => {
    const dark = run(inPeek(), { type: 'idleTimeout' }).state
    expect(run(dark, { type: 'nod' }).state.screen).toBe('peek')
  })

  it('displayModeLoaded switches the policy', () => {
    expect(run(inPeek('quiet'), { type: 'displayModeLoaded', mode: 'standard' }).state.displayMode).toBe('standard')
  })
})

describe('C6 · tap always records during class (F12, F13)', () => {
  it('tap on the dark lens wakes AND records in one action', () => {
    const dark = run(inPeek(), { type: 'idleTimeout' }).state
    const r = run(dark, { type: 'tap', now: 5000 })
    expect(r.state.screen).toBe('recording')
    expect(r.effects).toContainEqual({ type: 'startMic' })
  })

  it('tap during an insight banner records (the banner waits behind ★)', () => {
    const b = run(inPeek(), { type: 'insightsLoaded', scope: 'session', insights: [insight] }).state
    expect(b.insightBanner?.id).toBe('i1')
    const r = run(b, { type: 'tap', now: 5000 })
    expect(r.state.screen).toBe('recording')
    expect(r.effects).toContainEqual({ type: 'startMic' })
    expect(r.state.insightBanner).toBeNull()
    expect(r.state.insightUnseen.map(i => i.id)).toEqual(['i1'])
  })

  it('swipe on the banner opens its detail (seeing it dismisses it); tap there records too', () => {
    const b = run(inPeek(), { type: 'insightsLoaded', scope: 'session', insights: [insight] }).state
    const open = run(b, { type: 'swipeDown' }).state
    expect(open).toMatchObject({ screen: 'insight', insightBanner: null })
    expect(run(open, { type: 'swipeDown' }).state.screen).toBe('peek')
    expect(run(open, { type: 'doubleTap' }).state.screen).toBe('peek')
    expect(run(open, { type: 'tap' }).state.screen).toBe('recording')
  })

  it('before class a tap on the dark lens only wakes it (never records)', () => {
    const home = run(initialState(true), { type: 'todayLoaded', today }, { type: 'nod' }).state
    expect(home.screen).toBe('dark')
    expect(run(home, { type: 'tap' }).state.screen).toBe('home')
  })

  it('double-tap in class is cancel / undo / end-class confirm, with a hint on screen', () => {
    const p = inPeek()
    expect(run(p, { type: 'doubleTap' }).state.screen).toBe('confirmEnd')
    expect(run(run(p, { type: 'tap' }).state, { type: 'doubleTap' }).state.status).toBe('Cancelled')
    expect(run(onCard(), { type: 'doubleTap' }).state.screen).toBe('undo')
    const bare = run(inPeek(), { type: 'coverageUpdated', coverage: { covered: 0, present: 0 }, nextStudent: null }).state
    expect(text(bare)).toContain('tap: note · swipe: deck · 2×: end')
    expect(text(run(inPeek(), { type: 'insightsLoaded', scope: 'session', insights: [insight] }).state)).toContain('tap: note · swipe: open insight')
    expect(text(onCard())).toMatch(/2×: undo/)
  })
})

describe('F07 · queued and failed notes on the lens', () => {
  it('the status line shows queued and failed counts', () => {
    const s = run(inPeek('standard'), { type: 'outboxChanged', count: 2 }, { type: 'failedChanged', count: 1 }).state
    const t = render(s, 2000).texts.find(x => x.name === 'next')!.content
    expect(t).toContain('2 queued')
    expect(t).toContain('1 failed')
  })

  it('a queued note says the true reason; a rejected one is "Not sent", never "didn\'t catch that"', () => {
    const sending = run(inPeek(), { type: 'tap' }, { type: 'tap' }).state
    expect(run(sending, { type: 'utteranceQueued', reason: 'rate_limited' }).state.status).toBe('● Saved · server busy, will retry')
    expect(run(sending, { type: 'utteranceQueued', reason: 'offline' }).state.status).toBe('● Saved · offline, will sync')
    expect(run(sending, { type: 'utteranceQueued', reason: 'unpaired' }).state.status).toBe('● Saved · pair phone to sync')
    const f = run(sending, { type: 'utteranceFailed', reason: 'Recording too large to send' }).state
    expect(f.status).toBe('Not sent · see phone · Recording too large to send')
    expect(f.status).not.toMatch(/catch/i)
  })

  it('a background flush result is visible on the lens', () => {
    const p = inPeek('standard')
    expect(run(p, { type: 'outboxSynced', sent: 2, failed: 0 }).state.status).toBe('↑ 2 notes sent')
    expect(run(p, { type: 'outboxSynced', sent: 1, failed: 1 }).state.status).toBe('1 note not sent · see phone')
    const r = run(p, { type: 'outboxSynced', sent: 0, failed: 0 })
    expect(r.state).toBe(p)
  })
})

describe('F14 · low-energy recovery on the lens', () => {
  it('a recording with no speech energy says how to recover, not "didn\'t catch that"', () => {
    const sending = run(inPeek(), { type: 'tap' }, { type: 'tap' }).state
    const s = run(sending, { type: 'utteranceEmpty', reason: 'quiet' }).state
    expect(s.status).toBe("Couldn't hear you · move closer, speak up")
  })
})
