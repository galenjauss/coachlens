/**
 * DEV ONLY: animated lens FLOWS for the launch video, as frame sequences. Each frame is a real LensState
 * reached by dispatching real events into the real reducer (so the text is exactly what the app shows),
 * plus the fixed clock `now` the real render() draws it at. Loaded only through fixtureBoot (dynamic
 * import behind `import.meta.env.DEV` in main.ts), so none of it is in a production build.
 *
 * The data matches the demo seed (api/src/db/seed.ts, seedModes.ts): the Tue kids' class, its deck,
 * Priya / Jake / Gus / Dee, Maria in PT.
 */
import type { Drill, Insight, Today, UtteranceResponse, WrapUp } from '@matside/shared'
import type { UtteranceRun } from '../core/api'
import { initialState, reduce } from './reducer'
import type { ClassOption, LensEvent, LensState } from './state'

export interface FlowFrame {
  /** Fixture-control name (letters only, see vite.config.ts): `<flow>F<letter>`. */
  id: string
  flow: string
  index: number
  caption: string
  holdMs: number
  state: LensState
  now: number
}

/** Tue 2026-10-20, 5:24 PM in Los Angeles: 24 minutes into the kids' class. */
export const FLOW_NOW = Date.parse('2026-10-21T00:24:00Z')
const SEC = 1000
const MIN = 60 * SEC

const drill = (id: string, position: number, name: string, minutes: number, kind: Drill['kind'], cues: string[], focusStudentIds: string[] = []): Drill =>
  ({ id, position, name, minutes, kind, cues, focusStudentIds, rationale: '', startedAt: null, endedAt: null })

/** The seed's 14 kids (enrolled in both kids' classes). */
const KIDS: [string, string, string][] = [
  ['s-priya', 'Priya Rao', 'orange'], ['s-leo', 'Leonardo Diaz', 'yellow'], ['s-jake', 'Jake Ross', 'white'], ['s-mia', 'Mia Lopez', 'white'],
  ['s-maya', 'Maya Chen', 'yellow'], ['s-sam', 'Sam Lee', 'green'], ['s-ava', 'Ava Kim', 'green'], ['s-ben', 'Ben Ortiz', 'white'],
  ['s-cal', 'Cal Wu', 'yellow'], ['s-dee', 'Dee Park', 'orange'], ['s-eli', 'Eli Shah', 'white'], ['s-fay', 'Fay Ng', 'yellow'],
  ['s-gus', 'Gus Hill', 'green'], ['s-ivy', 'Ivy Cruz', 'orange'],
]
const ROSTER = KIDS.map(([id, name, belt]) => ({ id, name, nickname: name.startsWith('Leonardo') ? 'Leo' : null, belt }))
const GUARD_KIDS = ['s-priya', 's-sam', 's-ava', 's-ben']

/** The seed deck (both kids' classes). */
const KIDS_DECK: Drill[] = [
  drill('d1', 1, 'Warm-up: stance tag', 5, 'warmup', ['low stances only']),
  drill('d2', 2, 'Horse stance holds', 4, 'technique', ['knees out', 'back tall']),
  drill('d3', 3, 'Front stance transitions', 5, 'technique', ['back leg straight', 'hips square'], ['s-maya']),
  drill('d4', 4, 'Guard-up jab drill', 6, 'drill', ['hands back to cheeks', 'chin down'], GUARD_KIDS),
  drill('d5', 5, 'Kata 2 · yellow belts', 8, 'forms', ['slow and sharp']),
  drill('d6', 6, 'Kata 1 · white belts', 6, 'forms', ['count out loud']),
  drill('d7', 7, 'Sharks & minnows', 5, 'game', ['stances when tagged']),
  drill('d8', 8, 'Pad rotation: kicks', 6, 'drill', ['chamber first']),
  drill('d9', 9, 'Bow-out & reflection', 2, 'warmup', ['one thing you improved']),
]

const kidsToday = (classId: string, className: string, forDate: string): Today => ({
  classId, className, startTime: '5:00 PM', forDate, sessionId: null,
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  theme: 'Stances', formsDue: ['Kata 2 (yellow+)', 'Kata 1 (white)'],
  focus: [{ label: 'Guard up on the jab', studentIds: GUARD_KIDS, studentNames: ['Priya Rao', 'Sam Lee', 'Ava Kim', 'Ben Ortiz'] }],
  deck: { id: `deck-${classId}`, classId, forDate, status: 'active', drills: KIDS_DECK },
  roster: ROSTER,
})
const TUE = kidsToday('c-tue', 'Kids · Tue', '2026-10-20')
const THU = kidsToday('c-thu', 'Kids · Thu', '2026-10-22')

const PT_PLAN: Drill[] = [
  drill('p1', 1, 'Bike + hip openers', 8, 'warmup', ['easy pace', 'open the hips']),
  drill('p2', 2, 'Back squat 5×5', 12, 'technique', ['5×5 @ RPE 7', 'chest up · drive through heels']),
  drill('p3', 3, 'Deadlift form check', 10, 'technique', ['3×5 light', 'brace · push the floor away']),
  drill('p4', 4, 'Goblet box squat', 6, 'drill', ['3×8 to the box', 'knees out · sit between heels'], ['s-maria']),
  drill('p5', 5, 'Walking lunges', 6, 'drill', ['3×10 each leg', 'tall torso']),
  drill('p6', 6, 'Sled push finisher', 5, 'game', ['4 lengths', 'drive with the legs']),
  drill('p7', 7, 'Cool-down stretch', 6, 'warmup', ['slow nasal breathing']),
]
const CLIENTS = [['s-maria', 'Maria Gomez'], ['s-tom', 'Tom Becker'], ['s-priyanka', 'Priyanka Shah'], ['s-derek', 'Derek Owens'], ['s-lena', 'Lena Fischer']]
const PT: Today = {
  classId: 'c-pt', className: 'PT · Mon 6:00', startTime: '6:00 PM', forDate: '2026-10-19', sessionId: null,
  mode: 'personal_training', modeLabel: 'Personal training', weeklyLabel: 'Program block', itemsDueLabel: 'Goals', planUnit: 'Session plan', people: 'clients',
  theme: 'Lower-body strength', formsDue: ['Squat 5×5', 'Deadlift form check'],
  focus: [{ label: 'Squat depth', studentIds: ['s-maria'], studentNames: ['Maria Gomez'] }],
  deck: { id: 'deck-pt', classId: 'c-pt', forDate: '2026-10-19', status: 'active', drills: PT_PLAN },
  roster: CLIENTS.map(([id, name]) => ({ id: id!, name: name!, nickname: null, belt: 'client' })),
}

const CLASSES: ClassOption[] = [
  { id: 'c-tue', name: 'Kids · Tue', modeLabel: 'Martial arts' },
  { id: 'c-thu', name: 'Kids · Thu', modeLabel: 'Martial arts' },
  { id: 'c-pt', name: 'PT · Mon 6:00', modeLabel: 'Personal training' },
  { id: 'c-alg', name: 'Algebra · Wed 4:00', modeLabel: 'Tutoring' },
]

const insight = (id: string, title: string, detail: string, studentId: string, studentName: string, actionLabel: string, createdAt: number): Insight => ({
  id, kind: id.slice(2), studentId, studentName, classId: 'c-tue', title, detail, urgency: 'high', status: 'new', createdAt: new Date(createdAt).toISOString(), actionLabel,
})
const GUS_READY = insight('i-ready_to_test', 'Gus ready to test', '120 days at green belt · no open issues', 's-gus', 'Gus Hill', 'Plan test', FLOW_NOW - 3 * 60 * MIN)
const JAKE_BACK = insight('i-attendance_back', 'Jake\'s back after 3 missed', 'Welcome him back · missed 3 in a row', 's-jake', 'Jake Ross', 'Email family', FLOW_NOW - 20 * MIN)

const run = (agent: string, summary: string, status = 'ok'): UtteranceRun => ({ agent, summary, status, createdAt: new Date(FLOW_NOW).toISOString() })

// ---------------------------------------------------------------------------------------------------
// Building blocks: dispatch events into the real reducer.

const apply = (s: LensState, ...events: LensEvent[]): LensState => events.reduce((st, e) => reduce(st, e).state, s)

const HOME: LensState = { ...initialState(true), today: TUE, classes: CLASSES }
const SESSION_START = FLOW_NOW - 24 * MIN
const started = (today: Today, sessionId: string): LensEvent =>
  ({ type: 'sessionStarted', res: { sessionId, startedAt: new Date(SESSION_START).toISOString(), coverage: { covered: 0, present: 0 }, nextStudent: null }, resumed: true, now: SESSION_START })

/** In class: the Tue session, roll call done (13 present), the guard-up jab drill 2:15 in. */
function inClass(today: Today = TUE, drillId = 'd4', present = 13): LensState {
  const s = apply({ ...HOME, today: { ...today, sessionId: null } }, started(today, `s-${today.classId}`))
  const withDrill: LensState = { ...s, active: { drillId, startedAt: FLOW_NOW - (2 * 60 + 15) * SEC } }
  const next = today === PT ? { id: 's-lena', name: 'Lena', reason: 'no feedback yet' } : { id: 's-eli', name: 'Eli', reason: 'no feedback yet' }
  return apply(withDrill, { type: 'coverageUpdated', coverage: { covered: today === PT ? 2 : 7, present }, nextStudent: next })
}
const IN_CLASS = inClass()

const reply = (utteranceId: string, transcript: string, cardLines: string[], s: LensState, over: Partial<UtteranceResponse> = {}): LensEvent =>
  ({ type: 'utteranceResult', res: { utteranceId, transcript, cardLines, coverage: s.coverage, nextStudent: s.nextStudent, disambiguation: null, ...over } })

/** Peek → tap (record) → tap (send): the "sending" screen, as the coach just finished speaking. */
function sent(s: LensState, at = FLOW_NOW): LensState {
  return apply(s, { type: 'tap', now: at }, { type: 'tap', now: at + 4 * SEC })
}

// ---------------------------------------------------------------------------------------------------
// The flows. Each frame: [caption, hold ms, state, now].

type F = [caption: string, holdMs: number, state: LensState, now?: number]

function homeFlow(): F[] {
  const thuPick = apply(HOME, { type: 'swipeDown' })
  const thu = apply(thuPick, { type: 'todayLoaded', today: THU })
  const ptPick = apply(thu, { type: 'swipeDown' })
  const pt = apply(ptPick, { type: 'todayLoaded', today: PT })
  return [
    ['Home: today\'s class, Kids · Tue (1/4), tap to start', 1600, HOME],
    ['Swipe: Kids · Thu (2/4)', 900, thu],
    ['Swipe: PT · Mon 6:00 (3/4), personal training', 1200, pt],
  ]
}

function lobbyFlow(): F[] {
  const lobby = apply(HOME, { type: 'tap', now: FLOW_NOW })
  const withInsight = apply(lobby, { type: 'insightsLoaded', scope: 'lobby', insights: [GUS_READY], classId: 'c-tue' })
  return [
    ['Lobby: class, start time, plan length, first drills', 900, lobby],
    ['Lobby with the agents\' top insight: ★ Gus ready to test', 2000, withInsight],
  ]
}

const LOBBY_I = apply(HOME, { type: 'tap', now: FLOW_NOW }, { type: 'insightsLoaded', scope: 'lobby', insights: [GUS_READY], classId: 'c-tue' })
const HEARD = [
  'Let\'s cut Kata 2 today',
  'Let\'s cut Kata 2 today, do a shorter warm-up',
  'Let\'s cut Kata 2 today, do a shorter warm-up, and add partner sparring',
]
const PLANNING = apply(LOBBY_I, { type: 'doubleTap' })
const planAt = (sec: number, heard: string) => apply(PLANNING, { type: 'planTick', sec }, { type: 'planHeard', text: heard })

function planningFlow(): F[] {
  return [
    ['Double-tap in the lobby: planning by voice opens the mic', 700, PLANNING],
    ['● Planning · 0:05, the transcript so far', 900, planAt(5, HEARD[0]!)],
    ['● Planning · 0:10, "…a shorter warm-up"', 900, planAt(10, HEARD[1]!)],
    ['● Planning · 0:15, "…add partner sparring"', 1400, planAt(15, HEARD[2]!)],
  ]
}

function planResultFlow(): F[] {
  const transcribing = apply(planAt(15, HEARD[2]!), { type: 'tap', now: FLOW_NOW })
  const applying = apply(transcribing, { type: 'planApplying' })
  const result = apply(applying, { type: 'planResult', res: { diffId: 'diff-1', deckId: 'deck-c-tue', lines: ['+ Partner sparring 6m', '- Kata 2 · yellow belts', '~ Warm-up: stance tag 5→3m'] } })
  return [
    ['Tap to apply: transcribing the last of the talk', 700, transcribing],
    ['Thinking · updating the plan', 1000, applying],
    ['PLAN UPDATED: the diff (added, removed, re-timed), 2× to undo', 2400, result],
  ]
}

function peekFlow(): F[] {
  const covered = apply(IN_CLASS, { type: 'coverageUpdated', coverage: { covered: 8, present: 13 }, nextStudent: { id: 's-mia', name: 'Mia', reason: 'no feedback yet' } })
  return [0, 1, 2, 3, 4, 5].map((k): F => [
    `Peek: guard-up jab drill, ${['3:45', '3:30', '3:15', '3:00', '2:45', '2:30'][k]} left, bar advancing${k >= 3 ? ', next kid: Mia' : ''}`,
    700, k >= 3 ? covered : IN_CLASS, FLOW_NOW + k * 15 * SEC,
  ])
}

function peekTickFlow(): F[] {
  return [0, 1, 2, 3, 4].map((k): F => [`Peek clock, per-second tick: ${['3:45', '3:44', '3:43', '3:42', '3:41'][k]} left`, 1000, IN_CLASS, FLOW_NOW + k * SEC])
}

function recordingFlow(): F[] {
  const rec = apply(IN_CLASS, { type: 'tap', now: FLOW_NOW })
  const mic = (tick: number) => apply(rec, { type: 'micLevel', tick, audio: true, source: 'glasses' })
  return [
    ['Tap: recording opens, waiting for the glasses mic', 500, rec],
    ['● LISTENING 0:01', 500, mic(2)],
    ['○ LISTENING 0:01 (pulse)', 500, mic(3)],
    ['● LISTENING 0:02', 500, mic(4)],
    ['○ LISTENING 0:02 (pulse)', 500, mic(5)],
  ]
}

const PRIYA_SAID = 'Priya keeps dropping her guard on the jab'
const PRIYA_LINES = ['√ Priya · guard (3rd time)', '→ progress logged', '→ added to report card', '→ next deck change to review']

function noteFlow(): F[] {
  const heard = sent(IN_CLASS)
  const sending = apply(heard, { type: 'sendStarted' })
  const thinking = apply(sending, { type: 'thinkingTick' }, { type: 'thinkingTick' }, { type: 'thinkingTick' })
  const thinking2 = apply(thinking, { type: 'thinkingTick' })
  const provisional = apply(thinking2, { type: 'transcriptReady', transcript: PRIYA_SAID })
  const card = apply(provisional, reply('u-priya', PRIYA_SAID, PRIYA_LINES, provisional))
  const runs = (rs: UtteranceRun[], final = false) => apply(card, { type: 'runsLoaded', utteranceId: 'u-priya', runs: rs, final })
  return [
    ['Tap to stop: HEARD', 400, heard],
    ['SENDING', 500, sending],
    ['THINKING', 500, thinking],
    ['THINKING (dots)', 500, thinking2],
    ['Transcript first: what you said, agents still sorting', 1100, provisional],
    ['The card: √ Priya · guard (3rd time), agents working', 700, card],
    ['Agent progress: .. sorted · .. plan', 600, runs([])],
    ['ok sorted', 600, runs([run('router', 'progress note')])],
    ['ok sorted · ok report', 600, runs([run('router', 'progress note'), run('report_card', 'guard (3rd time)')])],
    ['All agents done: ok sorted · ok report · ok plan', 2200, runs([run('router', 'progress note'), run('report_card', 'guard (3rd time)'), run('planner', 'next deck change queued')], true)],
  ]
}

function rollCallFlow(): F[] {
  const lobby = apply(HOME, { type: 'tap', now: FLOW_NOW })
  const starting = apply(lobby, { type: 'tap', now: FLOW_NOW })
  const res = { sessionId: 's-c-tue', startedAt: new Date(FLOW_NOW).toISOString(), coverage: { covered: 0, present: 0 }, nextStudent: null }
  const roll = apply(starting, { type: 'sessionStarted', res, resumed: false, now: FLOW_NOW })
  const mic = (tick: number) => apply(roll, { type: 'micLevel', tick, audio: true, source: 'glasses' })
  const sending = apply(mic(6), { type: 'tap', now: FLOW_NOW + 4 * SEC }, { type: 'sendStarted' }, { type: 'thinkingTick' }, { type: 'thinkingTick' }, { type: 'thinkingTick' })
  const done = apply(sending, reply('u-roll', 'Everyone except Mia', ['13 present', 'absent: Mia'], sending, {
    coverage: { covered: 0, present: 13 }, nextStudent: { id: 's-eli', name: 'Eli', reason: 'no feedback yet' }, attendanceChanged: true,
  }))
  const first = apply(done, { type: 'tap', now: FLOW_NOW + 10 * SEC })
  return [
    ['Lobby tap: starting class', 500, starting],
    ['Roll call opens: say "Everyone except …"', 900, roll],
    ['● LISTENING 0:02 (coach: "everyone except Mia")', 600, mic(4)],
    ['○ LISTENING 0:02', 600, mic(5)],
    ['THINKING', 600, sending],
    ['ROLL CALL DONE: 13 present · absent: Mia', 2000, done],
    ['Tap: the first drill starts on peek', 1200, first, FLOW_NOW + 25 * SEC],
  ]
}

function bannerFlow(): F[] {
  const banner = apply(IN_CLASS, { type: 'insightsLoaded', scope: 'session', insights: [JAKE_BACK] })
  return [
    ['Peek mid-drill', 700, IN_CLASS],
    ['Insight banner: ★ Jake\'s back after 3 missed', 2200, banner],
  ]
}

/** A voice note through sending → transcript-first card → final card → agent runs. */
function noteCard(base: LensState, id: string, said: string, lines: string[], steps: UtteranceRun[][], over: Partial<UtteranceResponse> = {}): { provisional: LensState; card: LensState; runs: LensState[] } {
  const thinking = apply(sent(base), { type: 'sendStarted' }, { type: 'thinkingTick' }, { type: 'thinkingTick' }, { type: 'thinkingTick' })
  const provisional = apply(thinking, { type: 'transcriptReady', transcript: said })
  const card = apply(provisional, reply(id, said, lines, provisional, over))
  const runs = steps.map((rs, i) => apply(card, { type: 'runsLoaded', utteranceId: id, runs: rs, final: i === steps.length - 1 }))
  return { provisional, card, runs }
}

function urgentFlow(): F[] {
  const said = 'Dee rolled her ankle and sat out the last drill'
  const { provisional, card, runs } = noteCard(IN_CLASS, 'u-dee', said, ['√ Dee · injury', '! urgent · parent note drafting'], [
    [run('router', 'urgent note')],
    [run('router', 'urgent note'), run('parent_email', 'Dee sat out the last drill')],
  ])
  return [
    ['Transcript first: "Dee rolled her ankle…"', 1000, provisional],
    ['Card: √ Dee · injury, ! urgent · parent note drafting', 900, card],
    ['ok sorted · .. email', 700, runs[0]!],
    ['ok sorted · ok email: the parent email is drafted for review', 2200, runs[1]!],
  ]
}

function prFlow(): F[] {
  const said = 'Maria hit 225 on deadlift'
  const pt = inClass(PT, 'p3', 5)
  const { provisional, card, runs } = noteCard(pt, 'u-maria', said, ['√ Maria · deadlift 225 lb (PR +10)'], [
    [run('router', 'metric'), run('progress', 'Maria: deadlift 225 lb (PR +10)')],
  ])
  return [
    ['PT class: transcript first, "Maria hit 225 on deadlift"', 900, provisional],
    ['Card: √ Maria · deadlift 225 lb (PR +10)', 900, card],
    ['ok sorted · ok logged', 2000, runs[0]!],
  ]
}

const PRIYA_BRIEF = { name: 'Priya Rao', lines: ['Orange belt · 8 months at rank', 'Guard drops on the jab (3 this month)', 'Kata 2 due · strong stances', 'Attended 11 of the last 12', 'Focus: guard in the jab drill'] }

function briefFlow(): F[] {
  const said = 'How\'s Priya doing?'
  const { provisional, card, runs } = noteCard(IN_CLASS, 'u-brief', said, ['Priya · see profile'], [[run('router', 'student query'), run('progress', 'Priya brief')]], { brief: PRIYA_BRIEF })
  const swiped = apply(runs[0]!, { type: 'swipeDown' })
  return [
    ['Transcript first: "How\'s Priya doing?"', 900, provisional],
    ['Brief: Priya Rao, five glanceable lines', 2600, card],
    ['Swipe: page 2, what you said', 1000, swiped],
  ]
}

function answerFlow(): F[] {
  const said = 'Who is forgetting to keep their guard up?'
  const answer = { name: 'Answer', lines: ['Guard: Priya (3), Sam (3), Ava (1),', 'Ben (1)'] }
  const { provisional, card } = noteCard(IN_CLASS, 'u-answer', said, ['? Who is forgetting to keep their…'], [[run('router', 'class question')]], { brief: answer })
  return [
    ['Transcript first: "Who is forgetting to keep their guard up?"', 1000, provisional],
    ['ANSWER: Guard: Priya (3), Sam (3), Ava (1), Ben (1)', 2600, card],
  ]
}

function wrapupFlow(): F[] {
  const late = apply(IN_CLASS, { type: 'coverageUpdated', coverage: { covered: 11, present: 13 }, nextStudent: { id: 's-eli', name: 'Eli', reason: 'no feedback yet' } })
  const confirm = apply(late, { type: 'doubleTap' })
  const ending = apply(confirm, { type: 'tap', now: FLOW_NOW })
  const summary: WrapUp = { sessionId: 's-c-tue', minutes: 47, drillsRun: 8, coverage: { covered: 11, present: 13 }, missed: [{ id: 's-eli', name: 'Eli' }, { id: 's-fay', name: 'Fay' }], agentActions: 9, pendingReview: 3 }
  const done = apply(ending, { type: 'wrapupLoaded', wrapup: summary })
  const withInsight = apply(done, { type: 'insightsLoaded', scope: 'wrapup', insights: [JAKE_BACK] })
  return [
    ['Double-tap: End class?', 700, confirm],
    ['CLASS DONE: wrapping up', 500, ending],
    ['End-of-class summary', 800, done],
    ['Summary with the top insight: ★ Jake\'s back after 3 missed', 2400, withInsight],
  ]
}

function darkFlow(): F[] {
  return [
    ['Peek', 700, IN_CLASS],
    ['Nod: lens off (fully dark)', 1500, apply(IN_CLASS, { type: 'nod' })],
  ]
}

const BUILDERS: Record<string, () => F[]> = {
  home: homeFlow, lobby: lobbyFlow, planning: planningFlow, planResult: planResultFlow, peek: peekFlow, peekTick: peekTickFlow,
  recording: recordingFlow, note: noteFlow, rollCall: rollCallFlow, banner: bannerFlow, urgent: urgentFlow, pr: prFlow,
  brief: briefFlow, answer: answerFlow, wrapup: wrapupFlow, dark: darkFlow,
}
export const FLOW_NAMES = Object.keys(BUILDERS)

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Every flow's frames, in order. */
export function flowFrames(): FlowFrame[] {
  return FLOW_NAMES.flatMap(flow => BUILDERS[flow]!().map(([caption, holdMs, state, now], index) =>
    ({ id: `${flow}F${LETTERS[index]}`, flow, index, caption, holdMs, state, now: now ?? FLOW_NOW })))
}

export function flowFrame(id: string | null): FlowFrame | null {
  return id ? flowFrames().find(f => f.id === id) ?? null : null
}
