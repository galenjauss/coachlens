import type { Db } from '../db/client'
import type { Hono } from 'hono'
import { agentRuns, billingFlags, classes, curriculum, deckDiffs, decks, drills, enrollments, guardians, insights, instructors, notes, outbox, sessions, studentMetrics, students, utterances } from '../db/schema'
import { setPairingCode } from '../services/pairing'

/** One instructor's synthetic world: a class with a deck, a live session, students and one of every entity. */
export async function makeTenant(db: Db, tag: string, opts: { weekday?: number } = {}) {
  const [ins] = await db.insert(instructors).values({ name: `Coach ${tag}`, email: `${tag.toLowerCase()}@example.test` }).returning()
  const code = `${tag.toLowerCase()}-code-1`
  await setPairingCode(db, ins!.id, code)
  const [cls] = await db.insert(classes).values({ instructorId: ins!.id, name: `${tag} Kids`, weekday: opts.weekday ?? 1, startTime: '17:00' }).returning()
  const [s1, s2] = await db.insert(students).values([
    { name: `${tag}ia One`, belt: 'yellow', birthYear: 2017, instructorId: ins!.id },
    { name: `${tag}o Two`, belt: 'white', birthYear: 2018, instructorId: ins!.id },
  ]).returning()
  await db.insert(enrollments).values([{ classId: cls!.id, studentId: s1!.id }, { classId: cls!.id, studentId: s2!.id }])
  await db.insert(guardians).values([{ studentId: s1!.id, name: `${tag} family`, email: `${tag.toLowerCase()}1@example.test` }])
  const [deck] = await db.insert(decks).values({ classId: cls!.id, forDate: '2026-10-19' }).returning()
  const [drill] = await db.insert(drills).values({ deckId: deck!.id, position: 1, name: `${tag} stance holds`, minutes: 5, kind: 'drill' }).returning()
  const [session] = await db.insert(sessions).values({ classId: cls!.id, deckId: deck!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const [utt] = await db.insert(utterances).values({ sessionId: session!.id, transcript: `${tag} note`, mode: 'note' }).returning()
  const [note] = await db.insert(notes).values({ sessionId: session!.id, utteranceId: utt!.id, studentId: s1!.id, text: `${tag} secret note`, tags: [] }).returning()
  const [loose] = await db.insert(notes).values({ sessionId: session!.id, utteranceId: utt!.id, studentId: null, heard: 'someone', text: `${tag} loose note` }).returning()
  const [bill] = await db.insert(billingFlags).values({ studentId: s1!.id, urgency: 'med', note: `${tag} owes dues` }).returning()
  const [mail] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s1!.id, toEmail: `${tag.toLowerCase()}1@example.test`, subject: `${tag} subject`, body: 'b'.repeat(50) }).returning()
  const [metric] = await db.insert(studentMetrics).values({ studentId: s1!.id, key: 'deadlift', value: '100 lb', num: 100, unit: 'lb', source: 'phone' }).returning()
  const [insight] = await db.insert(insights).values({ kind: 'no_feedback', studentId: s1!.id, classId: cls!.id, title: `${tag} insight`, detail: 'd', urgency: 'low', action: { type: 'none', label: 'OK' } as never, dedupeKey: `${tag}:k` }).returning()
  const [diff] = await db.insert(deckDiffs).values({ deckId: deck!.id, requestText: `${tag} diff`, diff: { added: [], changed: [], removed: [], rememberSuggestion: null } as never }).returning()
  const [run] = await db.insert(agentRuns).values({ agent: 'progress', trigger: 'feedback', sessionId: session!.id, summary: `${tag} run`, reason: 'r', status: 'ok', ms: 1, instructorId: ins!.id }).returning()
  return {
    instructorId: ins!.id, code, classId: cls!.id, studentIds: [s1!.id, s2!.id], deckId: deck!.id, drillId: drill!.id, sessionId: session!.id,
    utteranceId: utt!.id, noteId: note!.id, looseNoteId: loose!.id, billingId: bill!.id, outboxId: mail!.id, metricId: metric!.id,
    insightId: insight!.id, diffId: diff!.id, runId: run!.id,
  }
}

export async function seedCurriculum(db: Db) {
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] }).onConflictDoNothing()
}

export async function pairWith(app: Hono<never> | { request: Hono['request'] }, code: string) {
  const r = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code }), headers: { 'Content-Type': 'application/json' } })
  if (r.status !== 200) throw new Error(`pair failed ${r.status}`)
  const { token } = (await r.json()) as { token: string }
  return { token, h: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
}
