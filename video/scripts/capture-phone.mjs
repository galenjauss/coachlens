#!/usr/bin/env node
/**
 * Real phone-UI footage for the video: the CoachLens phone app (vite dev server on :5190, VITE_API_URL pointing
 * at the local capture api from capture-api.mjs) driven through real taps in Remotion's headless Chrome,
 * 430×932 CSS px, device scale 3, iPhone user agent. Pairs through the real Pairing screen with the local test
 * code from video/.capture.env (never printed, never on screen in a capture).
 *
 *   node video/scripts/capture-phone.mjs
 *
 * Writes video/public/captures/phone/<flow>/<NN>.png (+ <NN>-<crop>.png tight crops for zoom-ins) and
 * video/public/captures/phone-manifest.json.
 *
 * Host: the phone UI runs inside the Even app's WebView, which answers the SDK's `evenAppMessage` handler
 * (storage, glasses page calls). Headless Chrome has no host, so a minimal stand-in answers those calls the
 * way the Even app does (storage in localStorage, page calls accepted). The app itself is unmodified.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { launch } from './capture-cdp.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'video', 'public', 'captures', 'phone')
const APP_URL = 'http://localhost:5190/'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const SCALE = 3
/** Saved PNGs are downscaled to this device scale (3x screenshots are ~1 MB each). */
const SAVE_SCALE = Number(process.env.SAVE_SCALE ?? 2)
const code = readFileSync(join(ROOT, 'video', '.capture.env'), 'utf8').match(/^PAIRING_CODE=(\S+)$/m)?.[1]
if (!code) throw new Error('video/.capture.env has no PAIRING_CODE')

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

const b = await launch({ width: 430, height: 932, scale: SCALE, userAgent: IPHONE_UA })
const manifest = {}
let flow = null
let n = 0

function startFlow(name) {
  flow = name; n = 0
  rmSync(join(OUT, name), { recursive: true, force: true })
  mkdirSync(join(OUT, name), { recursive: true })
  manifest[name] = []
}

function downscale(file) {
  if (SAVE_SCALE >= SCALE) return
  const w = Number(execFileSync('sips', ['-g', 'pixelWidth', file]).toString().match(/pixelWidth: (\d+)/)[1])
  execFileSync('sips', ['--resampleWidth', String(Math.round((w * SAVE_SCALE) / SCALE)), file], { stdio: 'ignore' })
}

/** Fails the capture on visible error or loading states. */
async function assertClean(where) {
  const t = await b.text()
  for (const bad of ['Loading…', 'Couldn’t', "Couldn't", 'internal_error', 'Something went wrong']) {
    if (t.includes(bad)) throw new Error(`[${where}] the screen shows "${bad}"`)
  }
}

/** Full-screen frame, plus optional tight crops: [{ name, text, sel, pad }]. */
async function shot(caption, holdMs, crops = [], { settle = 700, allowLoading = false } = {}) {
  await b.sleep(settle)
  if (!allowLoading) await assertClean(`${flow}/${n + 1}`)
  const id = String(++n).padStart(2, '0')
  const file = join(OUT, flow, `${id}.png`)
  await b.screenshot(file)
  downscale(file)
  const entry = { file: `phone/${flow}/${id}.png`, caption, holdMs, crops: [] }
  for (const c of crops) {
    const box = await boxOf(c.text, c.sel)
    if (!box) throw new Error(`[${flow}/${id}] crop target not found: ${c.text}`)
    const pad = c.pad ?? 8
    // Clamp to what is on screen above the tab bar (a tall card is cropped to its visible part).
    const floor = await b.evaluate(`Math.min(window.innerHeight, document.querySelector('nav.tabs')?.getBoundingClientRect().top ?? window.innerHeight)`)
    const y = Math.max(0, box.top - pad)
    const clip = { x: Math.max(0, box.left - pad), y, width: Math.min(430, box.width + pad * 2), height: Math.min(box.top + box.height + pad, floor) - y }
    const cf = join(OUT, flow, `${id}-${c.name}.png`)
    await b.screenshot(cf, clip)
    downscale(cf)
    entry.crops.push({ file: `phone/${flow}/${id}-${c.name}.png`, what: c.what ?? c.name })
  }
  manifest[flow].push(entry)
  console.log(`[${flow}/${id}] ${caption}${crops.length ? ` (+${crops.length} crop)` : ''}`)
}

/** Bounding box (CSS px, viewport) of the deepest `sel` element containing `text`, without scrolling. */
const boxOf = (text, sel = '*') => b.evaluate(`(() => {
  const want = ${JSON.stringify(text)}.toLowerCase()
  const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.innerText || '').toLowerCase().includes(want) })
  const el = els.find(e => !els.some(o => o !== e && e.contains(o))) ?? els[0]
  if (!el) return null
  const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }
})()`)

/** Scroll so the element containing `text` sits `offset` px below the top of the viewport. */
async function scrollTo(text, sel = '*', offset = 80) {
  const ok = await b.evaluate(`(() => {
    const want = ${JSON.stringify(text)}.toLowerCase()
    const els = [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => (e.innerText || '').toLowerCase().includes(want) && e.getBoundingClientRect().height > 0)
    const el = els.find(e => !els.some(o => o !== e && e.contains(o))) ?? els[0]
    if (!el) return false
    window.scrollTo({ top: window.scrollY + el.getBoundingClientRect().top - ${offset}, behavior: 'instant' }); return true
  })()`)
  if (!ok) throw new Error(`nothing to scroll to: ${text}`)
  await b.sleep(250)
}
const top = () => b.evaluate('window.scrollTo({ top: 0, behavior: "instant" })')

/** Click the button labelled `label` inside the `sel` element that contains `text`. */
async function clickIn(text, label, sel = 'li') {
  const pt = await b.evaluate(`(() => {
    const row = [...document.querySelectorAll(${JSON.stringify(sel)})].find(e => (e.innerText || '').includes(${JSON.stringify(text)}))
    const btn = row && [...row.querySelectorAll('button')].find(x => x.innerText.trim() === ${JSON.stringify(label)})
    if (!btn) return null
    btn.scrollIntoView({ block: 'center', behavior: 'instant' })
    const r = btn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (!pt) throw new Error(`no "${label}" button in the row with "${text}"`)
  await b.clickAt(pt.x, pt.y)
}
const tab = async name => { await b.click(name, 'nav.tabs button'); await b.sleep(1200) }
const waitText = (t, timeout = 10_000) => b.waitFor(`document.body.innerText.includes(${JSON.stringify(t)})`, { timeout, what: t })

try {
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: EVEN_HOST })
  await b.goto(APP_URL)
  await b.waitFor(`document.querySelector('#code')`, { timeout: 20_000, what: 'pairing screen' })

  // ---- Pairing (captured BEFORE the code is typed: the code never appears in a frame) ----
  startFlow('pairing')
  await shot('Pairing: enter the code from your setup to connect phone and glasses', 1500)
  await b.type('#code', code)
  await b.click('Pair', 'button')
  await b.waitFor(`document.querySelector('nav.tabs')`, { timeout: 20_000, what: 'paired app' })
  await waitText('Do it', 20_000)

  // ---- Today ----
  startFlow('today')
  await top()
  await shot('Today opens on the next class (PT · Mon 6:00), class picker on top', 1200)
  await b.click('Kids · Tue', 'button')
  await waitText('Drill deck')
  await top()
  await shot('Tap Kids · Tue: theme, forms due, focus from notes', 1500)
  await scrollTo('From your agents', 'section, div', 16)
  await shot('"From your agents": 3 of 7 new insights, each with a next step and Do it', 2500, [{ name: 'agents-card', text: 'All insights', sel: 'section', what: 'From your agents card' }])
  await scrollTo('items ·', 'section', 60)
  await shot('The plan card: Drill deck, 9 items · 47 min, first drills', 1500, [{ name: 'plan-card', text: 'items ·', sel: 'section', what: 'plan card' }])

  // ---- Review ----
  startFlow('review')
  await tab('Review')
  await waitText('Dee sat out the last drill')
  await top()
  await shot('Review: Dee\'s urgent parent email and two billing flags wait for the coach', 2000, [{ name: 'dee-email', text: 'Dee sat out the last drill', sel: 'li, article, section', what: 'Dee email draft card' }])
  await clickIn('Dee sat out the last drill', 'Edit', 'li, article, section')
  await b.sleep(800)
  await top()
  await shot('Open the Dee draft to edit: subject and warm 3-sentence body, Send when ready', 2500)

  // ---- Agents ----
  startFlow('agents')
  await tab('Agents')
  await waitText('PARENT EMAILS')
  await top()
  await shot('Agents: one tile per agent, red needs you, amber waits for review, green is done', 2500, [{ name: 'parent-tile', text: 'PARENT EMAILS', sel: 'button, li, a', what: 'red Parent emails tile (1 urgent)' }])

  // ---- Agents → Parent emails: Auto · Review · Off ----
  startFlow('parentEmail')
  await b.click('Parent emails', 'button, a, li, [role=button]')
  await waitText('HOW MUCH SHOULD')
  await top()
  await shot('Parent emails: currently on Auto (sends on its own)', 1500, [{ name: 'autonomy', text: 'Auto', sel: '[role=radiogroup]', pad: 6, what: 'Auto · Review · Off control' }])
  await b.click('Review', '[role=radio]')
  await b.waitFor(`document.querySelector('[role=radio][aria-checked=true]')?.innerText.trim() === 'Review'`, { what: 'Review selected' })
  await shot('Tap Review: drafts wait for your OK before anything is sent', 2000, [{ name: 'autonomy', text: 'Auto', sel: '[role=radiogroup]', pad: 6, what: 'Auto · Review · Off control' }])

  // ---- Agents → Insights list ----
  startFlow('insights')
  await tab('Today')
  await waitText('All insights')
  await b.click('All insights', 'button, a')
  await waitText('WAITING ON YOU')
  await top()
  await shot('Insights: what the agents noticed, and what they can do about it', 2000)
  await scrollTo('Eli Shah', 'li', 120)
  await shot('More insights: Eli needs a note, Jake missed 3, Leo billing, Priya resolved', 2000)

  // ---- Students → Priya ----
  startFlow('priya')
  await tab('Students')
  await waitText('Priya Rao')
  await b.click('Priya Rao', 'button, a, li')
  await waitText('COACH NOTES')
  await top()
  await shot('Priya\'s profile: the lens brief lines, attendance dots, rank', 2500, [{ name: 'brief', text: 'Att ', sel: 'section', what: 'profile brief card' }])
  await scrollTo('Metrics', 'h2, h3, section, div', 16)
  await shot('Metrics and nicknames', 1200)
  await scrollTo('Coach notes', 'h2, h3, section', 16)
  await shot('Working on, and every coach note in her own words', 1800)

  // ---- Deck editor + Start from… ----
  startFlow('deck')
  await tab('Today')
  await waitText('items ·')
  await b.click('items ·', 'section')
  await waitText('Start from…')
  await top()
  await shot('Deck editor: 9 drills, reorder, cues, focus kids', 1800)
  await b.click('Start from…', 'button')
  await waitText('Repeat last class')
  await scrollTo('Repeat last class', 'button, li, div', 260)
  await shot('"Start from…": repeat last class, copy a plan, blank, or let AI draft', 2200, [{ name: 'sheet', text: 'Let AI draft', sel: 'section, aside, div[role=dialog], .sheet', what: 'Start from sheet' }])
  await b.click('‹ Today', 'button')
  await b.sleep(800)

  // ---- Onboarding step 1 ----
  startFlow('onboarding')
  await scrollTo('Set up CoachLens', 'button, [role=button], a', 300)
  await b.click('Set up CoachLens', 'button, [role=button], a')
  await waitText('What do you teach?')
  await top()
  await shot('Setup step 1 of 6: what do you teach?', 1800)
  await b.click('Martial arts', 'button, label, [role=radio]')
  await shot('Pick Martial arts: belts, forms and drill decks', 1500)
  await b.click('Exit', 'button')
  await b.sleep(1000)

  // ---- Do it on "Gus may be ready to test" ----
  startFlow('doIt')
  await waitText('Gus may be ready to test')
  await scrollTo('Gus may be ready to test', 'li', 240)
  const gus = [{ name: 'gus', text: 'Gus may be ready to test', sel: 'li', what: 'Gus insight row' }]
  await shot('Gus may be ready to test: next step, draft testing email', 1500, gus)
  await clickIn('Gus may be ready to test', 'Do it')
  await waitText('Working…', 2000)
  await scrollTo('Gus may be ready to test', 'li', 240)
  await shot('Do it: Working… (the parent-email agent drafts it)', 1200, gus, { settle: 150 })
  await waitText('✓', 15_000)
  await shot('Done: ✓ Email drafted for review', 2200, gus)
  await tab('Review')
  await waitText('Gus')
  await top()
  await shot('Review now holds the Gus testing email next to Dee\'s', 2200)

  if (b.consoleErrors.length) console.warn('console errors:', b.consoleErrors.slice(0, 8))
  writeFileSync(join(OUT, '..', 'phone-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const total = Object.values(manifest).reduce((k, l) => k + l.length, 0)
  console.log(`Done: ${total} frames in ${Object.keys(manifest).length} flows (saved at ${SAVE_SCALE}x).`)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  try { await b.screenshot(join(OUT, '_failure.png')) } catch { /* ignore */ }
  process.exitCode = 1
} finally {
  await b.close()
}
