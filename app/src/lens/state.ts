import type { Coverage, Disambiguation, NextStudent, StartSessionResponse, Today, UtteranceResponse, WrapUp } from '@matside/shared'

export type Screen = 'firstRun' | 'home' | 'attendance' | 'attendanceDone' | 'dark' | 'peek' | 'deck' | 'recording' | 'sending' | 'card' | 'disambiguation' | 'confirmEnd' | 'wrapup'
export type Mode = 'note' | 'attendance'

export interface LensState {
  screen: Screen
  today: Today | null
  session: { id: string; startedAt: number } | null
  active: { drillId: string; startedAt: number } | null
  coverage: Coverage
  nextStudent: NextStudent | null
  card: { lines: string[]; utteranceId: string | null } | null
  disambiguation: Disambiguation | null
  wrapup: WrapUp | null
  pending: { mode: Mode; returnTo: Screen; viaLongPress: boolean } | null
  attendanceLines: string[]
  status: string | null
  loadError: string | null
}

export type LensEvent =
  | { type: 'tap'; now?: number } | { type: 'doubleTap' } | { type: 'swipeUp' } | { type: 'swipeDown' }
  | { type: 'longPress' } | { type: 'longPressRelease' }
  | { type: 'listSelect'; index: number; now?: number }
  | { type: 'resumed' }
  | { type: 'startRequested' }
  | { type: 'todayLoaded'; today: Today }
  | { type: 'loadFailed'; message: string }
  | { type: 'sessionStarted'; res: StartSessionResponse; resumed: boolean; now: number }
  | { type: 'utteranceResult'; res: UtteranceResponse }
  | { type: 'utteranceQueued' } | { type: 'utteranceEmpty' } | { type: 'micFailed' }
  | { type: 'coverageUpdated'; coverage: Coverage; nextStudent: NextStudent | null }
  | { type: 'wrapupLoaded'; wrapup: WrapUp }
  | { type: 'cardTimeout' }
  | { type: 'headTilt' }
  | { type: 'timerEnded' }
  | { type: 'hide' }

export type Effect =
  | { type: 'markFirstRunSeen' }
  | { type: 'loadToday' }
  | { type: 'startSession'; classId: string }
  | { type: 'startMic' }
  | { type: 'cancelMic' }
  | { type: 'stopMicAndSend'; mode: Mode; sessionId: string; drillId: string | null }
  | { type: 'logDrill'; sessionId: string; drillId: string; event: 'start' | 'end' }
  | { type: 'assignNote'; noteId: string; studentId: string }
  | { type: 'undo'; utteranceId: string }
  | { type: 'endSession'; sessionId: string }
  | { type: 'remind'; sessionId: string; studentIds: string[] }
  | { type: 'scheduleCardTimeout'; ms: number }
  | { type: 'scheduleHide'; ms: number }
  | { type: 'flushOutbox' }
  | { type: 'exit' }
