/**
 * Batch-2 scenarios (C1 idempotency, C2 undo, C4 isolation and unpair), driven against the HTTP API with real
 * tokens. Until batch 2 is merged the routes or behaviours are absent; each check then records `pending-b2` with
 * what the current server actually did (a missing route is Hono's plain-text 404, not a JSON error).
 */
import { apiLog, call, ctl, pair, sleep, state, writeEvidence, type ApiResult } from './lib'
import { CODES } from './seed'
import { check, run, scenario, type Scenario } from './results'
import { s8LensUndo, s9LensResponseLoss, type LensCtx } from './scenariosLens'

type Row = Record<string, unknown>
/** Hono answers an unknown route with a plain-text 404; our routes answer JSON. */
const routeMissing = (r: ApiResult) => r.status === 404 && typeof r.body === 'string'
const json = (o: unknown) => ({ 'content-type': 'application/json' as const, body: JSON.stringify(o) })

function form(sessionId: string, text: string, opId?: string) {
  const f = new FormData()
  f.set('sessionId', sessionId); f.set('mode', 'note'); f.set('text', text)
  if (opId) f.set('opId', opId)
  return f
}
const utter = (token: string, sessionId: string, text: string, key?: string) =>
  call('POST', '/v1/utterance', token, form(sessionId, text, key), key ? { 'Idempotency-Key': key } : {})

export async function s8Undo(ctx: LensCtx, lens: boolean) {
  const s = scenario('S8', 'Undo reversal and the deferred-work race (C2 · F02)', 'F02 (C2)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S8' })
    if (lens) await s8LensUndo(s)
    const token = await pair(CODES.A)
    // Roll call undo (the audit's undo-attendance repro): attendance must come back.
    const st0 = await state()
    const present0 = (st0.attendance as Row[]).filter(a => a.sessionId === ctx.sessionId && a.status === 'present').length
    const rc = await utter(token, ctx.sessionId, 'everyone is here')
    const present1 = ((await state()).attendance as Row[]).filter(a => a.sessionId === ctx.sessionId && a.status === 'present').length
    const u = await call('POST', `/v1/utterances/${(rc.body as { utteranceId: string }).utteranceId}/undo`, token, {})
    const present2 = ((await state()).attendance as Row[]).filter(a => a.sessionId === ctx.sessionId && a.status === 'present').length
    const c2 = Array.isArray((u.body as { reversed?: unknown })?.reversed)
    writeEvidence('logs/s8-undo-attendance.json', JSON.stringify({ present0, present1, present2, rollCall: rc.body, undo: u }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s8-undo-attendance.json')
    check(s, 'undo answers in the C2 shape', c2 ? true : 'pending-b2', { status: u.status, body: u.body })
    check(s, 'undoing a roll call restores attendance (audit repro undo-attendance)', present2 === present0 ? true : c2 ? false : 'pending-b2', { before: present0, afterRollCall: present1, afterUndo: present2 })
    const again = await call('POST', `/v1/utterances/${(rc.body as { utteranceId: string }).utteranceId}/undo`, token, {})
    check(s, 'second undo → 409 already_undone', again.status === 409 ? true : c2 ? false : 'pending-b2', { status: again.status, body: again.body })
    const unknown = await call('POST', '/v1/utterances/00000000-0000-0000-0000-000000000000/undo', token, {})
    check(s, 'unknown id → 404', unknown.status === 404 ? true : c2 ? false : 'pending-b2', { status: unknown.status, body: unknown.body })

    // Race: undo while the urgent parent-email draft (deferred work) is still being written.
    await ctl('/llm-delay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'parent_email', ms: 3000 }) })
    const mail0 = (await apiLog()).mail.length
    const llm0 = (await apiLog()).llmCalls.length
    const urgent = await utter(token, ctx.sessionId, 'Gus bumped his nose in sparring and sat out')
    const uid = (urgent.body as { utteranceId: string }).utteranceId
    const ru = await call('POST', `/v1/utterances/${uid}/undo`, token, {})
    await sleep(4500)
    await ctl('/llm-delay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'parent_email', ms: 150 }) })
    const st = await state()
    const gus = ((st.students as Row[]).find(x => String(x.name).startsWith('Gus'))!).id
    const drafts = (st.outbox as Row[]).filter(o => o.utteranceId === uid || (o.trigger === 'urgent' && o.studentId === gus && new Date(String(o.createdAt)).getTime() > Date.now() - 15_000))
    const live = drafts.filter(o => o.status === 'pending_review' || o.status === 'sent')
    writeEvidence('logs/s8-undo-race.json', JSON.stringify({ undo: ru, draftsAfter: drafts, mail: (await apiLog()).mail.slice(mail0) }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s8-undo-race.json')
    const drafting = (await apiLog()).llmCalls.slice(llm0).filter(c => c.name === 'parent_email').length
    check(s, 'race exercised: the deferred parent-email drafting had started when undo arrived', drafting > 0, { parentEmailModelCalls: drafting })
    check(s, 'race: undo during deferred drafting leaves no live draft (cancelled or never written)', live.length === 0 ? true : c2 ? false : 'pending-b2', { undoStatus: ru.status, undo: ru.body, drafts: drafts.map(d => ({ status: d.status, subject: d.subject })) })
    check(s, 'race: no mail sent', (await apiLog()).mail.length === mail0)
  })
  return s
}

export async function s9ResponseLoss(ctx: LensCtx, lens: boolean) {
  const s = scenario('S9', 'Response lost after commit: retry replays (C1 · F03)', 'F03 (C1)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S9' })
    if (lens) await s9LensResponseLoss(s, ctx)
    const token = await pair(CODES.A)
    const key = crypto.randomUUID()
    const st0 = await state()
    const notes0 = (st0.notes as Row[]).length, out0 = (st0.outbox as Row[]).length, mail0 = (await apiLog()).mail.length
    await ctl('/drop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/v1/utterance', count: 1 }) })
    let first: string
    try { const r = await utter(token, ctx.sessionId, 'Sam hit his head on the mat and sat out', key); first = `status ${r.status}, body ${JSON.stringify(r.body).slice(0, 80)}` } catch (e) { first = `network error: ${e instanceof Error ? e.message : e}` }
    await sleep(2500)
    const retry = await utter(token, ctx.sessionId, 'Sam hit his head on the mat and sat out', key)
    await sleep(2500)
    const st = await state()
    const added = (st.notes as Row[]).length - notes0, drafts = (st.outbox as Row[]).length - out0
    writeEvidence('logs/s9-response-loss.json', JSON.stringify({ key, first, retry, addedNotes: added, addedDrafts: drafts, mail: (await apiLog()).mail.slice(mail0) }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s9-response-loss.json')
    const replay = retry.headers['idempotent-replay'] === 'true'
    check(s, 'the first response never reached the client', /network error|status 200, body ""|status 200, body null/.test(first) || first.includes('network'), first)
    check(s, 'retry with the same Idempotency-Key replays (200, Idempotent-Replay: true)', replay ? true : 'pending-b2', { status: retry.status, header: retry.headers['idempotent-replay'] ?? null })
    check(s, 'no duplicate note, no duplicate email draft', added === 1 && drafts <= 1 ? true : replay ? false : 'pending-b2', { addedNotes: added, addedDrafts: drafts })
    check(s, 'no email sent', (await apiLog()).mail.length === mail0)
  })
  return s
}

export async function s10Concurrent(ctx: LensCtx) {
  const s = scenario('S10', 'Duplicate concurrent requests → 409 in_progress (C1)', 'F03 (C1)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S10' })
    const token = await pair(CODES.A)
    const key = crypto.randomUUID()
    await ctl('/llm-delay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'router', ms: 2500 }) })
    const n0 = ((await state()).notes as Row[]).length
    const [a, b] = await Promise.all([utter(token, ctx.sessionId, 'Ben listened well in line-up', key), sleep(300).then(() => utter(token, ctx.sessionId, 'Ben listened well in line-up', key))])
    await ctl('/llm-delay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'router', ms: 150 }) })
    await sleep(1000)
    const added = ((await state()).notes as Row[]).length - n0
    const statuses = [a.status, b.status].sort()
    writeEvidence('logs/s10-concurrent.json', JSON.stringify({ key, a, b, addedNotes: added }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s10-concurrent.json')
    const conflict = [a, b].find(r => r.status === 409)
    check(s, 'one 200 and one 409 { error: "in_progress" }', conflict && (conflict.body as { error?: string }).error === 'in_progress' && statuses[0] === 200 ? true : 'pending-b2', { statuses, bodies: [a.body, b.body].map(x => JSON.stringify(x).slice(0, 120)) })
    check(s, 'one note written', added === 1 ? true : conflict ? false : 'pending-b2', { addedNotes: added })
  })
  return s
}

export async function s11Isolation(seed: { classIds: Record<string, string>; classB: string; studentsB: string[] }) {
  const s = scenario('S11', 'Class and account boundaries (C4 · F19)', 'F19 (C4)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S11' })
    const a = await pair(CODES.A)
    const pb = await call('POST', '/pair', null, { code: CODES.B })
    const aClasses = (await call('GET', '/v1/classes', a)).body as { id: string; name: string }[]
    const leak = aClasses.filter(c => c.id === seed.classB).map(c => c.name)
    writeEvidence('logs/s11-isolation.json', JSON.stringify({ pairB: pb, instructorAClasses: aClasses.map(c => c.name) }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s11-isolation.json')
    check(s, "A's class list does not include B's class", leak.length === 0 ? true : 'pending-b2', { leaked: leak })
    if (pb.status !== 200) { check(s, 'instructor B can pair with their own code', 'pending-b2', { status: pb.status, body: pb.body }); return }
    const b = (pb.body as { token: string }).token
    const st = await state()
    const aStudent = (st.students as Row[]).find(x => String(x.name).startsWith('Priya'))!.id as string
    const aNote = (st.notes as Row[]).find(n => n.studentId === aStudent)!.id as string
    const probes: [string, string, string, unknown?][] = [
      ['read', 'GET', `/v1/students/${aStudent}`], ['read', 'GET', `/v1/today?classId=${seed.classIds.tue}`],
      ['read', 'GET', `/v1/notes/${aNote}/candidates`], ['read', 'GET', `/v1/students/${aStudent}/brief`],
      ['write', 'PATCH', `/v1/students/${aStudent}`, { aliases: ['hijack'] }], ['write', 'DELETE', `/v1/students/${aStudent}`],
      ['write', 'POST', '/v1/sessions', { classId: seed.classIds.tue }], ['write', 'PATCH', `/v1/classes/${seed.classIds.tue}`, { name: 'hijacked' }],
      ['write', 'POST', `/v1/notes/${aNote}/assign`, { studentId: seed.studentsB[0] }],
    ]
    const out: Record<string, number> = {}
    for (const [, m, p, body] of probes) out[`${m} ${p.replace(/[0-9a-f-]{36}/g, ':id')}`] = (await call(m, p, b, body)).status
    const lists = { classes: (await call('GET', '/v1/classes', b)).body, students: (await call('GET', '/v1/students', b)).body }
    const bSeesA = JSON.stringify(lists).includes('Priya') || JSON.stringify(lists).includes('Kids · Tue')
    writeEvidence('logs/s11-isolation.json', JSON.stringify({ pairB: pb.status, probes: out, listsForB: lists }, null, 2))
    check(s, "B's list routes return only B's data", !bSeesA, lists)
    check(s, "every read/write of A's entities with B's token is 404", Object.values(out).every(v => v === 404), out)
    const priyaAfter = ((await state()).students as Row[]).find(x => x.id === aStudent)
    check(s, "A's data unchanged", Boolean(priyaAfter) && !(priyaAfter!.aliases as string[]).includes('hijack'))
  })
  return s
}

export async function s12Unpair(phoneResult?: { status: number; tokenAfter: number } | null) {
  const s = scenario('S12', 'Unpair revokes the token → 401 (C4 · F18)', 'F18 (C4)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S12' })
    const t = await pair(CODES.A, true)
    const before = await call('GET', '/v1/classes', t)
    const un = await call('POST', '/v1/unpair', t, {})
    const after = await call('GET', '/v1/classes', t)
    writeEvidence('logs/s12-unpair.json', JSON.stringify({ before: before.status, unpair: un, after: after.status, phone: phoneResult ?? null }, null, 2))
    s.evidence.push('docs/audit-2026-10-18/e2e/logs/s12-unpair.json')
    if (routeMissing(un)) {
      check(s, 'POST /v1/unpair exists', 'pending-b2', { status: un.status, body: un.body })
      check(s, 'the token keeps working after "Unpair" (current behaviour)', 'pending-b2', { after: after.status })
      return
    }
    check(s, 'POST /v1/unpair → 200', un.status === 200, un.body)
    check(s, 'the revoked token gets 401', after.status === 401, after.status)
    if (phoneResult) check(s, 'phone Settings › Unpair: server revoked, the old token gets 401', phoneResult.status === 200 && phoneResult.tokenAfter === 401, phoneResult)
  })
  return s
}

export { routeMissing, json }
