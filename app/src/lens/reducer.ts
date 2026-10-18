import type { Effect, LensEvent, LensState, Mode, Screen } from './state'
import { transcriptPages } from './text'

/** How long a one-line status (e.g. "Saved · will sync") stays on the peek before the next-kid line returns. */
export const STATUS_MS = 5000
type R = { state: LensState; effects: Effect[] }
const done = (state: LensState, ...effects: Effect[]): R => ({ state, effects })
const ROLL_NOT_SAVED = 'Roll call not saved · use phone roster'
const expire: Effect = { type: 'expireStatus', ms: STATUS_MS }

export function initialState(firstRunSeen: boolean): LensState {
  return {
    screen: firstRunSeen ? 'home' : 'firstRun', today: null, classes: [], selectedClassId: null, session: null, active: null,
    coverage: { covered: 0, present: 0 }, nextStudent: null, card: null, disambiguation: null, wrapup: null,
    pending: null, attendanceLines: [], status: null, loadError: null, starting: false,
  }
}

const drills = (s: LensState) => s.today?.deck.drills ?? []

/** The class-time rest screen. It stays up (no auto-hide); a status line expires after STATUS_MS. */
function peek(s: LensState, status: string | null = null, ...effects: Effect[]): R {
  return done({ ...s, screen: 'peek', status }, ...effects, ...(status ? [expire] : []))
}

function startDrill(s: LensState, index: number, now: number): R {
  const d = drills(s)[index]
  if (!d || !s.session) return peek(s)
  const effects: Effect[] = []
  if (s.active && s.active.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: s.active.drillId, event: 'end' })
  if (s.active?.drillId !== d.id) effects.push({ type: 'logDrill', sessionId: s.session.id, drillId: d.id, event: 'start' })
  const active = s.active?.drillId === d.id ? s.active : { drillId: d.id, startedAt: now }
  return peek({ ...s, active }, null, ...effects)
}

function startClass(s: LensState, classId: string): R {
  if (s.starting) return done(s)
  return done({ ...s, starting: true }, { type: 'startSession', classId })
}

/** Resume at the drill already in progress (started, not ended); else begin the first drill. */
function resumeDrill(s: LensState, now: number): R {
  const live = drills(s).find(d => d.startedAt != null && d.endedAt == null)
  if (!live || !live.startedAt) return startDrill(s, 0, now)
  return peek({ ...s, active: { drillId: live.id, startedAt: Date.parse(live.startedAt) } })
}

function record(s: LensState, mode: Mode, returnTo: Screen, viaLongPress: boolean): R {
  return done({ ...s, screen: mode === 'attendance' ? 'attendance' : 'recording', pending: { mode, returnTo, viaLongPress }, status: null }, { type: 'startMic' })
}

function send(s: LensState): R {
  if (!s.pending || !s.session) return peek({ ...s, pending: null })
  return done({ ...s, screen: 'sending' }, { type: 'stopMicAndSend', mode: s.pending.mode, sessionId: s.session.id, drillId: s.pending.mode === 'note' ? s.active?.drillId ?? null : null })
}

/** Leave a capture flow back to the rest screen (peek), optionally with a status line. */
const back = (s: LensState, status: string | null): R => peek({ ...s, pending: null }, status)

/** Home: swipe cycles through the coach's classes. The pick is saved and its `today` loads. */
function cycleClass(s: LensState, step: 1 | -1): R {
  const n = s.classes.length
  if (n < 2 || s.starting) return done(s)
  const current = s.selectedClassId ?? s.today?.classId
  const i = s.classes.findIndex(c => c.id === current)
  const next = s.classes[((i < 0 ? 0 : i + step) + n) % n]!
  if (next.id === current) return done(s)
  return done({ ...s, selectedClassId: next.id, loadError: null }, { type: 'selectClass', classId: next.id })
}

function homeTap(s: LensState): R {
  if (s.selectedClassId && s.today?.classId !== s.selectedClassId) {
    // The shown class is not loaded: retry its day after a failure (KV already holds it); never start the old class.
    return s.loadError ? done({ ...s, loadError: null }, { type: 'loadToday' }) : done(s)
  }
  return s.today ? startClass(s, s.today.classId) : done(s, { type: 'loadToday' }, { type: 'loadClasses' })
}

function utteranceResult(s: LensState, e: Extract<LensEvent, { type: 'utteranceResult' }>): R {
  const base = { ...s, coverage: e.res.coverage, nextStudent: e.res.nextStudent, pending: null }
  if (s.pending?.mode === 'attendance') return done({ ...base, screen: 'attendanceDone', attendanceLines: e.res.cardLines })
  const card = { lines: e.res.cardLines, transcript: e.res.transcript, utteranceId: e.res.utteranceId, runs: null, runsFinal: false, page: 0 }
  const poll: Effect[] = card.utteranceId ? [{ type: 'pollRuns', utteranceId: card.utteranceId }] : []
  if (e.res.disambiguation) return done({ ...base, screen: 'disambiguation', disambiguation: e.res.disambiguation, card }, ...poll)
  if (!card.lines.length && !card.transcript) return peek(base)
  return done({ ...base, screen: 'card', card, status: null }, ...poll)
}

/** Events that carry data or timers: they apply on any screen. Null = not one of them. */
function dataEvent(s: LensState, e: LensEvent): R | null {
  switch (e.type) {
    case 'todayLoaded': return done({ ...s, today: e.today, loadError: null, selectedClassId: null })
    case 'classesLoaded': return done({ ...s, classes: e.classes })
    case 'loadFailed': return done({ ...s, loadError: e.message }) // a pending lens pick stays: tap retries it
    case 'coverageUpdated': return done({ ...s, coverage: e.coverage, nextStudent: e.nextStudent })
    case 'resumed': return done(s, { type: 'loadToday' }, { type: 'loadClasses' }, { type: 'flushOutbox' })
    case 'startRequested': return s.screen === 'home' ? homeTap(s) : done(s)
    case 'actionFailed': {
      if (s.screen === 'wrapup' && !s.wrapup) return peek(s, `Couldn't end class · ${e.message}`)
      return done({ ...s, starting: false, loadError: s.screen === 'home' ? e.message : s.loadError })
    }
    case 'sessionStarted': {
      if (s.session?.id === e.res.sessionId) return done(s)
      const next = { ...s, starting: false, session: { id: e.res.sessionId, startedAt: Date.parse(e.res.startedAt) }, coverage: e.res.coverage, nextStudent: e.res.nextStudent }
      return e.resumed ? resumeDrill(next, e.now) : record(next, 'attendance', 'peek', false)
    }
    case 'micFailed': return back(s, 'Mic unavailable · check permission')
    case 'utteranceQueued': return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : '● Saved · will sync')
    case 'utteranceEmpty': return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : "Didn't catch that · tap to retry")
    case 'utteranceResult': return utteranceResult(s, e)
    case 'runsLoaded': {
      if (!s.card || s.card.utteranceId !== e.utteranceId) return done(s)
      return done({ ...s, card: { ...s.card, runs: e.runs ?? s.card.runs, runsFinal: e.final } })
    }
    case 'wrapupLoaded': return done({ ...s, screen: 'wrapup', wrapup: e.wrapup })
    case 'statusExpired': return s.status ? done({ ...s, status: null }) : done(s)
    case 'nod':
      if (s.screen === 'peek') return done({ ...s, screen: 'dark', status: null })
      return s.screen === 'dark' ? peek(s) : done(s)
    case 'timerEnded': {
      if (!s.session || !s.active || (s.screen !== 'dark' && s.screen !== 'peek')) return done(s)
      const list = drills(s)
      const i = list.findIndex(d => d.id === s.active?.drillId)
      const next = list[i + 1]?.name ?? 'wrap up'
      return peek(s, `Time · next: ${next}`)
    }
  }
  return null
}

export function reduce(s: LensState, e: LensEvent): R {
  const now = 'now' in e && typeof e.now === 'number' ? e.now : Date.now()
  const data = dataEvent(s, e)
  if (data) return data

  // Gestures depend on the screen.
  switch (s.screen) {
    case 'firstRun':
      if (e.type === 'doubleTap') return done(s, { type: 'exit' }) // root screen: platform exit rule
      return e.type === 'tap' ? done({ ...s, screen: 'home' }, { type: 'markFirstRunSeen' }, { type: 'loadToday' }, { type: 'loadClasses' }) : done(s)
    case 'home':
      if (e.type === 'doubleTap') return done(s, { type: 'exit' })
      if (e.type === 'tap') return homeTap(s)
      if (e.type === 'swipeDown') return cycleClass(s, 1)
      if (e.type === 'swipeUp') return cycleClass(s, -1)
      return done(s)
    case 'attendance':
      if (e.type === 'tap') return send(s)
      if (e.type === 'doubleTap') {
        const r = back(s, 'Roll call skipped · use phone')
        return { state: r.state, effects: [{ type: 'cancelMic' }, ...r.effects] }
      }
      return done(s)
    case 'attendanceDone':
      return e.type === 'tap' ? startDrill(s, 0, now) : done(s)
    case 'dark':
      // The lens is off by choice: a tap only wakes it (never records). Other gestures work as in peek.
      if (e.type === 'tap') return peek(s)
      return restGesture(s, e)
    case 'peek':
      if (e.type === 'tap') return record(s, 'note', 'peek', false)
      return restGesture(s, e)
    case 'deck':
      if (e.type === 'listSelect') return startDrill(s, e.index, now)
      if (e.type === 'doubleTap') return peek(s)
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
      return e.type === 'doubleTap' ? peek(s) : done(s)
    case 'card':
      // The card stays until tapped away; double-tap undoes.
      if (e.type === 'doubleTap' && s.card?.utteranceId) return peek({ ...s, card: null }, 'Undone', { type: 'undo', utteranceId: s.card.utteranceId })
      if (e.type === 'tap' || e.type === 'doubleTap') return peek({ ...s, card: null })
      if ((e.type === 'swipeDown' || e.type === 'swipeUp') && s.card) {
        // Swipe pages through a transcript longer than one page.
        const last = transcriptPages(s.card.transcript).length - 1
        const page = Math.max(0, Math.min(last, s.card.page + (e.type === 'swipeDown' ? 1 : -1)))
        return page === s.card.page ? done(s) : done({ ...s, card: { ...s.card, page } })
      }
      return done(s)
    case 'disambiguation': {
      if (e.type === 'listSelect' && s.disambiguation) {
        const pick = s.disambiguation.options[e.index]
        const effects: Effect[] = pick ? [{ type: 'assignNote', noteId: s.disambiguation.noteId, studentId: pick.id }] : []
        const cleared = { ...s, disambiguation: null, status: null }
        if (s.card?.lines.length) return { state: { ...cleared, screen: 'card' }, effects }
        return peek({ ...cleared, card: null }, null, ...effects)
      }
      if (e.type === 'doubleTap') return peek({ ...s, disambiguation: null, card: null }, '● Saved to Review')
      return done(s)
    }
    case 'confirmEnd':
      if (e.type === 'tap' && s.session) return done({ ...s, screen: 'wrapup', wrapup: null }, { type: 'endSession', sessionId: s.session.id })
      return peek(s)
    case 'wrapup': {
      if (!s.wrapup && e.type === 'doubleTap') return peek(s)
      if (!s.wrapup || !s.session) return done(s)
      const reset = { ...s, screen: 'home' as const, session: null, active: null, wrapup: null, card: null, status: null, coverage: { covered: 0, present: 0 }, nextStudent: null }
      if (e.type === 'tap') return done(reset, { type: 'remind', sessionId: s.session.id, studentIds: s.wrapup.missed.map(m => m.id) }, { type: 'loadToday' })
      if (e.type === 'doubleTap') return done(reset, { type: 'loadToday' })
      return done(s)
    }
  }
}

/** Gestures shared by peek and dark: long-press = hold to talk, swipe = deck, double-tap = end class. */
function restGesture(s: LensState, e: LensEvent): R {
  if (e.type === 'longPress') return record(s, 'note', 'peek', true)
  if (e.type === 'swipeUp' || e.type === 'swipeDown') return done({ ...s, screen: 'deck', status: null })
  if (e.type === 'doubleTap') return done({ ...s, screen: 'confirmEnd', status: null })
  return done(s)
}
