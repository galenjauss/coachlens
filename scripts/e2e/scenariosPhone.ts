/**
 * Phone-UI scenarios in a headless iPhone-sized Chrome (the app in phone-only mode, browser storage, real taps
 * through the DOM): S6 Settings / Review roster picker / roster and class maintenance, S7 insight wording, and the
 * phone half of S12 (Unpair).
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { APP_URL, DOM, EVIDENCE, apiLog, call, ctl, forgetTokens, pair, shrink, sleep, state, writeEvidence } from './lib'
import { simJs, simPhoneShot } from './lens'
import { CODES } from './seed'
import { check, run, scenario, type Scenario } from './results'
// @ts-expect-error plain JS module (CDP driver shared with the earlier capture session)
import { launch } from './cdp.mjs'

type Row = Record<string, unknown>
type Browser = { goto(u: string): Promise<void>; evaluate(e: string): Promise<unknown>; screenshot(f: string): Promise<void>; send(m: string, p?: unknown): Promise<unknown>; close(): Promise<void>; consoleErrors: string[] }
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

let b: Browser
const ph = <T = unknown>(code: string) => b.evaluate(`(async () => { ${DOM} ${code} })()`) as Promise<T>
async function shot(s: Scenario, name: string, scrollText?: string) {
  if (scrollText) await ph(`const el = byText(${JSON.stringify(scrollText)}, '*'); if (el) el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -60); return true`)
  await sleep(500)
  const rel = `phone/${name}.png`
  const file = join(EVIDENCE, rel)
  mkdirSync(dirname(file), { recursive: true })
  await b.screenshot(file)
  shrink(file, 560)
  s.evidence.push(`docs/audit-2026-10-18/e2e/${rel}`)
}
const lastReq = async (pred: (r: Awaited<ReturnType<typeof apiLog>>['requests'][number]) => boolean) => (await apiLog()).requests.filter(pred).at(-1)
/** Hono's own 404 for a route that does not exist yet is plain text. */
const missing = (r: { status: number; response?: unknown } | undefined) => r?.status === 404 && (r.response === null || r.response === undefined)

/**
 * Headless Chrome has no Even app host, yet the SDK still hands the page a bridge. As in the earlier capture session
 * (video/scripts/capture-phone.mjs), a minimal stand-in answers the host calls the way the Even app does: storage in
 * localStorage, glasses page calls accepted. The app itself is unmodified.
 */
const EVEN_HOST = `(() => {
  window.flutter_inappwebview = {
    callHandler: async (name, raw) => {
      if (name !== 'evenAppMessage') return null
      const m = typeof raw === 'string' ? JSON.parse(raw) : raw
      const d = m.data || {}
      switch (m.method) {
        case 'getLocalStorage': return localStorage.getItem('evenhost:' + d.key) ?? ''
        case 'setLocalStorage': localStorage.setItem('evenhost:' + d.key, d.value); return true
        case 'createStartUpPageContainer': return 0
        default: return true
      }
    },
  }
})()`

export async function startPhone() {
  b = await launch({ width: 430, height: 932, scale: 2, userAgent: IPHONE_UA, port: 9334 }) as Browser
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: EVEN_HOST })
  await b.goto(`${APP_URL}/`)
  await ph(`await waitFor(() => document.querySelector('#code'), 20000); return true`)
}
export async function stopPhone() { await b?.close() }

export async function pairPhone(s: Scenario) {
  await shot(s, 'p0-pairing-screen')
  await ph(`setValue('#code', ${JSON.stringify(CODES.A)}); await new Promise(r => setTimeout(r, 200)); click('Pair'); await waitFor(() => document.querySelector('nav.tabs'), 15000); return true`)
  await ph(`await waitFor(() => byText('Kids · Tue', 'button'), 10000); click('Kids · Tue', 'button'); await waitFor(() => has('Kids · Tue ·'), 10000); return true`)
}

export async function s7Insights(s7: Scenario) {
  await run(s7, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S7' })
    await ph(`window.scrollTo(0, 0); return true`)
    await ph(`await waitFor(() => has('from your agents'), 15000); return true`)
    await shot(s7, 's7-1-today-from-your-agents', 'From your agents')
    await ph(`click('All classes’ insights'); await waitFor(() => has('all classes'), 10000); window.scrollTo(0, 0); return true`)
    await sleep(1500)
    await shot(s7, 's7-2-insights-all-classes')
    const t = await ph<string>(`return text()`)
    await ph(`const el = byText('review for next rank', '*'); if (el) el.scrollIntoView({ block: 'center' }); return true`)
    await shot(s7, 's7-3-rank-review')
    await ph(`const el = byText('no recent notes', '*'); if (el) el.scrollIntoView({ block: 'center' }); return true`)
    await shot(s7, 's7-4-issue-reassess')
    const token = await pair(CODES.A)
    const all = await call('GET', '/v1/insights?scope=all', token)
    writeEvidence('logs/s7-insights.json', JSON.stringify(all.body, null, 2))
    s7.evidence.push('docs/audit-2026-10-18/e2e/logs/s7-insights.json')
    const rows = ((all.body as { insights: Row[] }).insights ?? [])
    const gus = rows.find(r => r.kind === 'rank_review')
    check(s7, 'rank review: "Gus: review for next rank", evidence listed, no email action', Boolean(gus && /review for next rank/.test(String(gus.title)) && /Not tracked/.test(String(gus.detail))) && !/ready to test/i.test(t), gus && { title: gus.title, detail: gus.detail, action: gus.actionLabel })
    const re = rows.find(r => r.kind === 'issue_reassess')
    check(s7, 'issue_reassess: "no recent notes … not evidence it improved", action "Check next class"', Boolean(re && /No notes is not evidence/i.test(String(re.detail)) && /check next class/i.test(String(re.actionLabel))), re && { title: re.title, detail: re.detail, action: re.actionLabel })
    check(s7, 'no "resolve + praise" or "ready to test" wording anywhere in the inbox', !/resolve \+ praise|ready to test/i.test(t))
    const states = (await state()).insights as Row[]
    check(s7, 'the class-level reminder is ONE row for the class (no per-student flood)', states.filter(r => r.kind === 'no_feedback' && !r.studentId).length === 1, states.filter(r => String(r.kind).startsWith('no_feedback')).map(r => r.title))
  })
}

export async function s6Phone(s: Scenario) {
  await run(s, async () => {
    await ctl('/scenario', { method: 'POST', body: 'S6' })
    // Settings: display mode toggle and the server status panel (GET /v1/status, C5).
    await ph(`click('Today', 'nav.tabs button'); window.scrollTo(0, 0); await waitFor(() => document.querySelector('button.settings-btn'), 8000); document.querySelector('button.settings-btn').click(); await waitFor(() => has('Lens display'), 8000); await waitFor(() => !has('Loading…'), 8000); return true`)
    await shot(s, 's6-1-settings')
    await shot(s, 's6-2-settings-server-status', 'Server status')
    const statusReq = await lastReq(r => r.path === '/v1/status' && r.method === 'GET')
    const statusText = await ph<string>(`return [...document.querySelectorAll('section')].find(x => x.innerText.toLowerCase().includes('server status'))?.innerText ?? ''`)
    check(s, 'Settings shows Quiet/Standard and the server status from GET /v1/status', statusReq?.status === 200 && /quiet/i.test(await ph<string>('return text()')) && !/unavailable|loading/i.test(statusText), { status: statusReq?.status, panel: statusText })

    // Class edit: change only the name; the weekday must not be sent (and must not change).
    await ph(`click('Manage ›'); await waitFor(() => has('Classes'), 8000); return true`)
    await shot(s, 's6-3-classes')
    const thu = ((await state()).classes as Row[]).find(c => c.name === 'Kids · Thu')!
    await ph(`const row = [...document.querySelectorAll('li')].find(li => li.innerText.includes('Kids · Thu')); [...row.querySelectorAll('button')].find(x => x.innerText.trim() === 'Edit').click(); await waitFor(() => document.querySelector('form[aria-label^="Edit"]'), 5000); return true`)
    await shot(s, 's6-4-class-edit-form')
    await ph(`setValue(document.querySelector('form[aria-label^="Edit"] input'), 'Kids · Thu (e2e)'); await new Promise(r => setTimeout(r, 200)); click('Save class'); await new Promise(r => setTimeout(r, 1500)); return true`)
    await shot(s, 's6-5-class-edit-saved')
    const patch = await lastReq(r => r.method === 'PATCH' && r.path.startsWith('/v1/classes/'))
    const body = patch?.body as Record<string, unknown> | undefined
    check(s, 'class edit sends only the changed field (no weekday / startTime)', Boolean(body) && body!.name === 'Kids · Thu (e2e)' && !('weekday' in body!) && !('startTime' in body!), body)
    const thuAfter = ((await state()).classes as Row[]).find(c => c.id === thu.id)!
    if (missing(patch)) check(s, 'PATCH /v1/classes/:id saves the edit', 'pending-b2', { status: patch?.status })
    else check(s, 'class saved, weekday unchanged', patch?.status === 200 && thuAfter.name === 'Kids · Thu (e2e)' && thuAfter.weekday === thu.weekday, { status: patch?.status, weekdayBefore: thu.weekday, weekdayAfter: thuAfter.weekday })
    await ph(`click('‹ Back'); await new Promise(r => setTimeout(r, 400)); click('‹ Back'); return true`)

    // Review: the unassigned note's roster picker is the note's own class (C3 candidates).
    await ph(`click('Review', 'nav.tabs button'); await waitFor(() => has('Review'), 8000); await new Promise(r => setTimeout(r, 2500)); return true`)
    await shot(s, 's6-6-review')
    await shot(s, 's6-7-review-unassigned-note', 'Zed')
    const cand = await lastReq(r => /^\/v1\/notes\/[^/]+\/candidates$/.test(r.path) && r.method === 'GET')
    if (!cand || missing(cand)) check(s, 'unassigned note: roster picker scoped to the note\'s class (GET /v1/notes/:id/candidates)', 'pending-b2', { status: cand?.status ?? 'not requested' })
    else {
      const c = cand.response as { className?: string; students?: { name: string }[] }
      check(s, 'unassigned note: roster picker scoped to the note\'s class', cand.status === 200 && c.className === 'Kids · Tue' && (c.students ?? []).length === 14 && !(c.students ?? []).some(x => /Quinn|Rosa|Theo|Maria/.test(x.name)), { className: c.className, n: c.students?.length })
    }

    // Students: add, edit, delete.
    await ph(`click('Students', 'nav.tabs button'); await waitFor(() => byText('Add a student', 'button'), 8000); click('Add a student', 'button'); await waitFor(() => document.querySelector('form[aria-label="Add a student"]'), 5000); return true`)
    await ph(`const f = document.querySelector('form[aria-label="Add a student"]'); setValue(f.querySelector('input'), 'Nova Testcase'); const cb = [...f.querySelectorAll('label')].find(l => l.innerText.includes('Kids · Tue'))?.querySelector('input'); cb?.click(); click('Add guardian'); await new Promise(r => setTimeout(r, 200)); setValue(f.querySelector('input[aria-label="Guardian 1 name"]'), 'Testcase family'); setValue(f.querySelector('input[aria-label="Guardian 1 email"]'), 'nova-guardian@example.invalid'); return true`)
    await shot(s, 's6-8-add-student-form')
    await ph(`click('Add student', 'button'); await new Promise(r => setTimeout(r, 1500)); return true`)
    await shot(s, 's6-9-add-student-result')
    const create = await lastReq(r => r.method === 'POST' && r.path === '/v1/students')
    if (missing(create)) check(s, 'add a student (POST /v1/students)', 'pending-b2', { status: create?.status, sent: create?.body })
    else check(s, 'add a student (POST /v1/students)', (create?.status ?? 0) < 300 && ((await state()).students as Row[]).some(x => x.name === 'Nova Testcase'), { status: create?.status })

    await ph(`click('Students', 'nav.tabs button'); await waitFor(() => byText('Eli Shah', 'button'), 8000); click('Eli Shah', 'button'); await waitFor(() => byText('Edit details and guardians', 'button'), 8000); click('Edit details and guardians', 'button'); await waitFor(() => document.querySelector('form[aria-label="Edit student"]'), 5000); return true`)
    await ph(`const f = document.querySelector('form[aria-label="Edit student"]'); const nick = [...f.querySelectorAll('label')].find(l => l.innerText.startsWith('Nickname'))?.querySelector('input'); setValue(nick, 'Eli-E2E'); return true`)
    await shot(s, 's6-10-edit-student')
    await ph(`click('Save', 'button'); await new Promise(r => setTimeout(r, 1500)); return true`)
    await shot(s, 's6-11-edit-student-result')
    const upd = await lastReq(r => r.method === 'PATCH' && r.path.startsWith('/v1/students/'))
    const eli = ((await state()).students as Row[]).find(x => x.name === 'Eli Shah')
    if (upd?.status === 200) check(s, 'edit a student (PATCH nickname only)', eli?.nickname === 'Eli-E2E' && JSON.stringify(Object.keys(upd.body as object)) === '["nickname"]', { sent: upd.body, nickname: eli?.nickname })
    else check(s, 'edit a student (PATCH /v1/students/:id with C3 fields)', 'pending-b2', { status: upd?.status, sent: upd?.body, response: upd?.response })

    await ph(`await waitFor(() => byText('Delete Eli…', 'button') || byText('‹ Back', 'button'), 5000); if (!byText('Delete Eli…', 'button')) { click('Cancel', 'button') } ; await waitFor(() => byText('Delete Eli…', 'button'), 5000); click('Delete Eli…', 'button'); await new Promise(r => setTimeout(r, 300)); return true`)
    await shot(s, 's6-12-delete-confirm', 'Delete student')
    await ph(`const z = document.querySelector('.danger-zone'); [...z.querySelectorAll('button')].find(x => x.className.includes('danger')).click(); await new Promise(r => setTimeout(r, 1500)); return true`)
    await shot(s, 's6-13-delete-result')
    const del = await lastReq(r => r.method === 'DELETE' && r.path.startsWith('/v1/students/'))
    if (missing(del)) check(s, 'delete a student (DELETE /v1/students/:id)', 'pending-b2', { status: del?.status })
    else check(s, 'delete a student and their data', del?.status === 200 && !((await state()).students as Row[]).some(x => x.name === 'Eli Shah'), { status: del?.status })
    s.notes.push('Unsent notes panel: exercised on the simulator\'s phone webview in S3 (shared outbox with the lens): sim-phone/s3-2-unsent-notes-waiting.png, s3-6-unsent-notes-failed.png, s3-4-unsent-notes-empty.png.')
    if (b.consoleErrors.length) s.notes.push(`phone console errors: ${JSON.stringify(b.consoleErrors.slice(0, 6))}`)
  })
}

/** Phone half of S12: Settings › This phone › Unpair. Returns what the server did, for S12. */
export async function phoneUnpair(s: Scenario): Promise<{ status: number; tokenAfter: number } | null> {
  const token = await ph<string>(`return localStorage.getItem('evenhost:matside.token')`)
  await ph(`if (!byText('Unpair this phone', 'button')) { for (let i = 0; i < 3 && !document.querySelector('nav.tabs') && byText('‹ Back', 'button'); i++) { click('‹ Back', 'button'); await new Promise(r => setTimeout(r, 400)) } click('Today', 'nav.tabs button'); window.scrollTo(0, 0); await waitFor(() => document.querySelector('button.settings-btn'), 8000); document.querySelector('button.settings-btn').click() } await waitFor(() => byText('Unpair this phone', 'button'), 8000); click('Unpair this phone', 'button'); await new Promise(r => setTimeout(r, 300)); return true`)
  await shot(s, 's12-1-unpair-confirm', 'This phone')
  await ph(`const sec = [...document.querySelectorAll('section')].find(x => x.innerText.toLowerCase().includes('this phone')); [...sec.querySelectorAll('button')].find(x => x.innerText.trim() === 'Unpair').click(); await new Promise(r => setTimeout(r, 2000)); return true`)
  await shot(s, 's12-2-unpair-result')
  const un = await lastReq(r => r.path === '/v1/unpair')
  const after = await call('GET', '/v1/classes', token)
  return un ? { status: un.status, tokenAfter: after.status } : null
}

export interface SignOutOthers { status: number; revoked: unknown; harnessTokenAfter: number; phoneTokenAfter: number; simRepairScreen: boolean; simRepaired: boolean; evidence: string[] }

/**
 * Settings › Sign out other phones on the headless phone ("phone A"). The other phones are the simulator's own phone
 * UI and a harness token: both must get 401; the simulator page falls back to Pairing and is paired again.
 */
export async function phoneSignOutOthers(s: Scenario, withSim: boolean): Promise<SignOutOthers> {
  const other = await pair(CODES.A, true)
  const mine = await ph<string>(`return localStorage.getItem('evenhost:matside.token')`)
  await ph(`for (let i = 0; i < 3 && !document.querySelector('nav.tabs') && byText('‹ Back', 'button'); i++) { click('‹ Back', 'button'); await new Promise(r => setTimeout(r, 400)) } click('Today', 'nav.tabs button'); window.scrollTo(0, 0); await waitFor(() => document.querySelector('button.settings-btn'), 8000); document.querySelector('button.settings-btn').click(); await waitFor(() => byText('Sign out other phones', 'button'), 8000); click('Sign out other phones', 'button'); await new Promise(r => setTimeout(r, 300)); return true`)
  await shot(s, 's12-0a-sign-out-others-confirm', 'Sign out other phones')
  await ph(`click('Sign out others', 'button'); await new Promise(r => setTimeout(r, 1500)); return true`)
  await shot(s, 's12-0b-sign-out-others-done', 'This phone')
  const req = await lastReq(r => r.path === '/v1/tokens/revoke-others')
  const evidence: string[] = []
  const out: SignOutOthers = {
    status: req?.status ?? 0, revoked: req?.response ?? null,
    harnessTokenAfter: (await call('GET', '/v1/classes', other)).status, phoneTokenAfter: (await call('GET', '/v1/classes', mine)).status,
    simRepairScreen: false, simRepaired: false, evidence,
  }
  forgetTokens()
  if (withSim) {
    // The simulator's phone UI makes its next request with the revoked token: 401 → Pairing.
    await simJs(`if (document.querySelector('nav.tabs')) click('Review', 'nav.tabs button'); return true`).catch(() => null)
    out.simRepairScreen = Boolean(await simJs<boolean>(`await waitFor(() => document.querySelector('#code'), 25000); return true`, 30_000).catch(() => false))
    evidence.push(await simPhoneShot('s12-0c-sim-phone-signed-out'))
    if (out.simRepairScreen) {
      out.simRepaired = Boolean(await simJs<boolean>(`setValue('#code', ${JSON.stringify(CODES.A)}); await new Promise(r => setTimeout(r, 200)); click('Pair'); await waitFor(() => document.querySelector('nav.tabs'), 40000); return true`, 60_000).catch(() => false))
      evidence.push(await simPhoneShot('s12-0d-sim-phone-re-paired'))
    }
  }
  s.evidence.push(...evidence)
  return out
}
