import type { Effect, LensEvent, LensState, Mode, Screen } from './state'

export const CARD_MS = 4000
export const PEEK_MS = 5000
type R = { state: LensState; effects: Effect[] }
const done = (state: LensState, ...effects: Effect[]): R => ({ state, effects })
const ROLL_NOT_SAVED = 'Roll call not saved · use phone roster'
const hide: Effect = { type: 'scheduleHide', ms: PEEK_MS }

export function initialState(firstRunSeen: boolean): LensState {
  return {
    screen: firstRunSeen ? 'home' : 'firstRun', today: null, session: null, active: null,
    coverage: { covered: 0, present: 0 }, nextStudent: null, card: null, disambiguation: null, wrapup: null,
    pending: null, attendanceLines: [], status: null, loadError: null, starting: false,
  }
}

const drills = (s: LensState) => s.today?.deck.drills ?? []

function peek(s: LensState, status: string | null): R {
  return done({ ...s, screen: 'peek', status }, hide)
}

function startDrill(s: LensState, index: number, now: number): R {
  const d = drills(s)[index]
  if (!d || !s.session) return done({ ...s, screen: 'dark' })
  const effects: Effect[] = []
  if (s.active && s.active.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: s.active.drillId, event: 'end' })
  if (s.active?.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: d.id, event: 'start' })
  const active = s.active?.drillId === d.id ? s.active : { drillId: d.id, startedAt: now }
  return { state: { ...s, screen: 'peek', active, status: null }, effects: [...effects, hide] }
}

function startClass(s: LensState, classId: string): R {
  if (s.starting) return done(s)
  return done({ ...s, starting: true }, { type: 'startSession', classId })
}

/** Resume at the drill already in progress (started, not ended); else begin the first drill. */
function resumeDrill(s: LensState, now: number): R {
  const live = drills(s).find(d => d.startedAt != null && d.endedAt == null)
  if (!live || !live.startedAt) return startDrill(s, 0, now)
  return done({ ...s, screen: 'peek', active: { drillId: live.id, startedAt: Date.parse(live.startedAt) }, status: null }, hide)
}

function record(s: LensState, mode: Mode, returnTo: Screen, viaLongPress: boolean): R {
  return done({ ...s, screen: mode === 'attendance' ? 'attendance' : 'recording', pending: { mode, returnTo, viaLongPress }, status: null }, { type: 'startMic' })
}

function send(s: LensState): R {
  if (!s.pending || !s.session) return done({ ...s, screen: 'dark', pending: null })
  return done({ ...s, screen: 'sending' }, { type: 'stopMicAndSend', mode: s.pending.mode, sessionId: s.session.id, drillId: s.pending.mode === 'note' ? s.active?.drillId ?? null : null })
}

/** Leave a capture flow: a status shows as a brief peek, otherwise the lens goes dark. */
function back(s: LensState, status: string | null): R {
  const cleared = { ...s, pending: null }
  return status ? peek(cleared, status) : done({ ...cleared, screen: 'dark', status: null })
}

export function reduce(s: LensState, e: LensEvent): R {
  const now = 'now' in e && typeof e.now === 'number' ? e.now : Date.now()

  // Data events apply on any screen.
  switch (e.type) {
    case 'todayLoaded': return done({ ...s, today: e.today, loadError: null })
    case 'loadFailed': return done({ ...s, loadError: e.message })
    case 'coverageUpdated': return done({ ...s, coverage: e.coverage, nextStudent: e.nextStudent })
    case 'resumed': return done(s, { type: 'loadToday' }, { type: 'flushOutbox' })
    case 'startRequested': return s.screen === 'home' && s.today ? startClass(s, s.today.classId) : done(s)
    case 'actionFailed': {
      if (s.screen === 'wrapup' && !s.wrapup) return peek(s, `Couldn't end class · ${e.message}`)
      return done({ ...s, starting: false, loadError: s.screen === 'home' ? e.message : s.loadError })
    }
    case 'sessionStarted': {
      if (s.session?.id === e.res.sessionId) return done(s)
      const next = { ...s, starting: false, session: { id: e.res.sessionId, startedAt: Date.parse(e.res.startedAt) }, coverage: e.res.coverage, nextStudent: e.res.nextStudent }
      return e.resumed ? resumeDrill(next, e.now) : record(next, 'attendance', 'dark', false)
    }
    case 'micFailed': return back(s, 'Mic unavailable · check permission')
    case 'utteranceQueued': return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : '● Saved · will sync')
    case 'utteranceEmpty': return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : "Didn't catch that · tap to retry")
    case 'utteranceResult': {
      const base = { ...s, coverage: e.res.coverage, nextStudent: e.res.nextStudent, pending: null }
      if (s.pending?.mode === 'attendance') return done({ ...base, screen: 'attendanceDone', attendanceLines: e.res.cardLines })
      const card = { lines: e.res.cardLines, utteranceId: e.res.utteranceId }
      if (e.res.disambiguation) return done({ ...base, screen: 'disambiguation', disambiguation: e.res.disambiguation, card })
      if (!card.lines.length) return done({ ...base, screen: 'dark' })
      return done({ ...base, screen: 'card', card }, { type: 'scheduleCardTimeout', ms: CARD_MS })
    }
    case 'wrapupLoaded': return done({ ...s, screen: 'wrapup', wrapup: e.wrapup })
    case 'cardTimeout': return s.screen === 'card' ? done({ ...s, screen: 'dark', card: null }) : done(s)
    case 'hide': return s.screen === 'peek' ? done({ ...s, screen: 'dark', status: null }) : done(s)
    case 'headTilt': return s.screen === 'dark' ? done({ ...s, screen: 'peek', status: null }, hide) : done(s)
    case 'timerEnded': {
      if (!s.session || !s.active || (s.screen !== 'dark' && s.screen !== 'peek')) return done(s)
      const list = drills(s)
      const i = list.findIndex(d => d.id === s.active?.drillId)
      const next = list[i + 1]?.name ?? 'wrap up'
      return peek(s, `Time · next: ${next}`)
    }
  }

  // Gestures depend on the screen.
  switch (s.screen) {
    case 'firstRun':
      return e.type === 'tap' ? done({ ...s, screen: 'home' }, { type: 'markFirstRunSeen' }, { type: 'loadToday' }) : done(s)
    case 'home':
      if (e.type === 'doubleTap') return done(s, { type: 'exit' })
      if (e.type === 'tap') return s.today ? startClass(s, s.today.classId) : done(s, { type: 'loadToday' })
      return done(s)
    case 'attendance':
      if (e.type === 'tap') return send(s)
      if (e.type === 'doubleTap') return done({ ...s, screen: 'peek', pending: null, status: 'Roll call skipped · use phone' }, { type: 'cancelMic' }, hide)
      return done(s)
    case 'attendanceDone':
      return e.type === 'tap' ? startDrill(s, 0, now) : done(s)
    case 'dark':
    case 'peek':
      if (e.type === 'tap') return record(s, 'note', 'dark', false)
      if (e.type === 'longPress') return record(s, 'note', 'dark', true)
      if (e.type === 'swipeUp' || e.type === 'swipeDown') return done({ ...s, screen: 'deck', status: null })
      if (e.type === 'doubleTap') return done({ ...s, screen: 'confirmEnd', status: null })
      return done(s)
    case 'deck':
      if (e.type === 'listSelect') return startDrill(s, e.index, now)
      if (e.type === 'doubleTap') return done({ ...s, screen: 'dark' })
      return done(s)
    case 'recording':
      if (e.type === 'tap') return send(s)
      if (e.type === 'longPressRelease' && s.pending?.viaLongPress) return send(s)
      if (e.type === 'doubleTap') {
        const r = back(s, 'Cancelled')
        return { state: r.state, effects: [{ type: 'cancelMic' }, ...r.effects] }
      }
      return done(s)
    case 'sending':
      return e.type === 'doubleTap' ? done({ ...s, screen: 'dark' }) : done(s)
    case 'card':
      if (e.type === 'doubleTap' && s.card?.utteranceId) return done({ ...s, screen: 'peek', card: null, status: 'Undone' }, { type: 'undo', utteranceId: s.card.utteranceId }, hide)
      return done({ ...s, screen: 'dark', card: null })
    case 'disambiguation': {
      if (e.type === 'listSelect' && s.disambiguation) {
        const pick = s.disambiguation.options[e.index]
        const after = s.card?.lines.length ? 'card' : 'dark'
        const effects: Effect[] = pick ? [{ type: 'assignNote', noteId: s.disambiguation.noteId, studentId: pick.id }] : []
        if (after === 'card') effects.push({ type: 'scheduleCardTimeout', ms: CARD_MS })
        return { state: { ...s, screen: after, disambiguation: null, card: after === 'card' ? s.card : null, status: null }, effects }
      }
      if (e.type === 'doubleTap') return peek({ ...s, disambiguation: null, card: null }, '● Saved to Review')
      return done(s)
    }
    case 'confirmEnd':
      if (e.type === 'tap' && s.session) return done({ ...s, screen: 'wrapup', wrapup: null }, { type: 'endSession', sessionId: s.session.id })
      return done({ ...s, screen: 'dark' })
    case 'wrapup': {
      if (!s.wrapup && e.type === 'doubleTap') return done({ ...s, screen: 'dark' })
      if (!s.wrapup || !s.session) return done(s)
      const reset = { ...s, screen: 'home' as const, session: null, active: null, wrapup: null, card: null, status: null, coverage: { covered: 0, present: 0 }, nextStudent: null }
      if (e.type === 'tap') return done(reset, { type: 'remind', sessionId: s.session.id, studentIds: s.wrapup.missed.map(m => m.id) }, { type: 'loadToday' })
      if (e.type === 'doubleTap') return done(reset, { type: 'loadToday' })
      return done(s)
    }
  }
}
