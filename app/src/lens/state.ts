import type { Brief, Coverage, Disambiguation, Insight, NextStudent, StartSessionResponse, Today, UtteranceResponse, VoicePlanResponse, WrapUp } from '@matside/shared'
import type { UtteranceRun } from '../core/api'
import type { EmptyReason, MicSource } from '../core/audio'

export type Screen = 'firstRun' | 'home' | 'lobby' | 'planning' | 'planApplying' | 'planResult' | 'attendance' | 'attendanceDone' | 'dark' | 'peek' | 'deck' | 'recording' | 'sending' | 'card' | 'disambiguation' | 'confirmEnd' | 'wrapup' | 'drillDetail' | 'insight'
export type Mode = 'note' | 'attendance'
/** heard = recording stopped · sending = request in flight · thinking = still pending after THINK_AFTER_TICKS. */
export type ThinkStage = 'heard' | 'sending' | 'thinking'
/** Planning listen: listening (mic open) → transcribing (the last chunks) → applying (POST /v1/plan/voice). */
export type PlanStage = 'listening' | 'transcribing' | 'applying'
/** A screen a nod may turn dark (and wake back to). */
export type DarkFrom = 'home' | 'lobby' | 'peek' | 'deck'
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
  /** Transcript-first: the transcript is back, the note itself is still on its way ("… sorting"). */
  provisional?: boolean
  /** A student brief (student_query): page 0 shows it in place of agent progress; swipe pages to the transcript. */
  brief?: Brief | null
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
  darkFrom: DarkFrom | null
  /**
   * Live "hearing you" indicator while recording: `tick` = MIC_METER_MS steps since the mic opened
   * (drives the ●/○ pulse and the m:ss count), `audio` = bytes have arrived, `source` = which mic.
   */
  mic: { tick: number; audio: boolean; source: MicSource } | null
  /** "Thinking" stage line while a note is on its way: advanced by real pipeline events; `tick` drives the dots. */
  thinking: { stage: ThinkStage; tick: number; since: number } | null
  /** Deck item detail (full name + cues before starting it); `page` pages through long text. */
  detail: { index: number; page: number } | null
  attendanceLines: string[]
  status: string | null
  loadError: string | null
  starting: boolean
  /** Notes waiting in the outbox (peek and home show `↑ N queued`). */
  queued: number
  /** Planning listen in progress: `sec` = seconds since the mic opened, `heard` = the transcript so far. */
  planning: { stage: PlanStage; sec: number; heard: string } | null
  /** The voice plan's summary (plan result screen); `diffId` null = nothing changed, no undo. */
  planResult: { diffId: string | null; lines: string[]; missed: number } | null
  /** Lobby insight banner: the class's top insight, fetched on lobby enter (nothing is rendered while null). */
  lobbyInsight: Insight | null
  /** A new high-urgency insight shown atop peek for INSIGHT_BANNER_MS; then it collapses into `insightUnseen`. */
  insightBanner: Insight | null
  /** Surfaced but not seen yet: the peek status row shows a `★N` suffix; swipe opens the newest. */
  insightUnseen: Insight[]
  /** Insight ids already surfaced this session, so a poll never shows one twice. */
  insightKnown: string[]
  /** The insight open on the detail screen. */
  insightDetail: Insight | null
  /** The top insight at class end (a wrap-up row). */
  wrapupInsight: Insight | null
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
  | { type: 'micLevel'; tick: number; audio: boolean; source: MicSource }
  | { type: 'sendStarted' } | { type: 'thinkingTick' }
  /** Transcript-first: /v1/transcribe answered; the text note is about to be sent. */
  | { type: 'transcriptReady'; transcript: string }
  | { type: 'outboxChanged'; count: number }
  | { type: 'remindResult'; ok: boolean; names: string[] }
  | { type: 'coverageUpdated'; coverage: Coverage; nextStudent: NextStudent | null }
  | { type: 'runsLoaded'; utteranceId: string; runs: UtteranceRun[] | null; final: boolean }
  | { type: 'wrapupLoaded'; wrapup: WrapUp }
  | { type: 'nod' }
  | { type: 'timerEnded' }
  | { type: 'statusExpired' }
  | { type: 'actionFailed'; message: string }
  /** Planning listen: a second of recording passed. */
  | { type: 'planTick'; sec: number }
  /** Planning listen: the transcript so far (chunks joined in order). */
  | { type: 'planHeard'; text: string }
  /** Planning listen: every chunk is transcribed; the plan edit request is going out. */
  | { type: 'planApplying' }
  /** `missed` = chunks that could not be transcribed (the plan was made from the rest). */
  | { type: 'planResult'; res: VoicePlanResponse; missed?: number }
  /** Planning listen ended without a plan edit (mic failed, nothing heard, request failed). */
  | { type: 'planFailed'; message: string }
  | { type: 'planUndone'; ok: boolean; message?: string }
  /** Insights fetched: `lobby` = on lobby enter (for `classId`), `session` = the in-class poll, `wrapup` = at class end. */
  | { type: 'insightsLoaded'; scope: 'lobby' | 'session' | 'wrapup'; insights: Insight[]; classId?: string }
  /** The insight banner's INSIGHT_BANNER_MS ran out. */
  | { type: 'bannerExpired' }

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
  | { type: 'remind'; sessionId: string; studentIds: string[]; names: string[] }
  | { type: 'pollRuns'; utteranceId: string }
  | { type: 'expireStatus'; ms: number }
  | { type: 'flushOutbox' }
  | { type: 'exit' }
  | { type: 'startPlan'; classId: string }
  | { type: 'stopPlan' }
  | { type: 'cancelPlan' }
  | { type: 'undoPlan'; diffId: string }
  | { type: 'loadInsights'; classId: string }
  | { type: 'expireBanner'; ms: number }
