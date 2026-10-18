/**
 * e2e helpers: the app's Vite dev server (with a harness-only remote-control plugin), the official Even Hub
 * simulator (launched ONCE, quit with SIGTERM), framebuffer PNG compositing, and the isolated API's control routes.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const EVIDENCE = join(ROOT, 'docs', 'audit-2026-10-18', 'e2e')
export const API = process.env.E2E_API ?? 'http://127.0.0.1:8787'
export const VITE_PORT = Number(process.env.E2E_VITE_PORT ?? 5191)
export const APP_URL = `http://localhost:${VITE_PORT}`
export const AUTO_PORT = 9898
export const SIM = `http://127.0.0.1:${AUTO_PORT}`
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- API control (harness routes + plain API calls)

export async function ctl(path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}/__e2e${path}`, init)
  if (!r.ok) throw new Error(`control ${path}: ${r.status}`)
  return r.json()
}
export const say = (text: string) => ctl('/transcript', { method: 'POST', body: text })
export const tagScenario = (name: string) => ctl('/scenario', { method: 'POST', body: name })
export const state = () => ctl('/state') as Promise<Record<string, Record<string, unknown>[]>>
export const apiLog = () => ctl('/log') as Promise<{
  requests: { at: string; scenario: string; method: string; path: string; status: number; ms: number; idempotencyKey: string | null; replay: string | null; injected?: string; auth: string | null; body?: unknown; response?: unknown }[]
  llmCalls: { at: string; name: string; utterance: string | null; ok: boolean; unexpected?: boolean; error?: string }[]
  sttCalls: { at: string; transcript: string; audioBytes: number; scenario: string }[]
  mail: { to: string; subject: string; text: string; at: string; scenario: string; id: string }[]
  blockedFetches: { at: string; url: string }[]
  deferredErrors: { at: string; error: string }[]
}>

export interface ApiResult { status: number; body: unknown; headers: Record<string, string> }
export async function call(method: string, path: string, token: string | null, json?: unknown, headers: Record<string, string> = {}): Promise<ApiResult> {
  const h: Record<string, string> = { ...headers }
  if (token) h.authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (json instanceof FormData) body = json
  else if (json !== undefined) { h['content-type'] = 'application/json'; body = JSON.stringify(json) }
  const r = await fetch(`${API}${path}`, { method, headers: h, body })
  const text = await r.text()
  let parsed: unknown = text
  try { parsed = text ? JSON.parse(text) : null } catch { /* not json */ }
  return { status: r.status, body: parsed, headers: Object.fromEntries(r.headers.entries()) }
}
const tokens = new Map<string, string>()
/** Drop cached harness tokens (after a scenario revokes them). */
export const forgetTokens = () => tokens.clear()
/** A harness token per code, cached: /pair allows 10 calls a minute per address. `fresh` for a token to revoke. */
export async function pair(code: string, fresh = false): Promise<string> {
  if (!fresh && tokens.has(code)) return tokens.get(code)!
  const r = await call('POST', '/pair', null, { code })
  if (r.status !== 200) throw new Error(`pair failed: ${r.status} ${JSON.stringify(r.body)}`)
  const t = (r.body as { token: string }).token
  if (!fresh) tokens.set(code, t)
  return t
}

// ---------------------------------------------------------------- Vite + remote control of the simulator's webview

type Cmd = { id: number; code: string }
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/**
 * Harness-only Vite plugin: the page opened with `?e2e=<channel>` loads a small agent that long-polls for JS
 * snippets and posts their results. Used to drive the phone UI inside the simulator's own webview (pairing, the
 * Settings toggle) exactly as a coach's taps would, without changing app code.
 */
function remotePlugin() {
  const queues = new Map<string, Cmd[]>()
  const waiters = new Map<string, ServerResponse>()
  const pending = new Map<number, Pending>()
  let seq = 0
  const flushTo = (ch: string) => {
    const res = waiters.get(ch); const q = queues.get(ch)
    if (!res || !q?.length) return
    waiters.delete(ch)
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(q.shift()))
  }
  const AGENT = `(() => {
    // Harness only: the SDK logs every 100 ms mic frame and every bridge call. In the simulator each console line
    // crosses IPC into a 2000-entry buffer; under that flood the webview stalled. Drop just those debug lines.
    for (const level of ['log', 'debug']) {
      const orig = console[level].bind(console)
      console[level] = (...a) => { const m = typeof a[0] === 'string' ? a[0] : ''; if (m.startsWith('[EvenAppBridge] EvenHub event') || m.startsWith('[Simulator] Flutter Bridge intercepted')) return; orig(...a) }
    }
    let ch = new URLSearchParams(location.search).get('e2e') || sessionStorage.getItem('e2e-ch')
    // The simulator's WKWebView may reload without the query string; the headless phone uses an iPhone UA.
    if (!ch) ch = /iPhone/.test(navigator.userAgent) ? 'phone' : (window.flutter_inappwebview || window.__TAURI_INTERNALS__ || window.__TAURI__ ? 'sim' : null)
    if (!ch) return
    try { sessionStorage.setItem('e2e-ch', ch) } catch {}
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor
    const loop = async () => { for (;;) { try {
      const r = await fetch('/__e2e-remote/next?ch=' + ch, { cache: 'no-store' }); if (r.status !== 200) continue
      const cmd = await r.json(); let out
      try { out = { id: cmd.id, ok: true, value: await new AsyncFn(cmd.code)() } } catch (e) { out = { id: cmd.id, ok: false, error: String(e) + ' | ' + String(e && e.stack) } }
      await fetch('/__e2e-remote/result', { method: 'POST', body: JSON.stringify(out) })
    } catch { await new Promise(r => setTimeout(r, 700)) } } }
    loop()
  })()`
  const api = {
    exec(ch: string, code: string, timeoutMs = 20_000): Promise<unknown> {
      const id = ++seq
      const q = queues.get(ch) ?? []; q.push({ id, code }); queues.set(ch, q)
      flushTo(ch)
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          pending.delete(id)
          // Never let a command that was not picked up run later (a late click would land in another scenario).
          const qq = queues.get(ch) ?? []; const i = qq.findIndex(c => c.id === id)
          if (i >= 0) { qq.splice(i, 1); reject(new Error(`remote ${ch}: not picked up (agent busy)`)) } else reject(new Error(`remote ${ch}: timed out`))
        }, timeoutMs)
        pending.set(id, { resolve: v => { clearTimeout(t); resolve(v) }, reject: e => { clearTimeout(t); reject(e) } })
      })
    },
  }
  const plugin = {
    name: 'coachlens-e2e-remote', apply: 'serve' as const,
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: '/__e2e-remote/agent.js' }, injectTo: 'head-prepend' as const }],
    configureServer(server: { middlewares: { use(path: string, fn: (req: IncomingMessage, res: ServerResponse) => void): void } }) {
      server.middlewares.use('/__e2e-remote', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local')
        res.setHeader('cache-control', 'no-store')
        if (url.pathname === '/agent.js') { res.setHeader('content-type', 'text/javascript'); res.end(AGENT); return }
        if (url.pathname === '/next') {
          const ch = url.searchParams.get('ch') ?? 'default'
          waiters.get(ch)?.end()
          waiters.set(ch, res)
          setTimeout(() => { if (waiters.get(ch) === res) { waiters.delete(ch); res.statusCode = 204; res.end() } }, 15_000)
          flushTo(ch)
          return
        }
        if (url.pathname === '/exec' && req.method === 'POST') {
          // The runner (another process) asks: run this snippet in channel `ch`, answer with its result.
          let raw = ''
          req.on('data', c => { raw += c })
          req.on('end', () => {
            const { ch, code, timeoutMs } = JSON.parse(raw) as { ch: string; code: string; timeoutMs?: number }
            res.setHeader('content-type', 'application/json')
            api.exec(ch, code, timeoutMs).then(value => res.end(JSON.stringify({ ok: true, value: value ?? null })), (e: Error) => res.end(JSON.stringify({ ok: false, error: e.message })))
          })
          return
        }
        if (url.pathname === '/result' && req.method === 'POST') {
          let raw = ''
          req.on('data', c => { raw += c })
          req.on('end', () => {
            res.end('ok')
            try {
              const out = JSON.parse(raw) as { id: number; ok: boolean; value?: unknown; error?: string }
              const p = pending.get(out.id); pending.delete(out.id)
              if (p) { if (out.ok) p.resolve(out.value); else p.reject(new Error(out.error)) }
            } catch { /* ignore */ }
          })
          return
        }
        res.statusCode = 404; res.end()
      })
    },
  }
  return { plugin, api }
}

export async function startVite(extraPlugins: unknown[] = []) {
  const APP = join(ROOT, 'app')
  process.env.VITE_API_URL = API.replace('127.0.0.1', 'localhost')
  const requireFromApp = createRequire(join(APP, 'package.json'))
  const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href)
  const remote = remotePlugin()
  const vite = await createServer({
    root: APP, configFile: join(APP, 'vite.config.ts'), plugins: [remote.plugin, ...extraPlugins],
    server: { port: VITE_PORT, strictPort: true, host: 'localhost' }, logLevel: 'warn',
  })
  await vite.listen()
  return { vite, remote: remote.api }
}

/** Run a snippet in the page opened with `?e2e=<ch>` (through the stack's Vite server). */
export async function remote<T = unknown>(ch: string, code: string, timeoutMs = 60_000): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const r = await fetch(`${APP_URL}/__e2e-remote/exec`, { method: 'POST', body: JSON.stringify({ ch, code, timeoutMs }) })
    const j = await r.json() as { ok: boolean; value?: T; error?: string }
    if (j.ok) return j.value as T
    // The simulator's webview sometimes stops polling for a while; a command it never picked up is safe to resend.
    if (attempt < 4 && /not picked up/.test(j.error ?? '')) { console.warn(`  [remote] ${ch}: agent busy, retrying (${attempt})`); continue }
    throw new Error(`remote(${ch}): ${j.error}`)
  }
}

/** DOM helpers available inside remote snippets (prepended to each). React-safe input and deepest-match clicks. */
export const DOM = `
const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
const byText = (text, sel = 'button, a, [role=button], [role=tab], [role=radio], label, summary, li') => {
  const want = text.toLowerCase()
  const labels = e => [e.innerText || '', e.getAttribute('aria-label') || ''].map(x => x.trim().toLowerCase())
  const els = [...document.querySelectorAll(sel)].filter(e => visible(e) && labels(e).some(l => l.includes(want)))
  return els.find(e => labels(e).some(l => l === want)) ?? els.find(e => !els.some(o => o !== e && e.contains(o))) ?? els[0] ?? null
}
const click = (text, sel) => { const el = byText(text, sel); if (!el) throw new Error('nothing to click: ' + text); el.scrollIntoView({ block: 'center' }); el.click(); return true }
const setValue = (sel, value) => {
  const el = typeof sel === 'string' ? document.querySelector(sel) : sel; if (!el) throw new Error('no input ' + sel)
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return true
}
const text = () => document.body.innerText
const has = t => document.body.innerText.toLowerCase().includes(String(t).toLowerCase()) // innerText follows CSS text-transform
const waitFor = async (fn, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v } catch {} await new Promise(r => setTimeout(r, 150)) } throw new Error('timed out: ' + fn) }
`

// ---------------------------------------------------------------- The simulator (once per run)

async function answers(url: string) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}

export class Simulator {
  proc: ChildProcess | null = null
  exited = false
  log = ''
  async launch(url: string) {
    if (await answers(`${SIM}/api/ping`)) throw new Error(`something already answers on :${AUTO_PORT}; quit it first (this harness never touches a simulator it did not start)`)
    this.proc = spawn('evenhub-simulator', [url, '--automation-port', String(AUTO_PORT)], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RUST_LOG: 'warn' } })
    this.proc.stderr!.on('data', d => { this.log = (this.log + d).slice(-8000) })
    this.proc.on('exit', () => { this.exited = true })
    const end = Date.now() + 60_000
    while (Date.now() < end) {
      if (await answers(`${SIM}/api/ping`)) return
      if (this.exited) break
      await sleep(500)
    }
    throw new Error(`simulator did not come up:\n${this.log}`)
  }
  assertAlive() { if (this.exited) throw new Error(`simulator exited:\n${this.log}`) }
  async input(action: 'click' | 'double_click' | 'up' | 'down' | 'long_press' | 'long_press_release') {
    this.assertAlive()
    const r = await fetch(`${SIM}/api/input`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }) })
    if (!r.ok) throw new Error(`sim input ${action}: ${r.status}`)
  }
  async glasses(): Promise<Buffer> {
    this.assertAlive()
    const r = await fetch(`${SIM}/api/screenshot/glasses`)
    if (!r.ok) throw new Error(`glasses screenshot: ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  async webview(): Promise<Buffer> {
    const r = await fetch(`${SIM}/api/screenshot/webview`)
    if (!r.ok) throw new Error(`webview screenshot: ${r.status}`)
    return Buffer.from(await r.arrayBuffer())
  }
  async console(since = 0): Promise<{ id: number; level?: string; message?: string }[]> {
    const r = await fetch(`${SIM}/api/console?since_id=${since}`)
    if (!r.ok) return []
    const j = await r.json() as unknown
    return Array.isArray(j) ? j : ((j as { entries?: [] }).entries ?? [])
  }
  /** SIGTERM the native children, then the node shim (never SIGKILL). */
  async stop() {
    if (!this.proc || this.exited) return
    let kids: number[] = []
    try { kids = execFileSync('pgrep', ['-P', String(this.proc.pid)]).toString().trim().split('\n').filter(Boolean).map(Number) } catch { /* none */ }
    for (const pid of kids) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
    try { this.proc.kill('SIGTERM') } catch { /* gone */ }
    for (let i = 0; i < 20; i++) {
      const alive = [this.proc.pid!, ...kids].some(pid => { try { process.kill(pid, 0); return true } catch { return false } })
      if (!alive && !(await answers(`${SIM}/api/ping`))) return
      await sleep(500)
    }
    console.error('The simulator is still running after SIGTERM; quit it by hand.')
  }
}

// ---------------------------------------------------------------- PNG: composite the glasses framebuffer onto black

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]) }

/** RGBA 8-bit PNG → RGB PNG on black (the simulator exports glyphs with alpha; black shows them as on the lens). */
export function onBlack(png: Buffer): Buffer {
  let pos = 8; let w = 0, h = 0, depth = 0, ctype = 0; const idat: Buffer[] = []
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const type = png.toString('ascii', pos + 4, pos + 8); const data = png.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]!; ctype = data[9]! }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const ch = ctype === 6 ? 4 : ctype === 2 ? 3 : ctype === 4 ? 2 : 1
  if (depth !== 8 || ch === 1) return png // not a format we composite: keep the original
  const raw = inflateSync(Buffer.concat(idat)); const stride = w * ch
  const px = Buffer.alloc(h * stride); let prev = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!; const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)); const out = px.subarray(y * stride, (y + 1) * stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? out[i - ch]! : 0, b = prev[i]!, c = i >= ch ? prev[i - ch]! : 0
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      out[i] = (line[i]! + pred) & 0xff
    }
    prev = out
  }
  const rgb = Buffer.alloc(h * (w * 3 + 1))
  for (let y = 0; y < h; y++) {
    rgb[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const s = y * stride + x * ch; const alpha = ch === 4 ? px[s + 3]! / 255 : ch === 2 ? px[s + 1]! / 255 : 1
      const g = ch >= 3 ? [px[s]!, px[s + 1]!, px[s + 2]!] : [px[s]!, px[s]!, px[s]!]
      for (let k = 0; k < 3; k++) rgb[y * (w * 3 + 1) + 1 + x * 3 + k] = Math.round(g[k]! * alpha)
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([png.subarray(0, 8), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rgb, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

/** Pixel fraction lit on the composited frame (dark screen ≈ 0). */
export function litFraction(png: Buffer): number {
  let pos = 8; let w = 0, h = 0; const idat: Buffer[] = []
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const type = png.toString('ascii', pos + 4, pos + 8); const data = png.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4) }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat)); let lit = 0
  // filter type 0 only (what onBlack writes)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; if (raw[o]! + raw[o + 1]! + raw[o + 2]! > 60) lit++ }
  return lit / (w * h)
}

/** Downscale a PNG in place to `width` px (macOS sips); screenshots stay readable and small. */
export function shrink(file: string, width: number) {
  try { execFileSync('sips', ['--resampleWidth', String(width), file], { stdio: 'ignore' }) } catch { /* keep the original size */ }
}

export function writeEvidence(rel: string, data: string | Buffer) {
  const file = join(EVIDENCE, rel)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, data)
  return `docs/audit-2026-10-18/e2e/${rel}`
}
