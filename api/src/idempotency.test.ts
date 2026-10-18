import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { resetRateLimits } from './http/rateLimit'
import { demoWorld, intent } from './test/demo'
import { notes, operations, outbox, utterances, deferredTasks } from './db/schema'
import { opEntityId } from './services/operations'
import { deferOnce } from './services/deferred'

/** C1 / F03: a stable operation id makes a retried POST /v1/utterance replay instead of re-running. */
const dee = (t: string) => (/Dee/.test(t) ? [intent({ studentNames: ['Dee'], content: 'Dee rolled her ankle, sat out', skillTags: [], urgent: true })] : [])

describe('C1 idempotency', () => {
  beforeEach(() => resetRateLimits())

  it('commit succeeds, response is lost, retry with the same opId: one utterance, one note, one draft, identical response', async () => {
    const w = await demoWorld(dee)
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    const first = await w.utter(sid, 'Dee rolled her ankle', { key, opId: key })
    expect(first.status).toBe(200)
    const lost = await first.text() // the client never sees this (network drop after commit)
    const retry = await w.utter(sid, 'Dee rolled her ankle', { key, opId: key })
    expect(retry.status).toBe(200)
    expect(retry.headers.get('Idempotent-Replay')).toBe('true')
    expect(await retry.text()).toBe(lost)
    await w.deps.flush()
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
    expect((await w.db.select().from(notes).where(eq(notes.sessionId, sid))).length).toBe(1)
    expect((await w.db.select().from(outbox).where(eq(outbox.trigger, 'urgent'))).length).toBe(1)
    expect(w.calls.filter(c => c.name === 'router')).toHaveLength(1)
    expect(w.calls.filter(c => c.name === 'parent_email')).toHaveLength(1)
  })

  it('the opId form field alone is enough (no header)', async () => {
    const w = await demoWorld(dee)
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    expect((await w.utter(sid, 'Dee rolled her ankle', { opId: key })).status).toBe(200)
    const again = await w.utter(sid, 'Dee rolled her ankle', { opId: key })
    expect(again.headers.get('Idempotent-Replay')).toBe('true')
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
  })

  it('a concurrent duplicate gets 409 in_progress; the first completes and later retries replay', async () => {
    const w = await demoWorld(dee)
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    let entered!: () => void
    const inRouter = new Promise<void>(r => { entered = r })
    const slow = await demoWorldRouterHold(w, gate, entered)
    const firstP = w.utter(sid, 'Dee rolled her ankle', { key })
    await inRouter
    const dup = await w.utter(sid, 'Dee rolled her ankle', { key })
    expect(dup.status).toBe(409)
    expect(await dup.json()).toEqual({ error: 'in_progress' })
    release()
    const first = await firstP
    expect(first.status).toBe(200)
    slow.restore()
    const later = await w.utter(sid, 'Dee rolled her ankle', { key })
    expect(later.status).toBe(200)
    expect(later.headers.get('Idempotent-Replay')).toBe('true')
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
  })

  it('a failed request releases its key so the retry runs; different keys are different operations', async () => {
    let empty = true
    const w = await demoWorld(dee, { stt: { async transcribe() { return empty ? '  ' : 'Dee rolled her ankle' } } })
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    const audioForm = () => {
      const f = new FormData(); f.set('sessionId', sid); f.set('mode', 'note'); f.set('audio', new File([new Uint8Array(10)], 'a.wav', { type: 'audio/wav' }))
      return f
    }
    const post = () => w.app.request('/v1/utterance', { method: 'POST', headers: { Authorization: w.h.Authorization, 'Idempotency-Key': key }, body: audioForm() })
    expect((await post()).status).toBe(422)
    empty = false
    const ok = await post()
    expect(ok.status).toBe(200)
    expect(ok.headers.get('Idempotent-Replay')).toBeNull()
    expect((await w.utter(sid, 'Dee rolled her ankle', { key: crypto.randomUUID() })).status).toBe(200)
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(2)
    expect((await w.utter(sid, 'x', { key: 'k'.repeat(200) })).status).toBe(400)
  })

  it('transcribe replays its transcript without calling STT again', async () => {
    let n = 0
    const w = await demoWorld(dee, { stt: { async transcribe() { n++; return 'Dee rolled her ankle' } } })
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    const call = () => {
      const f = new FormData(); f.set('sessionId', sid); f.set('audio', new File([new Uint8Array(10)], 'a.wav', { type: 'audio/wav' }))
      return w.app.request('/v1/transcribe', { method: 'POST', headers: { Authorization: w.h.Authorization, 'Idempotency-Key': key }, body: f })
    }
    expect(await (await call()).json()).toEqual({ transcript: 'Dee rolled her ankle' })
    const again = await call()
    expect(again.headers.get('Idempotent-Replay')).toBe('true')
    expect(await again.json()).toEqual({ transcript: 'Dee rolled her ankle' })
    expect(n).toBe(1)
  })

  it('downstream deferred tasks are deduplicated by utterance id and task kind', async () => {
    const w = await demoWorld(dee)
    let runs = 0
    const task = () => { runs++; return Promise.resolve() }
    const [u] = await w.db.insert(utterances).values({ sessionId: null, transcript: 't', mode: 'note' }).returning()
    await deferOnce(w.deps, { utteranceId: u!.id, kind: 'parent_email', subject: 's1' }, task)
    await deferOnce(w.deps, { utteranceId: u!.id, kind: 'parent_email', subject: 's1' }, task)
    await deferOnce(w.deps, { utteranceId: u!.id, kind: 'auto_adjust', subject: 's1' }, task)
    await w.deps.flush()
    expect(runs).toBe(2)
    expect((await w.db.select().from(deferredTasks).where(eq(deferredTasks.utteranceId, u!.id))).map(t => t.status).sort()).toEqual(['done', 'done'])
  })
})

describe('C1 idempotency: fix round 1', () => {
  beforeEach(() => resetRateLimits())

  it('keys are scoped by route: the same opId on transcribe then utterance still runs the utterance', async () => {
    const w = await demoWorld(dee, { stt: { async transcribe() { return 'Dee rolled her ankle' } } })
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    const f = new FormData(); f.set('sessionId', sid); f.set('audio', new File([new Uint8Array(10)], 'a.wav', { type: 'audio/wav' }))
    expect((await w.app.request('/v1/transcribe', { method: 'POST', headers: { Authorization: w.h.Authorization, 'Idempotency-Key': key }, body: f })).status).toBe(200)
    const u = await w.utter(sid, 'Dee rolled her ankle', { key, opId: key })
    expect(u.status).toBe(200)
    expect(u.headers.get('Idempotent-Replay')).toBeNull()
    expect(((await u.json()) as { utteranceId: string }).utteranceId).toBeTruthy()
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
  })

  it('crash gap: work committed but the response was never stored; the takeover finds the utterance, no duplicates', async () => {
    const w = await demoWorld(dee)
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    const first = await w.utter(sid, 'Dee rolled her ankle', { key })
    const { utteranceId } = await first.json() as { utteranceId: string }
    expect(utteranceId).toBe(opEntityId((await w.db.select().from(operations))[0]!.instructorId, 'utterance', key))
    // Simulate the crash: the operation row is left pending and stale, without its response.
    await w.db.update(operations).set({ status: 'pending', responseJson: null, createdAt: new Date('2026-10-19T00:00:00Z') })
    const retry = await w.utter(sid, 'Dee rolled her ankle', { key })
    expect(retry.status).toBe(200)
    const body = await retry.json() as { utteranceId: string; cardLines: string[] }
    expect(body).toMatchObject({ utteranceId, cardLines: ['√ Already saved'] })
    await w.deps.flush()
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
    expect((await w.db.select().from(notes).where(eq(notes.sessionId, sid))).length).toBe(1)
    expect((await w.db.select().from(outbox).where(eq(outbox.trigger, 'urgent'))).length).toBe(1)
  })

  it('a 5xx after a partial write: the retry answers from the committed utterance instead of writing again', async () => {
    let failNow = false
    const w = await demoWorld(() => { failNow = true; return [intent({ studentNames: ['Dee'], content: 'Dee great kicks today' })] })
    const realNow = w.deps.now
    w.deps.now = () => { if (failNow) { failNow = false; throw new Error('boom after the utterance insert') } return realNow() }
    const sid = await w.start('Kids · Tue')
    const key = crypto.randomUUID()
    expect((await w.utter(sid, 'Dee rolled her ankle', { key })).status).toBe(500)
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
    const retry = await w.utter(sid, 'Dee rolled her ankle', { key })
    expect(retry.status).toBe(200)
    expect(((await retry.json()) as { cardLines: string[] }).cardLines).toEqual(['√ Already saved'])
    expect((await w.db.select().from(utterances).where(eq(utterances.sessionId, sid))).length).toBe(1)
    expect(w.calls.filter(c => c.name === 'router')).toHaveLength(1)
  })
})

/** Holds the router LLM call (the first request is mid-flight while the duplicate arrives). */
async function demoWorldRouterHold(w: Awaited<ReturnType<typeof demoWorld>>, gate: Promise<void>, entered: () => void) {
  const original = w.deps.llm.object.bind(w.deps.llm)
  let held = true
  w.deps.llm.object = (async (args: Parameters<typeof original>[0]) => {
    if (held && args.name === 'router') { entered(); await gate }
    return original(args)
  }) as typeof original
  return { restore: () => { held = false } }
}
