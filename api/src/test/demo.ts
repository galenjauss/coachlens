import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm, type TestDeps } from './helpers'
import { seed } from '../db/seed'
import { classes } from '../db/schema'
import { createApp } from '../app'
import { pairWith } from './tenants'
import type { Deps } from '../deps'

export const DEMO_CODE = 'demo-pair-77'
export const intent = (o: Record<string, unknown>) => ({
  type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, urgent: false,
  metricKey: null, metricValue: null, metricNum: null, metricUnit: null, metricSince: null, question: null, ...o,
})

export interface LlmCall { name: string; prompt: string }
export type Router = (transcript: string) => unknown[]

/**
 * The synthetic demo world (seed) behind the real app, paired as the demo instructor. The router is stubbed per
 * transcript; parent emails get a fixed draft. `gate` (when set) holds the parent-email LLM call until released,
 * so a test can land an Undo while the deferred draft is mid-flight.
 */
export async function demoWorld(router: Router, over: Partial<Deps> = {}) {
  const db = await makeTestDb()
  const ids = await seed(db, { today: '2026-10-19', guardianEmail: i => `parent${i}@example.test`, pairingCode: DEMO_CODE })
  const calls: LlmCall[] = []
  const ctl: { gate: Promise<void> | null; reached: () => void; onReach: Promise<void> } = { gate: null, reached: () => {}, onReach: Promise.resolve() }
  const deps: TestDeps = makeDeps(db, {
    llm: fakeLlm(async a => {
      calls.push({ name: a.name, prompt: a.prompt })
      if (a.name === 'router') {
        const t = /Utterance: """([\s\S]*)"""/.exec(a.prompt)?.[1] ?? ''
        return { intents: router(t) }
      }
      if (a.name === 'parent_email') {
        ctl.reached()
        if (ctl.gate) await ctl.gate
        return { subject: 'A note from class today', body: 'Hello, this is a short factual note from class today about something we saw.' }
      }
      throw new Error(`llm not stubbed: ${a.name}`)
    }),
    ...over,
  })
  const app = createApp(deps)
  const { h } = await pairWith(app, DEMO_CODE)
  const classId = async (name: string) => (await db.select().from(classes).where(eq(classes.name, name)))[0]!.id
  const start = async (name: string) => {
    const r = await app.request('/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ classId: await classId(name) }) })
    return ((await r.json()) as { sessionId: string }).sessionId
  }
  const utter = (sessionId: string, text: string, o: { mode?: 'note' | 'attendance'; key?: string; opId?: string } = {}) => {
    const f = new FormData()
    f.set('sessionId', sessionId); f.set('mode', o.mode ?? 'note'); f.set('text', text)
    if (o.opId) f.set('opId', o.opId)
    return app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization, ...(o.key ? { 'Idempotency-Key': o.key } : {}) }, body: f })
  }
  const undo = (utteranceId: string) => app.request(`/v1/utterances/${utteranceId}/undo`, { method: 'POST', headers: h })
  /** Holds the next parent-email LLM call; resolves `reached` once the draft is mid-flight. */
  const holdEmail = () => {
    let release!: () => void
    ctl.gate = new Promise<void>(r => { release = r })
    ctl.onReach = new Promise<void>(r => { ctl.reached = r })
    return { reached: ctl.onReach, release: () => { ctl.gate = null; release() } }
  }
  return { db, deps, app, h, ids, calls, start, utter, undo, holdEmail, classId }
}
