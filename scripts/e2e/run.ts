#!/usr/bin/env -S npx tsx
/**
 * The e2e scenario runner. Needs the stack (scripts/e2e/stack.ts) up: it restarts the API for a fresh synthetic
 * database, re-pairs the simulator's app, then drives the lens (simulator) and the phone UI (headless Chrome) through
 * every scenario and writes docs/audit-2026-10-18/e2e/{results.json, RESULTS.md, lens/, phone/, sim-phone/, logs/}.
 *
 *   node_modules/.bin/tsx scripts/e2e/run.ts                 # everything
 *   node_modules/.bin/tsx scripts/e2e/run.ts --no-lens       # API + phone scenarios only (no simulator)
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { APP_URL, EVIDENCE, apiLog, call, ctl, pair, sleep, state, writeEvidence } from './lib'
import { lensShot, pairSimAndPick, resetSimApp, sim, speak, doubleTap } from './lens'
import { check, results, run, scenario, writeResults, statusOf } from './results'
import { CODES } from './seed'
import { backToQuiet, s1Praise, s2RollCall, s3RateLimit, s4Banner, s4Quiet, s4Standard, s5Urgent, startClass, type LensCtx } from './scenariosLens'
import { s10Concurrent, s11Isolation, s12Unpair, s8Undo, s9ResponseLoss } from './scenariosB2'
import { pairPhone, phoneSignOutOthers, phoneUnpair, s6Phone, s7Insights, startPhone, stopPhone } from './scenariosPhone'
import { repro429 } from './repro'

const lens = !process.argv.includes('--no-lens')
const started = new Date().toISOString()

const status = await (await fetch(`${APP_URL}/__e2e-stack/status`)).json().catch(() => null) as { apiReady: boolean; sim: boolean } | null
if (!status?.apiReady) throw new Error('the stack is not up: run node_modules/.bin/tsx scripts/e2e/stack.ts first')
if (lens && !status.sim) throw new Error('the stack has no simulator (started with --no-sim); pass --no-lens')

// Fresh evidence (screenshots and logs from a previous run would mislead).
for (const d of ['lens', 'phone', 'sim-phone', 'logs']) rmSync(join(EVIDENCE, d), { recursive: true, force: true })
const restart = await (await fetch(`${APP_URL}/__e2e-stack/restart-api`, { method: 'POST' })).json() as { ok: boolean; error?: string }
if (!restart.ok) throw new Error(`api restart failed: ${restart.error}`)
const seed = await ctl('/seed') as { classIds: Record<string, string>; classB: string; studentsB: string[]; perInstructorCodes: boolean; instructorA: string; instructorB: string }
console.log('fresh API; seed:', { perInstructorCodes: seed.perInstructorCodes })

let ctx: LensCtx | null = null
const setup = scenario('S0', 'Setup: pair the simulator app, start class on the lens', 'harness')
await run(setup, async () => {
  if (!lens) { check(setup, 'lens skipped (--no-lens)', 'blocked'); return }
  await resetSimApp()
  await pairSimAndPick(CODES.A, 'Kids · Tue')
  await sleep(2000)
  ctx = await startClass(setup, seed.classIds.tue!)
  check(setup, 'class live on the lens (POST /v1/sessions)', Boolean(ctx.sessionId))
})

if (ctx) {
  const c = ctx as LensCtx
  await s2RollCall(c)
  await s1Praise(c)
  const s4 = await s4Quiet(c)
  await s5Urgent(c)
  // An unknown name: the note waits in Review for a student pick (used by S6's roster picker).
  const zed = await speak('Zed nailed his roundhouse')
  await sleep(800)
  await lensShot('s6-0-unknown-name-note')
  if ((zed?.response as { disambiguation?: unknown } | undefined)?.disambiguation) { await doubleTap(); await sleep(1000) }
  const s7 = scenario('S7', 'Insight wording (F09 · F10 · F11)', 'F09, F10, F11')
  await run(s4, async () => { await s4Standard(s4) })
  await s3RateLimit(c)
  await run(s4, async () => { await s4Banner(s4, s7) })
  await run(s4, async () => { await backToQuiet(s4) })
  s4.status = statusOf(s4)
  await s8Undo(c, true)
  await s9ResponseLoss(c, true)
  await s10Concurrent(c)
  // Phone UI (headless Chrome, phone-only mode).
  await startPhone()
  try {
    await pairPhone(s7)
    await s7Insights(s7)
    const s6 = scenario('S6', 'Phone UI: Unsent notes, Settings, Review roster, roster and class edits', 'F07 UI, C5, F16, F23')
    await s6Phone(s6)
    const others = await phoneSignOutOthers(s6, true)
    const s12phone = await phoneUnpair(s6)
    await s12Unpair(s12phone, others, s6.evidence.filter(e => /s12-/.test(e)))
  } finally { await stopPhone() }
} else {
  // No simulator: the batch-2 API scenarios run on a class started through the API.
  const t = await pair(CODES.A)
  const sess = (await call('POST', '/v1/sessions', t, { classId: seed.classIds.tue })).body as { sessionId: string }
  const students = (await state()).students as Record<string, unknown>[]
  const c: LensCtx = { classId: seed.classIds.tue!, sessionId: sess.sessionId, studentId: async n => students.find(x => String(x.name).startsWith(n))!.id as string }
  await s8Undo(c, false)
  await s9ResponseLoss(c, false)
  await s10Concurrent(c)
  const s7 = scenario('S7', 'Insight wording (F09 · F10 · F11)', 'F09, F10, F11')
  await startPhone()
  try {
    await pairPhone(s7)
    await s7Insights(s7)
    const s6 = scenario('S6', 'Phone UI: Unsent notes, Settings, Review roster, roster and class edits', 'F07 UI, C5, F16, F23')
    await s6Phone(s6)
    const others = await phoneSignOutOthers(s6, false)
    await s12Unpair(await phoneUnpair(s6), others, s6.evidence.filter(e => /s12-/.test(e)))
  } finally { await stopPhone() }
}
await s11Isolation(seed)
await repro429()

// ---- Logs ----
const log = await apiLog()
writeEvidence('logs/api-requests.json', JSON.stringify(log.requests.filter(r => r.method !== 'OPTIONS'), null, 1))
writeEvidence('logs/llm-calls.json', JSON.stringify(log.llmCalls, null, 2))
writeEvidence('logs/stt-calls.json', JSON.stringify(log.sttCalls, null, 2))
writeEvidence('logs/mail-intercepted.json', JSON.stringify({ note: 'deps.mail records; nothing is sent. RESEND_API_KEY is unset and non-loopback fetch is refused.', mail: log.mail, blockedFetches: log.blockedFetches }, null, 2))
writeEvidence('logs/deferred-errors.json', JSON.stringify(log.deferredErrors, null, 2))
if (lens) {
  const entries = await sim.console(0)
  const keep = entries.filter(e => /warn|error/i.test(e.level ?? '') && !/audioPcm/.test(e.message ?? '')).map(e => ({ ...e, message: (e.message ?? '').slice(0, 400) }))
  writeEvidence('logs/sim-console-warnings.json', JSON.stringify(keep, null, 2))
}
const final = await state()
writeEvidence('logs/final-state-summary.json', JSON.stringify(Object.fromEntries(Object.entries(final).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])), null, 2))

// ---- Results ----
const safety = { mailSent: 0, mailIntercepted: log.mail.length, blockedFetches: log.blockedFetches.length, unexpectedModelCalls: log.llmCalls.filter(c => c.unexpected).length }
writeResults({ started, finished: new Date().toISOString(), lens, safety })
const rows = results.map(s => `| ${s.id} | ${s.title} | ${s.findings} | **${s.status}** | ${s.checks.map(c => `${c.ok === true ? '✓' : c.ok === false ? '✗' : c.ok} ${c.name}`).join('<br>')} | ${s.evidence.slice(0, 6).map(e => `\`${e.replace('docs/audit-2026-10-18/e2e/', '')}\``).join(' ')}${s.evidence.length > 6 ? ` +${s.evidence.length - 6}` : ''} |`)
writeEvidence('RESULTS.md', [
  '# E2E results', '',
  `Run ${started} → ${new Date().toISOString()} · lens ${lens ? 'simulator' : 'skipped'} · generated by scripts/e2e/run.ts`, '',
  `Safety: ${safety.mailIntercepted} email(s) intercepted, 0 sent; ${safety.blockedFetches} non-loopback fetch attempt(s) refused; ${safety.unexpectedModelCalls} unscripted model call(s).`, '',
  '| ID | Scenario | Findings | Status | Checks | Evidence |', '|---|---|---|---|---|---|', ...rows, '',
  ...results.filter(s => s.error || s.notes.length).map(s => `- **${s.id}**: ${[s.error ? `error: ${s.error}` : '', ...s.notes].filter(Boolean).join(' · ')}`),
  '',
].join('\n'))
console.log('\n' + results.map(s => `${s.id.padEnd(4)} ${String(s.status).padEnd(11)} ${s.title}`).join('\n'))
console.log('safety', safety)
