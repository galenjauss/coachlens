import type { Coverage, Disambiguation, NextStudent, StartSessionResponse, Today, UtteranceResponse, WrapUp } from '@matside/shared'
import type { UtteranceRun } from '../core/api'
import type { EmptyReason, MicSource } from '../core/audio'

export type Screen = 'firstRun' | 'home' | 'attendance' | 'attendanceDone' | 'dark' | 'peek' | 'deck' | 'recording' | 'sending' | 'card' | 'disambiguation' | 'confirmEnd' | 'wrapup'
export type Mode = 'note' | 'attendance'
export type ClassOption = { id: string; name: string; modeLabel: string }

/** The agent card: what the coach said (left) and live agent progress (right). `runs` null = not loaded yet. */
export interface Card {
  lines: string[]
  transcript: string
  utteranceId: string | null
  runs: UtteranceRun[] | null
  /** Polling ended (all expected agents reported, 30 s passed, or the endpoint is missing). */
  runsFinal: boolean
  /** Transcript page shown (swipe pages through a long transcript). */
  page: number
}

export interface LensState {
  screen: Screen
  today: Today | null
  /** Classes the coach can cycle through on home (swipe). */
  classes: ClassOption[]
  /** A class picked on the lens whose `today` is still loading; null once today matches. */
  selectedClassId: string | null
  session: { id: string; startedAt: number } | null
  active: { drillId: string; startedAt: number } | null
  coverage: Coverage
  nextStudent: NextStudent | null
  card: Card | null
  disambiguation: Disambiguation | null
  wrapup: WrapUp | null
  /** A capture in progress; `at` = when it started (the recording header shows a static time from it). */
  pending: { mode: Mode; returnTo: Screen; viaLongPress: boolean; at: number } | null
  /** The idle screen a nod turned dark (a nod or tap brings it back). */
  darkFrom: 'home' | 'peek' | 'deck' | null
  /** Live "hearing you" indicator while recording: seconds, scrolling waveform ('' = no audio yet), which mic. */
  mic: { seconds: number; wave: string; source: MicSource } | null
  attendanceLines: string[]
  status: string | null
  loadError: string | null
  starting: boolean
}

export type LensEvent =
  | { type: 'tap'; now?: number } | { type: 'doubleTap' } | { type: 'swipeUp' } | { type: 'swipeDown' }
  | { type: 'longPress' } | { type: 'longPressRelease' }
  | { type: 'listSelect'; index: number; now?: number }
  | { type: 'resumed' }
  | { type: 'startRequested' }
  | { type: 'todayLoaded'; today: Today }
  | { type: 'classesLoaded'; classes: ClassOption[] }
  | { type: 'loadFailed'; message: string }
  | { type: 'sessionStarted'; res: StartSessionResponse; resumed: boolean; now: number }
  | { type: 'utteranceResult'; res: UtteranceResponse }
  | { type: 'utteranceQueued' } | { type: 'utteranceDelivered' } | { type: 'utteranceEmpty'; reason: EmptyReason } | { type: 'micFailed' }
  | { type: 'micLevel'; seconds: number; wave: string; source: MicSource }
  | { type: 'coverageUpdated'; coverage: Coverage; nextStudent: NextStudent | null }
  | { type: 'runsLoaded'; utteranceId: string; runs: UtteranceRun[] | null; final: boolean }
  | { type: 'wrapupLoaded'; wrapup: WrapUp }
  | { type: 'nod' }
  | { type: 'timerEnded' }
  | { type: 'statusExpired' }
  | { type: 'actionFailed'; message: string }

export type Effect =
  | { type: 'markFirstRunSeen' }
  | { type: 'loadToday' }
  | { type: 'loadClasses' }
  | { type: 'selectClass'; classId: string }
  | { type: 'startSession'; classId: string }
  | { type: 'startMic' }
  | { type: 'cancelMic' }
  | { type: 'stopMicAndSend'; mode: Mode; sessionId: string; drillId: string | null }
  | { type: 'logDrill'; sessionId: string; drillId: string; event: 'start' | 'end' }
  | { type: 'assignNote'; noteId: string; studentId: string }
  | { type: 'undo'; utteranceId: string }
  | { type: 'endSession'; sessionId: string }
  | { type: 'remind'; sessionId: string; studentIds: string[] }
  | { type: 'pollRuns'; utteranceId: string }
  | { type: 'expireStatus'; ms: number }
  | { type: 'flushOutbox' }
  | { type: 'exit' }
