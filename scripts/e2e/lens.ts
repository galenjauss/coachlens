/**
 * Lens-side driving for the scenarios: real taps/swipes through the simulator's automation API, real glasses
 * framebuffer screenshots, and the phone UI inside the simulator's own webview (same page, same outbox) through
 * the harness remote agent. Nothing here reaches into app state: what the coach would see is what we assert on.
 */
import { join } from 'node:path'
import { DOM, ROOT, Simulator, apiLog, litFraction, onBlack, remote, say, shrink, sleep, writeEvidence } from './lib'

export const sim = new Simulator() // attaches to the simulator the stack launched (never launches one itself)

export const tap = () => sim.input('click')
export const doubleTap = () => sim.input('double_click')
export const swipeDown = () => sim.input('down')
export const swipeUp = () => sim.input('up')

/** Glasses framebuffer → evidence/lens/<name>.png (composited on black). Returns the path and how much is lit. */
export async function lensShot(name: string): Promise<{ path: string; lit: number }> {
  const png = onBlack(await sim.glasses())
  return { path: writeEvidence(`lens/${name}.png`, png), lit: litFraction(png) }
}
/** The simulator's webview (the phone UI that shares the lens's outbox) → evidence/sim-phone/<name>.png. */
export async function simPhoneShot(name: string): Promise<string> {
  const rel = writeEvidence(`sim-phone/${name}.png`, await sim.webview())
  shrink(join(ROOT, rel), 600)
  return rel
}
export const simJs = <T = unknown>(code: string, timeoutMs?: number) => remote<T>('sim', DOM + code, timeoutMs)

/** Waits until the API request log has an entry matching `pred` after index `from`. */
export async function waitRequest(pred: (r: Awaited<ReturnType<typeof apiLog>>['requests'][number]) => boolean, from: number, timeoutMs = 20_000) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    const log = await apiLog()
    const hit = log.requests.slice(from).find(r => r.status > 0 && pred(r)) // status 0 = still in flight
    if (hit) return hit
    await sleep(300)
  }
  throw new Error('timed out waiting for an API request')
}
export const logSize = async () => (await apiLog()).requests.length

/**
 * One spoken note, as on the glasses: queue the canned transcript, tap to start, tap to stop. Resolves when the
 * note's POST /v1/utterance has answered (or `expectQueued`: when the transcribe call has gone out).
 */
export async function speak(text: string, o: { expectQueued?: boolean; settleMs?: number } = {}) {
  const from = await logSize()
  await say(text)
  await tap()
  await sleep(1300) // past the 600 ms stop debounce; the simulator streams (silent) mic PCM meanwhile
  await tap()
  if (o.expectQueued) await waitRequest(r => r.method === 'POST' && r.path === '/v1/transcribe', from)
  else await waitRequest(r => r.method === 'POST' && r.path === '/v1/utterance', from, 45_000)
  await sleep(o.settleMs ?? 900)
  const log = await apiLog()
  return log.requests.slice(from).filter(r => r.method === 'POST' && r.path === '/v1/utterance').at(-1) ?? null
}

/** Simulator page: clear the app's bridge storage (token, outbox, display mode, class) and reload it. */
export async function resetSimApp() {
  await simJs(`
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('even___hub___sdk.js'))
    const { waitForEvenAppBridge } = await import(url)
    const b = await waitForEvenAppBridge()
    for (const k of ['matside.token', 'matside.outbox', 'matside.outbox.failed', 'coachlens.displayMode', 'matside.session', 'coachlens.classId']) await b.setLocalStorage(k, '')
    await b.setLocalStorage('matside.firstRun', '1')
    setTimeout(() => location.reload(), 150)
    return true`)
  await sleep(2500)
  await simJs(`await waitFor(() => document.querySelector('#code') || document.querySelector('nav.tabs'), 15000); return true`, 20_000)
}

/** Pairs the simulator's phone UI through its Pairing screen and picks the class on the phone's class picker. */
export async function pairSimAndPick(code: string, className: string) {
  await simJs(`setValue('#code', ${JSON.stringify(code)}); await new Promise(r => setTimeout(r, 200)); click('Pair'); await waitFor(() => document.querySelector('nav.tabs'), 15000); return true`, 20_000)
  await simJs(`await waitFor(() => byText(${JSON.stringify(className)}, 'button'), 10000); click(${JSON.stringify(className)}, 'button'); await waitFor(() => has(${JSON.stringify(className)} + ' ·'), 10000); return true`, 20_000)
}

/** Opens the simulator phone UI's Settings, runs `then`, and comes back. */
export async function simSettings<T>(then: string): Promise<T> {
  return simJs<T>(`if (byText('‹ Back', 'button')) click('‹ Back', 'button'); if (document.querySelector('nav.tabs')) click('Today', 'nav.tabs button'); await waitFor(() => document.querySelector('button.settings-btn'), 8000); document.querySelector('button.settings-btn').click(); await waitFor(() => has('Lens display'), 8000); ${then}`)
}
