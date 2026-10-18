/**
 * DEV ONLY: hard-coded lens states for store screenshots (`?fixture=<name>` under `vite` dev). Loaded
 * through a dynamic import behind `import.meta.env.DEV` in main.ts, so none of it is in a production build.
 * Every state is a real LensState: the real render path draws it, exactly as the app would.
 */
import type { Brief, Drill, Insight, Today } from '@matside/shared'
import type { Api } from '../core/api'
import { initialState } from './reducer'
import type { ClassOption, LensState } from './state'

export const FIXTURE_NAMES = ['home', 'lobby', 'planning', 'planResult', 'peek', 'banner', 'card', 'answer', 'brief', 'wrapup'] as const
export type FixtureName = (typeof FIXTURE_NAMES)[number]
export const isFixtureName = (n: string | null): n is FixtureName => (FIXTURE_NAMES as readonly string[]).includes(n ?? '')

const drill = (id: string, position: number, name: string, minutes: number, kind: Drill['kind'], cues: string[], focusStudentIds: string[] = []): Drill =>
  ({ id, position, name, minutes, kind, cues, focusStudentIds, rationale: '', startedAt: null, endedAt: null })

const KIDS = ['Priya Rao', 'Sam Ortiz', 'Ava Chen', 'Ben Park', 'Jake Miller', 'Gus Hill', 'Eli Brooks', 'Mia Lopez', 'Leo Diaz', 'Maya Singh', 'Ivy Cruz', 'Cal Reed']
const roster = KIDS.map((name, i) => ({ id: `k${i + 1}`, name, nickname: null, belt: i % 3 ? 'white' : 'yellow' }))

/** Tuesday kids' class from the demo seed (api/src/db/seed.ts), with "Pad rotation" mid-class. */
const DRILLS: Drill[] = [
  drill('d1', 1, 'Warm-up: stance tag', 6, 'warmup', ['low stances only']),
  drill('d2', 2, 'Horse stance holds', 4, 'technique', ['knees out', 'back tall']),
  drill('d3', 3, 'Guard-up jab drill', 6, 'drill', ['hands back to cheeks', 'chin down'], ['k1', 'k2', 'k3', 'k4']),
  drill('d4', 4, 'Partner pad drill', 6, 'drill', ['switch on the whistle']),
  drill('d5', 5, 'Pad rotation', 6, 'drill', ['chamber first']),
  drill('d6', 6, 'Kata 1 · white belts', 6, 'forms', ['count out loud']),
  drill('d7', 7, 'Sharks & minnows', 5, 'game', ['stances when tagged']),
  drill('d8', 8, 'Bow-out & reflection', 2, 'warmup', ['one thing you improved']),
]

const TODAY: Today = {
  classId: 'c-tue', className: 'Kids · Tue', startTime: '5:00 PM', forDate: '2026-10-20', sessionId: null,
  mode: 'martial_arts', modeLabel: 'Martial arts', weeklyLabel: 'Weekly theme', itemsDueLabel: 'Forms due', planUnit: 'Drill deck', people: 'students',
  theme: 'Stances', formsDue: ['Kata 1'], focus: [{ label: 'Guard up on the jab', studentIds: ['k1', 'k2'], studentNames: ['Priya Rao', 'Sam Ortiz'] }],
  deck: { id: 'deck-tue', classId: 'c-tue', forDate: '2026-10-20', status: 'active', drills: DRILLS },
  roster,
}

const CLASSES: ClassOption[] = [
  { id: 'c-tue', name: 'Kids · Tue', modeLabel: 'Martial arts' },
  { id: 'c-thu', name: 'Kids · Thu', modeLabel: 'Martial arts' },
  { id: 'c-pt', name: 'PT · Mon 6:00', modeLabel: 'Personal training' },
  { id: 'c-alg', name: 'Algebra · Wed 4:00', modeLabel: 'Tutoring' },
]

const insight = (id: string, title: string, detail: string, studentName: string | null, actionLabel: string | null): Insight => ({
  id, kind: 'demo', studentId: null, studentName, classId: 'c-tue', title, detail, urgency: 'high', status: 'new', createdAt: '2026-10-20T17:00:00Z', actionLabel,
})

const GUS_READY = insight('i-gus', 'Gus ready to test', '120 days at green belt · 11/12 classes', 'Gus Hill', 'Plan test')
const JAKE_BACK = insight('i-jake', 'Jake\'s back after 3 missed', 'Welcome him back · missed 3 in a row', 'Jake Miller', 'Email family')

const PRIYA_BRIEF: Brief = { name: 'Priya Rao', lines: ['Yellow belt · 8 months at rank', 'Guard drops on the jab (3 this month)', 'Kata 2 due · strong stances', 'Attended 11 of the last 12', 'Focus: guard in the jab drill'] }
const GUARD_ANSWER: Brief = { name: 'Answer', lines: ['Guard: Priya (3), Sam (3), Ava (1),', 'Ben (1)'] }

const AGENTS_DONE = (at: string) => [
  { agent: 'router', summary: 'progress note', status: 'ok', createdAt: at },
  { agent: 'report_card', summary: 'guard (3rd time)', status: 'ok', createdAt: at },
  { agent: 'planner', summary: 'next deck change queued', status: 'ok', createdAt: at },
]

/** The fixture's state at `now` (class time, drill clock and progress are relative to it). */
export function fixtureState(name: FixtureName, now: number): LensState {
  const base: LensState = { ...initialState(true), today: TODAY, classes: CLASSES }
  const inClass: LensState = {
    ...base, today: { ...TODAY, sessionId: 's-demo' }, session: { id: 's-demo', startedAt: now - 24 * 60_000 },
    active: { drillId: 'd5', startedAt: now - (2 * 60 + 15) * 1000 },
    coverage: { covered: 7, present: 12 }, nextStudent: { id: 'k7', name: 'Eli', reason: 'no feedback yet' },
  }
  const card = (over: Partial<NonNullable<LensState['card']>>): LensState => ({
    ...inClass, screen: 'card',
    card: { lines: [], transcript: '', utteranceId: 'u-demo', runs: AGENTS_DONE(new Date(now).toISOString()), runsFinal: true, page: 0, ...over },
  })
  switch (name) {
    case 'home': return { ...base, screen: 'home' }
    case 'lobby': return { ...base, screen: 'lobby', lobbyInsight: GUS_READY }
    case 'planning': return { ...base, screen: 'planning', planning: { stage: 'listening', sec: 45, heard: 'swap Kata 2 for partner pad work, and cut the warm-up to six' } }
    case 'planResult': return { ...base, screen: 'planResult', planResult: { diffId: 'diff-demo', lines: ['+ Partner pad drill 6m', '- Kata 2', '~ Warm-up 10→6m'], missed: 0 } }
    case 'peek': return { ...inClass, screen: 'peek' }
    case 'banner': return { ...inClass, screen: 'peek', insightBanner: JAKE_BACK, insightKnown: [JAKE_BACK.id] }
    case 'card': return card({
      lines: ['√ Priya · guard (3rd time)', '→ added to report card', '→ next deck change to review'],
      transcript: 'Priya keeps dropping her guard on the jab',
    })
    case 'answer': return card({ lines: ['Answer'], transcript: 'who is forgetting to keep their guard up?', brief: GUARD_ANSWER, runs: null })
    case 'brief': return card({ lines: ['Priya Rao'], transcript: 'how is Priya doing?', brief: PRIYA_BRIEF, runs: null })
    case 'wrapup': return {
      ...inClass, screen: 'wrapup', active: null,
      wrapup: { sessionId: 's-demo', minutes: 40, drillsRun: 6, coverage: { covered: 9, present: 12 }, missed: [{ id: 'k7', name: 'Eli' }, { id: 'k8', name: 'Mia' }, { id: 'k9', name: 'Leo' }], agentActions: 7, pendingReview: 3 },
      wrapupInsight: { ...JAKE_BACK, title: 'Jake back after 3 missed' },
    }
  }
}

/** An Api whose every call stays pending: the fixture state is never replaced by a load. */
export function noopApi(): Api {
  return new Proxy({} as Api, { get: (_t, key) => (key === 'then' ? undefined : () => new Promise(() => {})) })
}
