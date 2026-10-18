import type { Insight } from '@matside/shared'
import { INSIGHT_BANNER_MS } from '../config'
import type { EmptyReason } from '../core/audio'
import type { RetryReason } from '../core/outbox'
import type { DarkFrom, Effect, LensEvent, LensState, Mode, Screen, UndoLines } from './state'
import { NO_INSIGHTS, freshInsights, topInsight } from './insights'
import { cardPageCount, detailPages } from './render'
import { colsFor, fitNames } from './text'

/** How long a one-line status (e.g. "Saved · will sync") stays on the peek before the next-kid line returns. */
export const STATUS_MS = 5000
/** While a note is pending, the stage line moves from "sending" to "thinking" after this many 500 ms ticks (1.5 s). */
export const THINK_AFTER_TICKS = 3
type R = { state: LensState; effects: Effect[] }
const done = (state: LensState, ...effects: Effect[]): R => ({ state, effects })
const ROLL_NOT_SAVED = 'Roll call not saved · use phone roster'
/** F14: the audio had no speech energy. Actionable, not "didn't catch that". */
export const QUIET_STATUS = "Couldn't hear you · move closer, speak up"

/** The status after a note went into the outbox: the true reason it is waiting (F07). */
function queuedStatus(reason: RetryReason | undefined): string {
  if (reason === 'offline') return '● Saved · offline, will sync'
  if (reason === 'unpaired') return '● Saved · pair phone to sync'
  if (reason === 'stt_unavailable') return '● Saved · server speech-to-text off'
  if (reason === 'rate_limited' || reason === 'server' || reason === 'in_progress') return '● Saved · server busy, will retry'
  return '● Saved · will sync'
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const expire: Effect = { type: 'expireStatus', ms: STATUS_MS }

export function initialState(firstRunSeen: boolean): LensState {
  return {
    screen: firstRunSeen ? 'home' : 'firstRun', today: null, classes: [], selectedClassId: null, session: null, active: null,
    coverage: { covered: 0, present: 0 }, nextStudent: null, card: null, disambiguation: null, wrapup: null,
    pending: null, mic: null, thinking: null, detail: null, darkFrom: null, attendanceLines: [], status: null, loadError: null, starting: false, queued: 0,
    planning: null, planResult: null, lobbyInsight: null, ...NO_INSIGHTS, wrapupInsight: null,
    failed: 0, undo: null, displayMode: 'quiet',
  }
}

const drills = (s: LensState) => s.today?.deck.drills ?? []

/** The class-time rest screen. Standard mode: it stays up. Quiet mode: it goes dark IDLE_DARK_MS after its last change (controller timer). */
function peek(s: LensState, status: string | null = null, ...effects: Effect[]): R {
  return done({ ...s, screen: 'peek', status, darkFrom: null }, ...effects, ...(status ? [expire] : []))
}

/** Screens a nod may turn dark: idle ones only (never while recording, sending, or with the card up). */
const NOD_IDLE = new Set<Screen>(['home', 'lobby', 'peek', 'deck'])

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
  if (reason === 'quiet') return mode === 'attendance' ? 'Couldn\'t hear you · use phone roster' : QUIET_STATUS
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

/** Home tap enters the shown class's lobby; `start` (the phone's Start) starts it at once. */
function homeTap(s: LensState, start = false): R {
  if (s.selectedClassId && s.today?.classId !== s.selectedClassId) {
    // The shown class is not loaded: retry its day after a failure (KV already holds it); never open the old class.
    return s.loadError ? done({ ...s, loadError: null }, { type: 'loadToday' }) : done(s)
  }
  if (!s.today) return done(s, { type: 'loadToday' }, { type: 'loadClasses' })
  return start ? startClass(s, s.today.classId) : done({ ...s, screen: 'lobby', status: null }, { type: 'loadInsights', classId: s.today.classId })
}

/** Back to the lobby (plan refreshed by the caller), optionally with a status line. */
function lobby(s: LensState, status: string | null = null, ...effects: Effect[]): R {
  return done({ ...s, screen: 'lobby', planning: null, planResult: null, status, darkFrom: null }, ...effects, ...(status ? [expire] : []))
}

/** Lobby: tap starts the class, double-tap starts planning listen, swipe goes back to home. */
function lobbyGesture(s: LensState, e: LensEvent): R {
  if (!s.today) return done({ ...s, screen: 'home' })
  if (e.type === 'tap') return startClass(s, s.today.classId)
  if ((e.type === 'swipeUp' || e.type === 'swipeDown') && !s.starting) return done({ ...s, screen: 'home', status: null })
  if (e.type === 'doubleTap' && !s.starting) {
    return done({ ...s, screen: 'planning', status: null, planning: { stage: 'listening', sec: 0, heard: '' } }, { type: 'startPlan', classId: s.today.classId })
  }
  return done(s)
}

/** Planning listen data events (ticks, transcript, the result). Null = not one of them. */
function planEvent(s: LensState, e: LensEvent): R | null {
  const p = s.planning
  switch (e.type) {
    case 'planTick': return s.screen === 'planning' && p && p.sec !== e.sec ? done({ ...s, planning: { ...p, sec: e.sec } }) : done(s)
    case 'planHeard': return p && p.heard !== e.text ? done({ ...s, planning: { ...p, heard: e.text } }) : done(s)
    case 'planApplying': return s.screen === 'planApplying' && p ? done({ ...s, planning: { ...p, stage: 'applying' } }) : done(s)
    case 'planResult': {
      // The plan changed on the server either way: reload today so the lobby shows it.
      if (s.screen !== 'planApplying') return done(s, { type: 'loadToday' })
      return done({ ...s, screen: 'planResult', planning: null, planResult: { diffId: e.res.diffId, lines: e.res.lines, missed: e.missed ?? 0 } }, { type: 'loadToday' })
    }
    case 'planFailed':
      return s.screen === 'planning' || s.screen === 'planApplying' ? lobby(s, e.message) : done(s)
    case 'planUndone': {
      const status = e.ok ? 'Plan change undone' : e.message || 'Undo failed'
      return done({ ...s, status }, expire, ...(e.ok ? [{ type: 'loadToday' } as const] : []))
    }
  }
  return null
}

/** Plan result: tap = OK, double-tap = undo, swipe = back to the lobby. */
function planResultGesture(s: LensState, e: LensEvent): R {
  const diffId = s.planResult?.diffId
  if (e.type === 'doubleTap' && diffId) return done({ ...s, screen: 'lobby', planResult: null, status: 'Undoing plan change…' }, { type: 'undoPlan', diffId })
  if (e.type === 'tap' || e.type === 'doubleTap' || e.type === 'swipeUp' || e.type === 'swipeDown') return lobby(s)
  return done(s)
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
  const card = { lines: e.res.cardLines, transcript: e.res.transcript, utteranceId: e.res.utteranceId, runs: null, runsFinal: false, page: 0, brief: e.res.brief ?? null }
  const poll: Effect[] = card.utteranceId ? [{ type: 'pollRuns', utteranceId: card.utteranceId }] : []
  if (e.res.disambiguation) return done({ ...base, screen: 'disambiguation', disambiguation: e.res.disambiguation, card }, ...poll)
  if (!card.lines.length && !card.transcript) return peek(base)
  return done({ ...base, screen: 'card', card, status: null }, ...poll)
}

/** Events that carry data or timers: they apply on any screen. Null = not one of them. */
function dataEvent(s: LensState, e: LensEvent, now: number): R | null {
  switch (e.type) {
    case 'todayLoaded': {
      const lobbyInsight = s.today?.classId === e.today.classId ? s.lobbyInsight : null // another class: its insight is not this one's
      return done({ ...s, today: e.today, loadError: null, selectedClassId: null, lobbyInsight })
    }
    case 'classesLoaded': return done({ ...s, classes: e.classes })
    case 'loadFailed': return done({ ...s, loadError: e.message }) // a pending lens pick stays: tap retries it
    case 'coverageUpdated': return done({ ...s, coverage: e.coverage, nextStudent: e.nextStudent })
    case 'resumed': return done(s, { type: 'loadToday' }, { type: 'loadClasses' }, { type: 'flushOutbox' })
    case 'startRequested':
      if (s.screen === 'dark' && !s.session) return homeTap({ ...s, screen: 'home', darkFrom: null }, true) // phone "Start" while the lens was off
      return s.screen === 'home' || s.screen === 'lobby' ? homeTap(s, true) : done(s)
    case 'actionFailed': {
      if (s.screen === 'wrapup' && !s.wrapup) return peek(s, `Couldn't end class · ${e.message}`)
      return done({ ...s, starting: false, loadError: s.screen === 'home' || s.screen === 'lobby' ? e.message : s.loadError })
    }
    case 'sessionStarted': {
      if (s.session?.id === e.res.sessionId) return done(s)
      const next = { ...s, ...NO_INSIGHTS, starting: false, session: { id: e.res.sessionId, startedAt: Date.parse(e.res.startedAt) }, coverage: e.res.coverage, nextStudent: e.res.nextStudent }
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
      if (capturing(s)) return lateStatus(s, queuedStatus(e.reason))
      return back(s, s.pending?.mode === 'attendance' ? ROLL_NOT_SAVED : queuedStatus(e.reason))
    case 'utteranceFailed': {
      const status = `Not sent · see phone · ${e.reason}`
      if (capturing(s)) return lateStatus(s, status)
      return back(s, status)
    }
    case 'outboxSynced': {
      if (!e.sent && !e.failed) return done(s)
      const status = e.failed ? `${plural(e.failed, 'note')} not sent · see phone` : `↑ ${plural(e.sent, 'note')} sent`
      return done({ ...s, status }, expire)
    }
    case 'failedChanged': return s.failed === e.count ? done(s) : done({ ...s, failed: e.count })
    case 'undoResult': return undoResult(s, e.utteranceId, e.res)
    case 'undoFailed': return undoFailed(s, e)
    case 'displayModeLoaded': return s.displayMode === e.mode ? done(s) : done({ ...s, displayMode: e.mode })
    case 'idleTimeout': return autoHides(s) ? done({ ...s, screen: 'dark', status: null, darkFrom: 'peek' }) : done(s)
    case 'resultTimeout':
      if (!autoDismisses(s)) return done(s)
      return s.screen === 'undo' ? promoteBanner(peek({ ...s, undo: null })) : promoteBanner(peek({ ...s, card: null }))
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
    case 'insightsLoaded': return insightsLoaded(s, e)
    case 'bannerExpired': return s.insightBanner ? done(collapseBanner(s)) : done(s)
    case 'nod':
      if (NOD_IDLE.has(s.screen)) return done({ ...s, screen: 'dark', status: null, darkFrom: s.screen as DarkFrom })
      return s.screen === 'dark' ? wake(s) : done(s)
    case 'timerEnded': {
      if (!s.session || !s.active || (s.screen !== 'dark' && s.screen !== 'peek')) return done(s)
      const list = drills(s)
      const i = list.findIndex(d => d.id === s.active?.drillId)
      const next = list[i + 1]?.name ?? 'wrap up'
      return peek(s, `Time · next: ${next}`)
    }
  }
  return planEvent(s, e)
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
    case 'lobby': return lobbyGesture(s, e)
    case 'planning':
      if (e.type === 'tap') return done({ ...s, screen: 'planApplying', planning: s.planning && { ...s.planning, stage: 'transcribing' } }, { type: 'stopPlan' })
      if (e.type === 'doubleTap') { const r = lobby(s, 'Planning cancelled'); return { state: r.state, effects: [{ type: 'cancelPlan' }, ...r.effects] } }
      return done(s)
    case 'planApplying':
      // Still transcribing: double-tap can cancel. Once the plan edit is on its way, its result (with undo) must be seen.
      if (e.type === 'doubleTap' && s.planning?.stage === 'transcribing') { const r = lobby(s, 'Planning cancelled'); return { state: r.state, effects: [{ type: 'cancelPlan' }, ...r.effects] } }
      return done(s)
    case 'planResult': return planResultGesture(s, e)
    case 'attendance':
      if (e.type === 'tap') return send(s)
      if (e.type === 'doubleTap') {
        const r = back(s, 'Roll call skipped · use phone')
        return { state: r.state, effects: [{ type: 'cancelMic' }, ...r.effects] }
      }
      return done(s)
    case 'attendanceDone':
      // An insight polled in during roll call waited unseen; leaving for peek gives it the banner.
      return e.type === 'tap' ? promoteBanner(startDrill(s, 0, now)) : done(s)
    case 'dark':
      // Before class any gesture only wakes the lens (never exits). During class (C6) a tap wakes AND
      // records in one action; the other gestures work as in peek.
      if (!s.session) return wake(s)
      if (e.type === 'tap') return record({ ...s, darkFrom: null }, 'note', 'peek', false, now)
      return restGesture({ ...s, darkFrom: null }, e, now)
    case 'peek': {
      const b = s.insightBanner
      // C6: a banner never captures tap (tap records; the banner waits behind ★). Swipe opens its detail,
      // which is how it is dismissed; hold-to-talk and end class work as always.
      if (b && (e.type === 'swipeUp' || e.type === 'swipeDown')) return openInsight({ ...s, insightBanner: null }, b)
      const rest = b && (e.type === 'tap' || e.type === 'longPress' || e.type === 'doubleTap') ? collapseBanner(s) : s
      if (e.type === 'tap') return record(rest, 'note', 'peek', false, now)
      return restGesture(rest, e, now)
    }
    case 'insight':
      // Seen on open. Tap records (C6: tap always records in class); swipe or 2× = back.
      if (e.type === 'tap' && s.session) return record({ ...s, insightDetail: null }, 'note', 'peek', false, now)
      if (e.type === 'tap' || e.type === 'doubleTap' || e.type === 'swipeUp' || e.type === 'swipeDown') return peek({ ...s, insightDetail: null })
      return done(s)
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
      // Tap closes (quiet mode: it also closes itself after RESULT_CARD_MS); double-tap asks the server to undo (F02).
      if (e.type === 'doubleTap' && s.card?.utteranceId) return startUndo({ ...s, card: null }, s.card.utteranceId)
      if (e.type === 'tap' || e.type === 'doubleTap') return promoteBanner(peek({ ...s, card: null }))
      if ((e.type === 'swipeDown' || e.type === 'swipeUp') && s.card) {
        // Swipe pages through a transcript longer than one page.
        const last = cardPageCount(s.card) - 1
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
    case 'undo': return undoGesture(s, e)
    case 'confirmEnd':
      if (e.type === 'tap' && s.session) return done({ ...s, screen: 'wrapup', wrapup: null }, { type: 'endSession', sessionId: s.session.id })
      return peek(s)
    case 'wrapup': {
      if (!s.wrapup && e.type === 'doubleTap') return peek(s)
      if (!s.wrapup || !s.session) return done(s)
      const reset = { ...s, ...NO_INSIGHTS, screen: 'home' as const, darkFrom: null, session: null, active: null, wrapup: null, wrapupInsight: null, card: null, status: null, coverage: { covered: 0, present: 0 }, nextStudent: null }
      if (e.type === 'tap' && s.wrapup.missed.length) {
        return done(reset, { type: 'remind', sessionId: s.session.id, studentIds: s.wrapup.missed.map(m => m.id), names: s.wrapup.missed.map(m => m.name) }, { type: 'loadToday' })
      }
      if (e.type === 'tap') return done(reset, { type: 'loadToday' })
      if (e.type === 'doubleTap') return done(reset, { type: 'loadToday' })
      return done(s)
    }
  }
}

/** Gestures shared by peek and dark: long-press = hold to talk, swipe = deck (an unseen insight first), double-tap = end class. */
function restGesture(s: LensState, e: LensEvent, now: number): R {
  if (e.type === 'longPress') return record(s, 'note', 'peek', true, now)
  const [unseen, ...older] = s.insightUnseen
  if ((e.type === 'swipeUp' || e.type === 'swipeDown') && unseen) return openInsight({ ...s, insightUnseen: older }, unseen)
  if (e.type === 'swipeUp' || e.type === 'swipeDown') return done({ ...s, screen: 'deck', status: null })
  if (e.type === 'doubleTap') return done({ ...s, screen: 'confirmEnd', status: null })
  return done(s)
}

/** Undo: "Undoing…" until the server answers (never an optimistic "Undone"). */
function startUndo(s: LensState, utteranceId: string): R {
  const undo = { utteranceId, stage: 'pending' as const, reversed: [], cancelled: [], notReversible: [], message: null }
  return done({ ...s, screen: 'undo', undo, status: null, darkFrom: null }, { type: 'undo', utteranceId })
}

/** Undo screen: pending → any tap/2× leaves (the answer comes back as a status line); failed → tap retries; result → tap closes. */
function undoGesture(s: LensState, e: LensEvent): R {
  const u = s.undo
  if (!u) return peek(s)
  if (e.type !== 'tap' && e.type !== 'doubleTap') return done(s)
  if (u.stage === 'pending') return peek(s, UNDOING)
  if (u.stage === 'failed' && e.type === 'tap') return startUndo(s, u.utteranceId)
  return promoteBanner(peek({ ...s, undo: null }))
}
const UNDOING = 'Undoing…'

/** One status line for an undo result that arrived after the coach left the undo screen. */
export function undoSummary(r: UndoLines): string {
  const changed = r.reversed.length + r.cancelled.length
  const parts = [changed ? `Undone · ${plural(changed, 'change')}` : 'Nothing undone', ...(r.notReversible.length ? [`${r.notReversible.length} not reversible`] : [])]
  return parts.join(' · ')
}

function undoResult(s: LensState, utteranceId: string, res: UndoLines): R {
  if (s.undo?.utteranceId === utteranceId && s.screen === 'undo') return done({ ...s, undo: { ...s.undo, ...res, stage: 'done', message: null } })
  if (s.undo?.utteranceId === utteranceId || s.status === UNDOING) return done({ ...s, undo: null, status: undoSummary(res) }, expire)
  return done(s)
}

function undoFailed(s: LensState, e: Extract<LensEvent, { type: 'undoFailed' }>): R {
  const stage = e.kind === 'error' ? 'failed' as const : e.kind
  if (s.undo?.utteranceId === e.utteranceId && s.screen === 'undo') return done({ ...s, undo: { ...s.undo, stage, message: e.message || null } })
  if (s.undo?.utteranceId !== e.utteranceId && s.status !== UNDOING) return done(s)
  const status = e.kind === 'already' ? 'Already undone' : e.kind === 'missing' ? 'Nothing to undo' : `Undo failed · ${e.message}`
  return done({ ...s, undo: null, status }, expire)
}

/** C6: in quiet mode, during class, the idle peek goes dark after IDLE_DARK_MS (not while a banner is up: it collapses first). */
export function autoHides(s: LensState): boolean {
  return s.displayMode === 'quiet' && Boolean(s.session) && s.screen === 'peek' && !s.insightBanner
}
/** C6: in quiet mode a result card closes itself after RESULT_CARD_MS (never a provisional card or a failed undo: it holds the retry). */
export function autoDismisses(s: LensState): boolean {
  if (s.displayMode !== 'quiet') return false
  if (s.screen === 'card') return Boolean(s.card && !s.card.provisional)
  return s.screen === 'undo' && Boolean(s.undo) && s.undo!.stage !== 'pending' && s.undo!.stage !== 'failed'
}
/** What the result timer measures from: a new card, a page turn or an undo stage (not agent progress). */
export function resultKey(s: LensState): string {
  return [s.screen, s.card?.utteranceId ?? '', s.card?.page ?? '', s.undo?.stage ?? ''].join('|')
}

const REMIND_SUFFIX = ' first next class'
/** "ok · Jake, Leo, Mia first next class", with "+N" for names that don't fit one footer line. */
export function remindedStatus(names: string[]): string {
  const room = colsFor(576) - 'ok · '.length - REMIND_SUFFIX.length
  return `ok · ${fitNames(names, room)}${REMIND_SUFFIX}`
}

/** The insight detail screen (opening it counts as seeing it). */
function openInsight(s: LensState, insight: Insight): R {
  return done({ ...s, screen: 'insight', insightDetail: insight, status: null, darkFrom: null })
}

/**
 * Back on peek: the first high-urgency insight that arrived while another screen was up (roll call, the card)
 * becomes the banner, if none is showing.
 */
function promoteBanner(r: R): R {
  const [u, ...rest] = r.state.insightUnseen
  if (r.state.screen !== 'peek' || r.state.insightBanner || !u || u.urgency !== 'high') return r
  return done({ ...r.state, insightBanner: u, insightUnseen: rest }, ...r.effects, { type: 'expireBanner', ms: INSIGHT_BANNER_MS })
}

/** The banner's time is up (or the coach moved on): it waits behind the `★N` suffix until seen. */
function collapseBanner(s: LensState): LensState {
  return s.insightBanner ? { ...s, insightBanner: null, insightUnseen: [s.insightBanner, ...s.insightUnseen] } : s
}

/**
 * Insights arrived. Lobby: the class's top one fills the lobby slot. Wrap-up: the top one (this session's
 * first) becomes a row. Session poll: a new high item shows as the banner atop peek; anywhere else
 * (recording, the card, planning, dark) it never interrupts and waits behind the suffix instead.
 */
function insightsLoaded(s: LensState, e: Extract<LensEvent, { type: 'insightsLoaded' }>): R {
  if (e.scope === 'lobby') {
    if (!s.today || s.today.classId !== e.classId) return done(s)
    const top = topInsight(e.insights)
    return top?.id === s.lobbyInsight?.id ? done(s) : done({ ...s, lobbyInsight: top })
  }
  if (e.scope === 'wrapup') {
    const top = s.screen === 'wrapup' ? topInsight(e.insights, s.session?.startedAt ?? null) : null
    return top && top.id !== s.wrapupInsight?.id ? done({ ...s, wrapupInsight: top }) : done(s)
  }
  const fresh = s.session ? freshInsights(s, e.insights) : []
  if (!fresh.length) return done(s)
  const insightKnown = [...s.insightKnown, ...fresh.map(i => i.id)]
  if (s.screen !== 'peek' || s.insightBanner) return done({ ...s, insightKnown, insightUnseen: [...fresh, ...s.insightUnseen] })
  const [first, ...rest] = fresh
  return done({ ...s, insightKnown, insightBanner: first!, insightUnseen: [...rest, ...s.insightUnseen] }, { type: 'expireBanner', ms: INSIGHT_BANNER_MS })
}
