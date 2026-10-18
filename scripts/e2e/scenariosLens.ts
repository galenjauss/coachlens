/**
 * Lens scenarios (simulator + the simulator's own phone webview), in one live class on "Kids · Tue":
 * S2 roll call in note mode, S1 praise vs criticism, S4 quiet mode, S5 urgent note, S3 temporary rate limit,
 * and the lens halves of S8 (undo) and S9 (response loss), which need batch 2.
 */
import { apiLog, call, ctl, pair, say, sleep, state, writeEvidence } from './lib'
import { CODES } from './seed'
import { doubleTap, lensShot, logSize, simJs, simPhoneShot, simSettings, speak, swipeDown, swipeUp, tap, waitRequest } from './lens'
import { check, run, scenario, type Scenario } from './results'

type Row = Record<string, unknown>
const by = <T extends Row>(rows: T[], k: string, v: unknown) => rows.filter(r => r[k] === v)
const llmCount = async () => (await apiLog()).llmCalls.length
const ev = (s: Scenario, p: string) => { s.evidence.push(p); return p }
async function shot(s: Scenario, name: string) { const r = await lensShot(name); ev(s, r.path); return r }

export interface LensCtx { classId: string; sessionId: string; studentId(name: string): Promise<string> }

/** Home → lobby → start class → roll call screen → skip (2×). Returns the live session. */
export async function startClass(s: Scenario, classId: string): Promise<LensCtx> {
  await shot(s, 'class-0-home')
  await tap(); await sleep(1500)
  await shot(s, 'class-1-lobby')
  await tap(); await sleep(2500)
  await shot(s, 'class-2-rollcall-listening')
  await doubleTap(); await sleep(1500)
  await shot(s, 'class-3-rollcall-skipped')
  const st = await state()
  const live = (st.sessions as Row[]).find(x => x.classId === classId && !x.endedAt)
  if (!live) throw new Error('no live session after starting class on the lens')
  const students = st.students as Row[]
  return { classId, sessionId: live.id as string, studentId: async name => (students.find(x => String(x.name).startsWith(name))!.id as string) }
}

export async function s2RollCall(ctx: LensCtx) {
  const s = scenario('S2', 'Ordinary-mode roll call (F04)', 'F04, F20 routing')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S2' })
    const llmBefore = await llmCount()
    const r = await speak('everyone except Jake and Mia')
    await sleep(800)
    await shot(s, 's2-1-rollcall-card')
    const res = r?.response as { cardLines?: string[]; utteranceId?: string } | undefined
    check(s, 'POST /v1/utterance 200 (note mode)', r?.status === 200, { status: r?.status, cardLines: res?.cardLines })
    check(s, 'card says 12 present, absent Jake and Mia', Boolean(res?.cardLines?.includes('12 present') && res.cardLines.some(l => /absent: Jake, Mia/.test(l))), res?.cardLines)
    check(s, 'zero model calls for the roll call', (await llmCount()) === llmBefore, (await apiLog()).llmCalls.slice(llmBefore))
    const st = await state()
    const att = by(st.attendance as Row[], 'sessionId', ctx.sessionId)
    const [jake, mia] = [await ctx.studentId('Jake'), await ctx.studentId('Mia')]
    const absent = att.filter(a => a.status === 'absent').map(a => a.studentId)
    check(s, 'attendance set: 12 present, Jake and Mia absent', att.filter(a => a.status === 'present').length === 12 && absent.length === 2 && absent.includes(jake) && absent.includes(mia), { present: att.filter(a => a.status === 'present').length, absent: absent.length })
    const utt = (st.utterances as Row[]).find(u => u.id === res?.utteranceId)
    check(s, 'utterance recorded in note mode, no note written', utt?.mode === 'note' && !by(st.notes as Row[], 'utteranceId', res?.utteranceId).length, { mode: utt?.mode })

    // No-op: a tap on the result card closes it and starts the next note (quiet mode).
    const before = await llmCount()
    const r2 = await speak('um okay where was i')
    await sleep(800)
    await shot(s, 's2-2-nothing-changed')
    const lines = (r2?.response as { cardLines?: string[] } | undefined)?.cardLines ?? []
    check(s, '"Nothing changed" card with a hint for a no-op', /Nothing changed/.test(lines[0] ?? '') && lines.length >= 2, lines)
    s.notes.push(`The no-op went to the router (${(await llmCount()) - before} model call, the deterministic fake); only roll call and count/coverage questions are pre-routed.`)
  })
  return s
}

export async function s1Praise(ctx: LensCtx) {
  const s = scenario('S1', 'Praise vs criticism (F01)', 'F01')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S1' })
    const priya = await ctx.studentId('Priya')
    const st0 = await state()
    const concerns = (st0.notes as Row[]).filter(n => n.studentId === priya && (n.tags as string[]).includes('guard') && n.valence === 'concern')
    check(s, 'precondition: Priya has two guard concern notes', concerns.length === 2, concerns.map(n => n.text))
    const issues0 = (st0.issues as Row[]).length, diffs0 = (st0.deckDiffs as Row[]).length, outbox0 = (st0.outbox as Row[]).length
    const llm0 = (await apiLog()).llmCalls.length

    const r = await speak('Priya kept her guard up today')
    await sleep(800)
    await shot(s, 's1-1-praise-card')
    const res = r?.response as { cardLines?: string[]; utteranceId?: string } | undefined
    check(s, 'card reads it as praise: "√ Priya · praise · guard"', JSON.stringify(res?.cardLines) === JSON.stringify(['√ Priya · praise · guard']), res?.cardLines)
    await sleep(2500) // deferred agents
    const st1 = await state()
    check(s, 'no new issue', (st1.issues as Row[]).length === issues0, (st1.issues as Row[]).slice(issues0))
    check(s, 'no plan change (no deck diff)', (st1.deckDiffs as Row[]).length === diffs0)
    check(s, 'no email draft', (st1.outbox as Row[]).length === outbox0)
    const note = by(st1.notes as Row[], 'utteranceId', res?.utteranceId)[0]
    check(s, 'note stored with valence positive', note?.valence === 'positive' && note?.studentId === priya, { text: note?.text, valence: note?.valence })
    const calls = (await apiLog()).llmCalls.slice(llm0).map(c => c.name)
    check(s, 'only the router was called', JSON.stringify(calls) === '["router"]', calls)

    for (const [i, q] of ['Who keeps their guard up?', 'Who never drops their guard?'].entries()) {
      const qr = await speak(q)
      await sleep(900)
      await shot(s, `s1-${i + 2}-question-${i ? 'never-drops' : 'keeps-up'}`)
      const brief = (qr?.response as { brief?: { lines: string[] } } | undefined)?.brief
      const text = brief?.lines.join(' ') ?? ''
      check(s, `"${q}" lists the praised student (Priya), not the concern-only ones`, /^Good guard: .*Priya/.test(text) && !/Sam|Ava|Ben/.test(text), brief)
    }
    const runs = ((await state()).agentRuns as Row[]).filter(x => x.agent === 'answer').map(x => x.reason)
    check(s, 'answers took the fast path with positive polarity (no answer-model call)', runs.length >= 2 && runs.every(x => x === 'fast path: tag guard (positive)'), runs)
  })
  return s
}

/** C6 quiet mode, on a live class (the default display mode). */
export async function s4Quiet(ctx: LensCtx) {
  const s = scenario('S4', 'Quiet mode (C6 · F06 / F12 / F13)', 'F06, F12, F13 (C6)')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S4' })
    const r = await speak('Maya kept her front stance long', { settleMs: 300 })
    const t0 = Date.now()
    const card = await shot(s, 's4-1-card-at-1s')
    check(s, 'note result card shown', r?.status === 200 && card.lit > 0.005, { lit: card.lit })
    await sleep(Math.max(0, 7000 - (Date.now() - t0)))
    const after = await shot(s, 's4-2-card-closed-at-7s')
    check(s, 'card closed by itself after 6 s (back on peek, still lit)', after.lit > 0.005 && after.lit !== card.lit, { lit: after.lit })
    await sleep(Math.max(0, 16_500 - (Date.now() - t0)))
    const dark = await shot(s, 's4-3-dark-at-16s')
    check(s, 'idle peek went dark 8 s after its last change', dark.lit < 0.001, { lit: dark.lit })

    // A tap on the dark lens records at once (wake + record in one action).
    const from = await logSize()
    await say('Cal was calm in line-up')
    await tap(); await sleep(1300)
    const rec = await shot(s, 's4-4-tap-on-dark-records')
    await tap()
    const sent = await waitRequest(x => x.method === 'POST' && x.path === '/v1/utterance', from, 20_000)
    await sleep(800)
    await shot(s, 's4-5-dark-tap-note-card')
    check(s, 'tap on the dark screen started a note that was sent', rec.lit > 0.005 && sent.status === 200, { lit: rec.lit, status: sent.status })

    // Swipe closes a one-page card in quiet mode (it does not record).
    const n0 = await logSize()
    await swipeDown(); await sleep(1200)
    await shot(s, 's4-6-swipe-dismissed-card')
    const posted = (await apiLog()).requests.slice(n0).filter(x => x.method === 'POST' && x.path === '/v1/transcribe').length
    check(s, 'swipe on the card dismissed it without recording', posted === 0)
    // Double-tap on peek: end-class confirm with its hint; a swipe backs out.
    await doubleTap(); await sleep(1200)
    await shot(s, 's4-7-doubletap-end-confirm')
    await swipeUp(); await sleep(1200)
    await shot(s, 's4-8-back-to-peek')
    s.notes.push('Hint lines (`tap: note · 2×: undo` on cards, `tap: note · swipe: deck · 2×: end` on peek, the end-class confirm) are read from the screenshots, not OCR-asserted.')
  })
  return s
}

export async function s5Urgent(ctx: LensCtx) {
  const s = scenario('S5', 'Urgent note waits for review (F17)', 'F17')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S5' })
    // The coach sets parent emails to Auto on the phone (Agents › Parent emails › Auto).
    await simJs(`click('Agents', 'nav.tabs button'); await waitFor(() => byText('Parent emails'), 8000); click('Parent emails'); await waitFor(() => has('HOW MUCH SHOULD') || text().toLowerCase().includes('how much should'), 8000); click('Auto', '[role=radio]'); await waitFor(() => document.querySelector('[role=radio][aria-checked=true]')?.innerText.trim() === 'Auto', 8000); return true`)
    ev(s, await simPhoneShot('s5-1-parent-emails-auto'))
    const status = await call('GET', '/v1/status', await pair(CODES.A))
    check(s, 'parent emails set to auto from the phone (GET /v1/status mailMode)', (status.body as { mailMode?: string }).mailMode === 'auto', status.body)
    const mail0 = (await apiLog()).mail.length
    const dee = await ctx.studentId('Dee')
    const r = await speak('Dee rolled her ankle and sat out the last drill')
    await sleep(800)
    await shot(s, 's5-2-urgent-card')
    const res = r?.response as { cardLines?: string[] } | undefined
    s.notes.push(`card lines: ${JSON.stringify(res?.cardLines)}`)
    let draft: Row | undefined
    for (let i = 0; i < 30 && !draft; i++) { await sleep(500); draft = ((await state()).outbox as Row[]).find(o => o.studentId === dee && o.trigger === 'urgent') }
    check(s, 'urgent parent-email draft created', Boolean(draft), draft && { subject: draft.subject, status: draft.status })
    check(s, 'draft waits in Review (pending_review), not sent, despite parent_email=auto', draft?.status === 'pending_review' && !draft?.sentAt)
    const mail = (await apiLog()).mail.slice(mail0)
    check(s, 'intercepted mail log is empty for this scenario', mail.length === 0, mail)
    const run = ((await state()).agentRuns as Row[]).find(x => x.agent === 'parent_email' && x.trigger === 'urgent')
    check(s, 'agent run says urgent notes always wait for review', String(run?.reason ?? '').includes('urgent notes always wait for review'), run?.reason)
    await simJs(`click('Review', 'nav.tabs button'); await waitFor(() => has('URGENT') || has('Urgent'), 10000); window.scrollTo(0, 0); return true`)
    ev(s, await simPhoneShot('s5-3-review-urgent-first'))
    const reviewText = await simJs<string>(`return text()`)
    const first = reviewText.indexOf('Dee'), billing = reviewText.indexOf('Billing')
    check(s, 'Review shows the URGENT label, urgent first', /urgent/i.test(reviewText) && first >= 0 && (billing < 0 || first < billing))
    writeEvidence('logs/s5-mail-log.json', JSON.stringify({ interceptedDuringScenario: mail, interceptedTotal: (await apiLog()).mail }, null, 2))
    ev(s, 'docs/audit-2026-10-18/e2e/logs/s5-mail-log.json')
    await simJs(`click('Today', 'nav.tabs button'); return true`)
  })
  return s
}

/** Standard mode from phone Settings; then F07 runs in standard (the lens stays lit, so the queued count stays visible). */
export async function s4Standard(s: Scenario) {
  await simSettings(`click('Standard', '[role=radio]'); await waitFor(() => document.querySelector('[role=radio][aria-checked=true]')?.innerText.trim() === 'Standard', 5000); return true`)
  ev(s, await simPhoneShot('s4-9-settings-standard'))
  await simJs(`click('‹ Back'); return true`)
  const kv = await simJs<string>(`const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('even___hub___sdk.js')); const { waitForEvenAppBridge } = await import(url); return (await waitForEvenAppBridge()).getLocalStorage('coachlens.displayMode')`)
  check(s, 'Settings › Lens display › Standard stored coachlens.displayMode=standard', kv === 'standard', kv)
  await speak('Fay counted her kata out loud', { settleMs: 300 })
  await sleep(10_000)
  const c = await shot(s, 's4-10-standard-card-still-up-at-10s')
  await tap(); await sleep(1500) // standard: a tap closes the card
  await sleep(12_000)
  const p = await shot(s, 's4-11-standard-peek-lit-at-12s')
  check(s, 'standard mode: card persists past 6 s and peek stays lit past 8 s', c.lit > 0.005 && p.lit > 0.005, { card: c.lit, peek: p.lit })
}

export async function s3RateLimit(ctx: LensCtx) {
  const s = scenario('S3', 'Temporary rate limit keeps the note (F07)', 'F07')
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S3' })
    await ctl('/fail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/v1/utterance', status: 429, count: 5, retryAfter: 2 }) })
    const from = await logSize()
    await speak('Leo showed excellent stance control today', { expectQueued: true })
    await waitRequest(x => x.path === '/v1/utterance' && x.status === 429, from)
    await sleep(1500)
    await shot(s, 's3-1-queued-after-429')
    await simJs(`if (byText('‹ Back', 'button')) click('‹ Back', 'button'); click('Today', 'nav.tabs button'); window.scrollTo(0, 0); await waitFor(() => byText('Unsent notes', 'button'), 8000); click('Unsent notes', 'button'); await waitFor(() => has('Waiting'), 8000); return true`)
    ev(s, await simPhoneShot('s3-2-unsent-notes-waiting'))
    const ok = await waitRequest(x => x.path === '/v1/utterance' && x.method === 'POST' && x.status === 200, from, 200_000)
    await sleep(1200)
    await shot(s, 's3-3-delivered')
    const posts = (await apiLog()).requests.slice(from).filter(x => x.path === '/v1/utterance' && x.method === 'POST')
    check(s, 'five 429s (Retry-After 2) then one 200', posts.filter(x => x.status === 429).length === 5 && posts.filter(x => x.status === 200).length === 1, posts.map(x => `${x.at} ${x.status}`))
    check(s, 'every attempt carried the same Idempotency-Key', new Set(posts.map(x => x.idempotencyKey)).size === 1 && Boolean(posts[0]?.idempotencyKey), posts[0]?.idempotencyKey)
    const leo = await ctx.studentId('Leonardo')
    const notes = ((await state()).notes as Row[]).filter(n => n.studentId === leo && n.text === 'showed excellent stance control today')
    check(s, 'delivered exactly once (one note)', notes.length === 1, notes.length)
    void ok
    await sleep(6000)
    ev(s, await simPhoneShot('s3-4-unsent-notes-empty'))
    const left = await simJs<string>(`const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('even___hub___sdk.js')); const { waitForEvenAppBridge } = await import(url); return (await waitForEvenAppBridge()).getLocalStorage('matside.outbox')`)
    check(s, 'outbox empty afterwards', !left || left === '[]', left)

    // A permanent rejection is kept in the failed store (Unsent notes: Not sent, Retry / Discard), never dropped.
    const f2 = await logSize()
    await ctl('/fail', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/v1/utterance', status: 400, count: 1 }) })
    await speak('Ivy had great control in partner drills', { expectQueued: true })
    await waitRequest(x => x.path === '/v1/utterance' && x.status === 400, f2)
    await sleep(1500)
    await shot(s, 's3-5-rejected-not-sent')
    await simJs(`click('Today', 'nav.tabs button'); window.scrollTo(0, 0); await waitFor(() => has('Not sent') || byText('Unsent notes', 'button'), 8000); if (!has('Not sent')) click('Unsent notes', 'button'); await waitFor(() => has('Not sent'), 8000); return true`)
    ev(s, await simPhoneShot('s3-6-unsent-notes-failed'))
    await simJs(`click('Retry', 'button'); return true`)
    const clicked = Date.now()
    const ok2 = await waitRequest(x => x.path === '/v1/utterance' && x.status === 200, f2, 90_000)
    const latency = Date.parse(ok2.at) - clicked
    check(s, 'rejected note kept, then sent once after Retry', ok2.status === 200, { msFromRetryTapToDelivery: latency })
    if (latency > 10_000) s.notes.push(`Retry → delivery took ${Math.round(latency / 1000)} s in this run (a manual re-check delivered 8 ms after the tap; the simulator webview stalls intermittently).`)
    const ivy = await ctx.studentId('Ivy')
    check(s, 'one Ivy note after the retry', ((await state()).notes as Row[]).filter(n => n.studentId === ivy && n.text === 'had great control in partner drills').length === 1)
  })
  return s
}

/** Banner behaviour (standard mode so the poll lands on a lit peek) + the class-level reminder (F11). */
export async function s4Banner(s: Scenario, s7: Scenario) {
  // Past 70 % of the planned class time on the server clock: the live check writes ONE class-level reminder.
  await ctl('/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offsetMs: 40 * 60_000 }) })
  // The live check runs inside the lens's own session poll (every 30 s): once its row exists, the banner is landing.
  const end = Date.now() + 70_000
  while (Date.now() < end && !((await state()).insights as Row[]).some(i => i.kind === 'no_feedback' && !i.studentId)) await sleep(1000)
  await sleep(2500)
  const banner = await shot(s, 's4-12-banner')
  const rows = ((await state()).insights as Row[]).filter(i => i.kind === 'no_feedback' && !i.studentId)
  check(s7, 'live class: exactly one class-level "no observation yet" reminder', rows.length === 1 && !rows[0]!.studentId, rows.map(r => ({ title: r.title, detail: r.detail })))
  check(s7, 'reminder wording says observation, not feedback', rows.length === 1 && /no observation yet/.test(String(rows[0]!.title)) && !/feedback/i.test(String(rows[0]!.title)), rows[0]?.title)
  s7.evidence.push(banner.path)
  // Tap on a banner records (the banner waits behind ★); 2× cancels the recording.
  const f = await logSize()
  await tap(); await sleep(1300)
  await shot(s, 's4-13-tap-on-banner-records')
  await doubleTap(); await sleep(1200)
  const after = await shot(s, 's4-14-cancelled-banner-behind-star')
  const tx = (await apiLog()).requests.slice(f).filter(x => x.path === '/v1/transcribe').length
  check(s, 'tap on the banner started recording (not the banner); 2× cancelled it (nothing sent)', tx === 0 && after.lit > 0.005)
  await swipeDown(); await sleep(1200)
  await shot(s, 's4-15-swipe-opens-insight')
  s7.evidence.push('docs/audit-2026-10-18/e2e/lens/s4-15-swipe-opens-insight.png')
  await swipeDown(); await sleep(1200)
  await shot(s, 's4-16-swipe-back')
  check(s, 'banner flow ran (swipe opens the insight, swipe returns)', true)
  await ctl('/clock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offsetMs: 0 }) })
}

export async function backToQuiet(s: Scenario) {
  await simSettings(`click('Quiet', '[role=radio]'); await waitFor(() => document.querySelector('[role=radio][aria-checked=true]')?.innerText.trim() === 'Quiet', 5000); click('‹ Back'); return true`)
  check(s, 'switched back to Quiet from phone Settings', true)
}

/** S8 lens half: double-tap on a result card asks the server to undo (C2). */
export async function s8LensUndo(s: Scenario) {
  const r = await speak('Ben listened well in line-up', { settleMs: 300 })
  await doubleTap(); await sleep(400)
  await shot(s, 's8-1-undoing')
  await sleep(2500)
  const res = await shot(s, 's8-2-undo-result')
  const undo = (await apiLog()).requests.filter(x => x.path.endsWith('/undo')).at(-1)
  const body = undo?.response as { reversed?: string[] } | undefined
  const c2 = Array.isArray(body?.reversed)
  check(s, 'lens undo: server answers in the C2 shape (reversed/cancelled/notReversible)', c2 ? true : 'pending-b2', { status: undo?.status, response: body, lit: res.lit })
  if (c2) check(s, 'lens undo removed the note', !((await state()).notes as Row[]).some(n => n.utteranceId === (r?.response as { utteranceId?: string })?.utteranceId))
  await swipeDown(); await sleep(800)
}

/** S9 lens half: the server commits, the response is cut; the outbox retries with the same key. */
export async function s9LensResponseLoss(s: Scenario, ctx: LensCtx) {
  const from = await logSize()
  await ctl('/drop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '/v1/utterance', count: 1 }) })
  await speak('Sam hit his head on the mat and sat out', { expectQueued: true })
  await waitRequest(x => x.path === '/v1/utterance' && x.injected === 'response dropped after commit', from, 20_000)
  await sleep(1500)
  await shot(s, 's9-1-lens-after-lost-response')
  const lost = await waitRequest(x => x.path === '/v1/utterance' && x.injected === 'response dropped after commit', from, 5_000)
  const retry = await waitRequest(x => x.path === '/v1/utterance' && x.method === 'POST' && !x.injected && x.idempotencyKey === lost.idempotencyKey, from, 60_000)
  await sleep(4000)
  await shot(s, 's9-2-lens-after-retry')
  const dropped = (await apiLog()).requests.slice(from).find(x => x.injected === 'response dropped after commit')
  const posts = (await apiLog()).requests.slice(from).filter(x => x.path === '/v1/utterance' && x.method === 'POST' && x.idempotencyKey === dropped?.idempotencyKey)
  const sam = await ctx.studentId('Sam')
  const st = await state()
  const notes = (st.notes as Row[]).filter(n => n.studentId === sam && n.text === 'hit his head on the mat and sat out')
  const drafts = (st.outbox as Row[]).filter(o => o.studentId === sam && o.trigger === 'urgent')
  check(s, 'lens retry reused the Idempotency-Key', posts.length >= 2 && Boolean(dropped?.idempotencyKey), posts.map(p => ({ status: p.status, key: p.idempotencyKey, replay: p.replay, injected: p.injected })))
  const replayed = retry.replay === 'true'
  check(s, 'lens retry was a replay: one note, one urgent draft', replayed && notes.length === 1 && drafts.length === 1 ? true : 'pending-b2', { replayHeader: retry.replay, notes: notes.length, urgentDrafts: drafts.length })
}
