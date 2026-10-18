import type { EmptyReason } from '../core/audio'
import type { Effect, LensEvent, LensState, Mode, Screen } from './state'
import { detailPages } from './render'
import { colsFor, transcriptPages } from './text'

/** How long a one-line status (e.g. "Saved · will sync") stays on the peek before the next-kid line returns. */
export const STATUS_MS = 5000
/** While a note is pending, the stage line moves from "sending" to "thinking" after this many 500 ms ticks (1.5 s). */
export const THINK_AFTER_TICKS = 3
type R = { state: LensState; effects: Effect[] }
const done = (state: LensState, ...effects: Effect[]): R => ({ state, effects })
const ROLL_NOT_SAVED = 'Roll call not saved · use phone roster'
const expire: Effect = { type: 'expireStatus', ms: STATUS_MS }

export function initialState(firstRunSeen: boolean): LensState {
  return {
    screen: firstRunSeen ? 'home' : 'firstRun', today: null, classes: [], selectedClassId: null, session: null, active: null,
    coverage: { covered: 0, present: 0 }, nextStudent: null, card: null, disambiguation: null, wrapup: null,
    pending: null, mic: null, thinking: null, detail: null, darkFrom: null, attendanceLines: [], status: null, loadError: null, starting: false, queued: 0,
  }
}

const drills = (s: LensState) => s.today?.deck.drills ?? []

/** The class-time rest screen. It stays up (no auto-hide); a status line expires after STATUS_MS. */
function peek(s: LensState, status: string | null = null, ...effects: Effect[]): R {
  return done({ ...s, screen: 'peek', status, darkFrom: null }, ...effects, ...(status ? [expire] : []))
}

/** Screens a nod may turn dark: idle ones only (never while recording, sending, or with the card up). */
const NOD_IDLE = new Set<Screen>(['home', 'peek', 'deck'])

/** Light the lens again on the idle screen it was on before going dark. */
function wake(s: LensState): R {
  const to = s.darkFrom ?? (s.session ? 'peek' : 'home')
  return to === 'peek' ? peek(s) : done({ ...s, screen: to, darkFrom: null })
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

function record(s: LensState, mode: Mode, returnTo: Screen, viaLongPress: boolean, now: number): R {
  return done({ ...s, screen: mode === 'attendance' ? 'attendance' : 'recording', pending: { mode, returnTo, viaLongPress, at: now }, darkFrom: null,
    mic: { tick: 0, audio: false, source: 'glasses' }, status: null }, { type: 'startMic' })
}

/** Why nothing was sent, in words the coach can act on. */
function emptyStatus(mode: Mode | undefined, reason: EmptyReason): string {
  if (reason === 'no_audio') return mode === 'attendance' ? 'No audio from glasses · use phone roster' : "No audio from glasses — tap and speak after 'Listening'"
  if (mode === 'attendance') return ROLL_NOT_SAVED
  return reason === 'too_short' ? 'Too short — speak, then tap' : "Didn't catch that · tap to retry"
}

function send(s: LensState): R {
  if (!s.pending || !s.session) return peek({ ...s, pending: null })
  return done({ ...s, screen: 'sending', thinking: { stage: 'heard', tick: 0, since: 0 } }, { type: 'stopMicAndSend', mode: s.pending.mode, sessionId: s.session.id, drillId: s.pending.mode === 'note' ? s.active?.drillId ?? null : null })
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

/** A capture (note or roll call) is open: late events for an earlier note must not change the screen. */
const capturing = (s: LensState) => s.screen === 'recording' || s.screen === 'attendance'
/** The screen still waiting on the note just sent: "sending", or its transcript-first card. */
const awaitingReply = (s: LensState) => s.screen === 'sending' || (s.screen === 'card' && Boolean(s.card?.provisional))
/** A late outcome while a capture is open: note it in the status line, leave the screen and the capture alone. */
const lateStatus = (s: LensState, status: string): R => done({ ...s, status }, expire)

function utteranceResult(s: LensState, e: Extract<LensEvent, { type: 'utteranceResult' }>): R {
  // The coach moved on (recording the next note, or closed the card): keep the numbers, never steal the screen.
  if (!awaitingReply(s)) return done({ ...s, coverage: e.res.coverage, nextStudent: e.res.nextStudent, pending: capturing(s) ? s.pending : null })
  const base = { ...s, coverage: e.res.coverage, nextStudent: e.res.nextStudent, pending: null }
  if (s.pending?.mode === 'attendance') return done({ ...base, screen: 'attendanceDone', attendanceLines: e.res.cardLines })
  const card = { lines: e.res.cardLines, transcript: e.res.transcript, utteranceId: e.res.utteranceId, runs: null, runsFinal: false, page: 0 }
  const poll: Effect[] = card.utteranceId ? [{ type: 'pollRuns', utteranceId: card.utteranceId }] : []
  if (e.res.disambiguation) return done({ ...base, screen: 'disambiguation', disambiguation: e.res.disambiguation, card }, ...poll)
  if (!card.lines.length && !card.transcript) return peek(base)
  return done({ ...base, screen: 'card', card, status: null }, ...poll)
}

/** Events that carry data or timers: they apply on any screen. Null = not one of them. */
function dataEvent(s: LensState, e: LensEvent, now: number): R | null {
  switch (e.type) {
    case 'todayLoaded': return done({ ...s, today: e.today, loadError: null, selectedClassId: null })
    case 'classesLoaded': return done({ ...s, classes: e.classes })
    case 'loadFailed': return done({ ...s, loadError: e.message }) // a pending lens pick stays: tap retries it
    case 'coverageUpdated': return done({ ...s, coverage: e.coverage, nextStudent: e.nextStudent })
    case 'resumed': return done(s, { type: 'loadToday' }, { type: 'loadClasses' }, { type: 'flushOutbox' })
    case 'startRequested':
      if (s.screen === 'dark' && !s.session) return homeTap({ ...s, screen: 'home', darkFrom: null }) // phone "Start" while the lens was off
      return s.screen === 'home' ? homeTap(s) : done(s)
    case 'actionFailed': {
      if (s.screen === 'wrapup' && !s.wrapup) return peek(s, `Couldn't end class · ${e.message}`)
      return done({ ...s, starting: false, loadError: s.screen === 'home' ? e.message : s.loadError })
    }
    case 'sessionStarted': {
      if (s.session?.id === e.res.sessionId) return done(s)
      const next = { ...s, starting: false, session: { id: e.res.sessionId, startedAt: Date.parse(e.res.startedAt) }, coverage: e.res.coverage, nextStudent: e.res.nextStudent }
      return e.resumed ? resumeDrill(next, e.now) : record(next, 'attendance', 'peek', false, now)
    }
    case 'micFailed': return back(s, 'Mic unavailable · check permission')
    case 'utteranceDelivered': {
      // The server saved it but its reply was unreadable: never resent; a neutral card, no undo.
      if (!awaitingReply(s)) return lateStatus(s, 'Saved · details unavailable') // the coach moved on
      if (s.pending?.mode === 'attendance') return back(s, 'Roll call saved · details unavailable')
      const card = { lines: ['Saved · details unavailable'], transcript: '', utteranceId: null, runs: null, runsFinal: true, page: 0 }
      return done({ ...s, screen: 'card', card, pending: null, status: null })
    }
    case 'utteranceQueued':
      if (capturing(s)) return lateStatus(s, '● Saved · will sync')
      return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : '● Saved · will sync')
    case 'utteranceEmpty':
      if (capturing(s)) return lateStatus(s, emptyStatus('note', e.reason))
      return back(s, emptyStatus(s.pending?.mode, e.reason))
    case 'micLevel': {
      const m = s.mic
      if ((s.screen !== 'recording' && s.screen !== 'attendance') || (m && m.tick === e.tick && m.audio === e.audio && m.source === e.source)) return done(s)
      return done({ ...s, mic: { tick: e.tick, audio: e.audio, source: e.source } })
    }
    case 'sendStarted': {
      const th = s.thinking
      if (s.screen !== 'sending' || !th || th.stage !== 'heard') return done(s)
      return done({ ...s, thinking: { ...th, stage: 'sending', since: th.tick } })
    }
    case 'thinkingTick': {
      const th = s.thinking
      if (s.screen !== 'sending' || !th) return done(s)
      const tick = th.tick + 1
      const late = th.stage === 'sending' && tick - th.since >= THINK_AFTER_TICKS
      return done({ ...s, thinking: late ? { stage: 'thinking', tick, since: tick } : { ...th, tick } })
    }
    case 'remindResult': {
      const status = e.ok ? remindedStatus(e.names) : 'Reminder not saved · check connection'
      return done({ ...s, status }, expire)
    }
    case 'utteranceResult': return utteranceResult(s, e)
    case 'transcriptReady': {
      // Show "You said" at once; agents sort it when the text note's reply lands (roll call keeps its own flow).
      if (s.screen !== 'sending' || s.pending?.mode !== 'note') return done(s)
      const card = { lines: [], transcript: e.transcript, utteranceId: null, runs: null, runsFinal: false, page: 0, provisional: true }
      return done({ ...s, screen: 'card', card, status: null })
    }
    case 'outboxChanged': return s.queued === e.count ? done(s) : done({ ...s, queued: e.count })
    case 'runsLoaded': {
      if (!s.card || s.card.utteranceId !== e.utteranceId) return done(s)
      return done({ ...s, card: { ...s.card, runs: e.runs ?? s.card.runs, runsFinal: e.final } })
    }
    case 'wrapupLoaded': return done({ ...s, screen: 'wrapup', wrapup: e.wrapup })
    case 'statusExpired': return s.status ? done({ ...s, status: null }) : done(s)
    case 'nod':
      if (NOD_IDLE.has(s.screen)) return done({ ...s, screen: 'dark', status: null, darkFrom: s.screen as 'home' | 'peek' | 'deck' })
      return s.screen === 'dark' ? wake(s) : done(s)
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
  const data = dataEvent(s, e, now)
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
      // The lens is off by choice: a tap only wakes it (never records). Before class any gesture wakes
      // it (never exits); during class the other gestures work as in peek.
      if (e.type === 'tap' || !s.session) return wake(s)
      return restGesture({ ...s, darkFrom: null }, e, now)
    case 'peek':
      if (e.type === 'tap') return record(s, 'note', 'peek', false, now)
      return restGesture(s, e, now)
    case 'deck':
      // Selecting an item opens its detail (full name + cues) first; tap there starts it.
      if (e.type === 'listSelect') return drills(s)[e.index] ? done({ ...s, screen: 'drillDetail', detail: { index: e.index, page: 0 } }) : done(s)
      if (e.type === 'doubleTap') return peek(s)
      return done(s)
    case 'drillDetail': {
      const d = s.detail
      if (!d) return done({ ...s, screen: 'deck' })
      if (e.type === 'tap') return startDrill({ ...s, detail: null }, d.index, now)
      if (e.type === 'doubleTap') return done({ ...s, screen: 'deck', detail: null })
      if (e.type === 'swipeDown' || e.type === 'swipeUp') {
        const last = detailPages(s).length - 1
        const page = Math.max(0, Math.min(last, d.page + (e.type === 'swipeDown' ? 1 : -1)))
        return page === d.page ? done(s) : done({ ...s, detail: { ...d, page } })
      }
      return done(s)
    }
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
      const reset = { ...s, screen: 'home' as const, darkFrom: null, session: null, active: null, wrapup: null, card: null, status: null, coverage: { covered: 0, present: 0 }, nextStudent: null }
      if (e.type === 'tap' && s.wrapup.missed.length) {
        return done(reset, { type: 'remind', sessionId: s.session.id, studentIds: s.wrapup.missed.map(m => m.id), names: s.wrapup.missed.map(m => m.name) }, { type: 'loadToday' })
      }
      if (e.type === 'tap') return done(reset, { type: 'loadToday' })
      if (e.type === 'doubleTap') return done(reset, { type: 'loadToday' })
      return done(s)
    }
  }
}

/** Gestures shared by peek and dark: long-press = hold to talk, swipe = deck, double-tap = end class. */
function restGesture(s: LensState, e: LensEvent, now: number): R {
  if (e.type === 'longPress') return record(s, 'note', 'peek', true, now)
  if (e.type === 'swipeUp' || e.type === 'swipeDown') return done({ ...s, screen: 'deck', status: null })
  if (e.type === 'doubleTap') return done({ ...s, screen: 'confirmEnd', status: null })
  return done(s)
}

const REMIND_SUFFIX = ' first next class'
/** "ok · Jake, Leo, Mia first next class", with "+N" for names that don't fit one footer line. */
export function remindedStatus(names: string[]): string {
  const room = colsFor(576) - 'ok · '.length - REMIND_SUFFIX.length
  let shown = names.join(', ')
  for (let k = names.length - 1; shown.length > room && k >= 1; k--) shown = `${names.slice(0, k).join(', ')} +${names.length - k}`
  if (shown.length > room) shown = `${names.length} kids`
  return `ok · ${shown}${REMIND_SUFFIX}`
}
