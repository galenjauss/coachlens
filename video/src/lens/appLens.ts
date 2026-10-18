/**
 * Bridge to the REAL CoachLens lens code. Every lens frame in the video is a PageSpec produced by the
 * app's own `render(state, now)`; states come from the app's `fixtureState()` or are built the same way
 * fixtures.ts builds them. Nothing here re-implements the layout.
 */
import { buildCardLines } from '../../../api/src/logic/cardLines'
import { fixtureState, type FixtureName } from '../../../app/src/lens/fixtures'
import { render, type PageSpec } from '../../../app/src/lens/render'
import { remindedStatus } from '../../../app/src/lens/reducer'
import type { LensState } from '../../../app/src/lens/state'

export type { PageSpec, TextSpec } from '../../../app/src/lens/render'

/** Class time used for every fixture: Tue 20 Oct 2026, 5:24 PM local-ish (only differences matter). */
export const NOW = Date.UTC(2026, 9, 20, 17, 24, 0)

export const fixtureSpec = (name: FixtureName, elapsedMs = 0): PageSpec => render(fixtureState(name, NOW), NOW + elapsedMs)

export const DARK_SPEC: PageSpec = render({ ...fixtureState('peek', NOW), screen: 'dark' }, NOW)

/** Peek with the drill clock running `elapsedMs` past the fixture's moment. */
export const peekSpec = (elapsedMs = 0): PageSpec => fixtureSpec('peek', elapsedMs)

/** Planning listen: `● Planning · m:ss` with the words heard so far. */
export function planningSpec(sec: number, heard: string): PageSpec {
  const s = fixtureState('planning', NOW)
  return render({ ...s, planning: { stage: 'listening', sec, heard } }, NOW)
}

/** The plan diff after the planning talk (the demo script's diff). */
export const PLAN_DIFF = ['+ Partner sparring 6m', '- Kata 2', '~ Warm-up 10→5m']
export function planResultSpec(): PageSpec {
  const s = fixtureState('planResult', NOW)
  return render({ ...s, planResult: { diffId: 'diff-demo', lines: PLAN_DIFF, missed: 0 } }, NOW)
}

/** Recording a note mid-class: the mic line ticks (500 ms per tick). */
export function recordingSpec(tick: number): PageSpec {
  const s = fixtureState('peek', NOW)
  return render({
    ...s, screen: 'recording',
    pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: NOW },
    mic: { tick, audio: tick > 0, source: 'glasses' },
  }, NOW)
}

/** The "thinking" stage line while a note is on its way. */
export function sendingSpec(stage: 'heard' | 'sending' | 'thinking', tick: number): PageSpec {
  const s = fixtureState('peek', NOW)
  return render({
    ...s, screen: 'sending',
    pending: { mode: 'note', returnTo: 'peek', viaLongPress: false, at: NOW },
    thinking: { stage, tick, since: NOW },
  }, NOW)
}

type Run = { agent: string; summary: string; status: string; createdAt: string }
const run = (agent: string, status = 'ok'): Run => ({ agent, summary: '', status, createdAt: new Date(NOW).toISOString() })

function cardState(lines: string[], transcript: string, runs: Run[] | null, runsFinal: boolean, over: Partial<LensState> = {}): LensState {
  const base = fixtureState('card', NOW)
  return { ...base, ...over, card: { ...base.card!, lines, transcript, runs: runs as never, runsFinal, page: 0, brief: null } }
}

/** Priya's 3rd guard note: the app's own card fixture. */
export const priyaCardSpec = (): PageSpec => fixtureSpec('card')

/** Dee's urgent note: card lines from the API's real `buildCardLines`, parent email still drafting. */
export const DEE_LINES = buildCardLines([{ kind: 'feedback', name: 'Dee', tag: null, count: 1, recurring: false, urgent: true, mail: 'review' }])
export const DEE_SAID = 'Dee rolled her ankle and sat out the last drill'
export function deeCardSpec(done: boolean): PageSpec {
  return render(cardState(DEE_LINES, DEE_SAID, done ? [run('router'), run('parent_email')] : [run('router')], done), NOW)
}

/** The PT client's lift: a metric card, lines from the API's `buildCardLines`. */
export const MARIA_LINES = buildCardLines([{ kind: 'metric', name: 'Maria', text: 'deadlift 225 lb (PR +10)' }])
export function mariaCardSpec(): PageSpec {
  return render(cardState(MARIA_LINES, 'Maria hit 225 on deadlift', [run('router'), run('progress')], true), NOW)
}

export const briefSpec = (): PageSpec => fixtureSpec('brief')
export const answerSpec = (): PageSpec => fixtureSpec('answer')
export const bannerSpec = (elapsedMs = 0): PageSpec => fixtureSpec('banner', elapsedMs)
export const wrapupSpec = (): PageSpec => fixtureSpec('wrapup')
export const lobbySpec = (): PageSpec => fixtureSpec('lobby')
export const homeSpec = (): PageSpec => fixtureSpec('home')

/** After the planning tap: transcribing the last chunk, then the planner applying the talk. */
export function planApplyingSpec(stage: 'transcribing' | 'applying'): PageSpec {
  const s = fixtureState('planning', NOW)
  return render({ ...s, screen: 'planApplying', planning: { stage, sec: 19, heard: '' } }, NOW)
}

/** After the wrap-up tap: the lens goes home and the footer confirms the reminder (the reducer's own status). */
export function homeRemindedSpec(): PageSpec {
  return render({ ...fixtureState('home', NOW), status: remindedStatus(['Eli', 'Mia', 'Leo']) }, NOW)
}
