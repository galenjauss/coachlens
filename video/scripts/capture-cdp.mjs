/**
 * Minimal Chrome DevTools Protocol driver for the phone captures (no extra dependencies): launches Remotion's
 * bundled chrome-headless-shell, emulates an iPhone-sized viewport, and offers just what the capture script
 * needs (navigate, evaluate, wait, click by text, type, screenshot). Clicks are real CDP mouse events.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VIDEO = join(dirname(fileURLToPath(import.meta.url)), '..')
const sleep = ms => new Promise(r => setTimeout(r, ms))

/** chrome-headless-shell from video/node_modules/.remotion (installed by Remotion). */
export function findChrome() {
  const base = join(VIDEO, 'node_modules', '.remotion', 'chrome-headless-shell')
  for (const platform of readdirSync(base, { withFileTypes: true }).filter(d => d.isDirectory())) {
    const dir = join(base, platform.name)
    for (const sub of readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory())) {
      const bin = join(dir, sub.name, 'chrome-headless-shell')
      if (existsSync(bin)) return bin
    }
  }
  throw new Error(`chrome-headless-shell not found under ${base}`)
}

export async function launch({ width = 430, height = 932, scale = 3, userAgent, port = 9333 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'coachlens-capture-'))
  const chrome = spawn(findChrome(), [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars',
    '--font-render-hinting=none', '--force-color-profile=srgb', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let wsUrl = null
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      wsUrl = list.find(t => t.type === 'page')?.webSocketDebuggerUrl ?? null
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(250)
  }
  if (!wsUrl) { chrome.kill('SIGTERM'); throw new Error('chrome did not start') }

  const ws = new WebSocket(wsUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
  let seq = 0
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)); else resolve(msg.result)
    } else if (msg.method) for (const l of listeners) l(msg)
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })) })
  const once = method => new Promise(res => { const l = m => { if (m.method === method) { listeners.delete(l); res(m.params) } }; listeners.add(l) })

  const consoleErrors = []
  listeners.add(m => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  })
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: true, screenWidth: width, screenHeight: height })
  if (userAgent) await send('Emulation.setUserAgentOverride', { userAgent, platform: 'iPhone' })
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })

  async function evaluate(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  async function waitFor(expression, { timeout = 10_000, what = expression } = {}) {
    const end = Date.now() + timeout
    while (Date.now() < end) {
      if (await evaluate(`Boolean(${expression})`).catch(() => false)) return
      await sleep(150)
    }
    throw new Error(`timed out waiting for ${what}`)
  }
  async function goto(url) {
    const loaded = once('Page.loadEventFired')
    await send('Page.navigate', { url })
    await loaded
  }
  /** Box of the first visible element matching `selector` whose text includes `text` (deepest match wins). */
  async function box(text, selector = 'button, a, [role="button"], [role="tab"], summary, label, li, h1, h2, h3') {
    return evaluate(`(() => {
      const want = ${JSON.stringify(text)}.toLowerCase()
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => {
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.innerText || e.getAttribute('aria-label') || '').toLowerCase().includes(want)
      })
      const el = els.find(e => !els.some(o => o !== e && e.contains(o))) ?? els[0]
      if (!el) return null
      el.scrollIntoView({ block: 'center', inline: 'nearest' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }
    })()`)
  }
  async function clickAt(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  }
  async function click(text, selector) {
    let b = null
    const end = Date.now() + 10_000
    while (!b && Date.now() < end) { b = await box(text, selector); if (!b) await sleep(150) }
    if (!b) throw new Error(`nothing to click: "${text}"`)
    await sleep(120)
    await clickAt(b.x, b.y)
  }
  async function type(selector, text) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)})?.focus()`)
    await send('Input.insertText', { text })
  }
  /** Viewport screenshot (scaled by the device scale), or a clip in CSS px. */
  async function screenshot(file, clip) {
    const params = { format: 'png', captureBeyondViewport: false }
    if (clip) params.clip = { ...clip, scale: 1 }
    const { data } = await send('Page.captureScreenshot', params)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(data, 'base64'))
  }
  const text = () => evaluate('document.body.innerText')
  async function close() {
    try { ws.close() } catch { /* closed */ }
    chrome.kill('SIGTERM')
    await new Promise(r => { if (chrome.exitCode !== null) r(); else { chrome.once('exit', r); setTimeout(r, 3000) } })
    rmSync(profile, { recursive: true, force: true })
  }
  return { send, evaluate, waitFor, goto, box, click, clickAt, type, screenshot, text, close, consoleErrors, sleep }
}
