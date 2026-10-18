#!/usr/bin/env node
/**
 * Real lens footage for the video: every frame of every dev flow (app/src/lens/fixturesFlows.ts), rendered by
 * the real render() and painted through the real Glasses sender inside the official Even Hub simulator, then
 * saved from its automation API (GET /api/screenshot/glasses, 576×288 RGBA PNG).
 *
 *   node video/scripts/capture-lens.mjs            # every flow
 *   node video/scripts/capture-lens.mjs peek note  # just these flows
 *
 * Writes video/public/captures/lens/<flow>/<NN>.png and video/public/captures/lens-manifest.json.
 *
 * Safety (the simulator is a desktop app): it is launched ONCE, never relaunched per frame, quit with SIGTERM
 * at the end (never SIGKILL), and the script refuses to start when anything already answers on port 9898.
 * Needs `evenhub-simulator` on PATH (tested with v0.9.5) and a desktop session.
 */
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = join(ROOT, 'app')
const OUT = join(ROOT, 'video', 'public', 'captures', 'lens')
const VITE_PORT = 5181
const AUTO_PORT = 9898
const DEV = `http://localhost:${VITE_PORT}`
const SIM = `http://localhost:${AUTO_PORT}`
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 1200)
const BOOT_SETTLE_MS = Number(process.env.BOOT_SETTLE_MS ?? 5000)
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function answers(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}

async function waitFor(url, limitMs, alive = () => true) {
  const end = Date.now() + limitMs
  while (Date.now() < end) {
    if (await answers(url)) return true
    if (!alive()) return false
    await sleep(500)
  }
  return false
}

if (await answers(`${SIM}/api/ping`)) {
  console.error(`Something already answers on :${AUTO_PORT} (another simulator?). Quit it first; this script won't touch it.`)
  process.exit(1)
}
try { execFileSync('which', ['evenhub-simulator'], { stdio: 'ignore' }) } catch {
  console.error('evenhub-simulator not found (npm i -g @evenrealities/evenhub-simulator)')
  process.exit(1)
}

// Vite from the app's own dependencies, with the app's config (it adds the dev-only /__fixture control).
const requireFromApp = createRequire(join(APP, 'package.json'))
const { createServer } = await import(pathToFileURL(requireFromApp.resolve('vite')).href)
const vite = await createServer({ root: APP, configFile: join(APP, 'vite.config.ts'), server: { port: VITE_PORT, strictPort: true, host: 'localhost' }, logLevel: 'warn' })
await vite.listen()
const { flowFrames, FLOW_NAMES } = await vite.ssrLoadModule('/src/lens/fixturesFlows.ts')
const wanted = process.argv.slice(2)
for (const w of wanted) if (!FLOW_NAMES.includes(w)) { console.error(`unknown flow "${w}" (have: ${FLOW_NAMES.join(', ')})`); await vite.close(); process.exit(1) }
const frames = flowFrames().filter(f => !wanted.length || wanted.includes(f.flow))

let sim = null
let simExited = false
async function stopSim() {
  if (!sim || simExited) return
  // The global bin is a node shim that spawns the native binary: SIGTERM the children first, then the shim.
  let kids = []
  try { kids = execFileSync('pgrep', ['-P', String(sim.pid)]).toString().trim().split('\n').filter(Boolean).map(Number) } catch { /* none */ }
  for (const pid of kids) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  try { sim.kill('SIGTERM') } catch { /* gone */ }
  for (let i = 0; i < 20; i++) {
    const alive = [sim.pid, ...kids].some(pid => { try { process.kill(pid, 0); return true } catch { return false } })
    if (!alive && !(await answers(`${SIM}/api/ping`))) return
    await sleep(500)
  }
  console.error('The simulator is still running after SIGTERM; quit it by hand.')
}
async function cleanup() { await stopSim(); await vite.close() }
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)) })

const control = (path, init) => fetch(`${DEV}/__fixture${path}`, { cache: 'no-store', ...init }).then(r => r.json())

try {
  await control(`?want=${frames[0].id}`, { method: 'POST' })
  console.log(`Launching the simulator once on ${DEV}/?fixture=remote`)
  sim = spawn('evenhub-simulator', [`${DEV}/?fixture=remote`, '--automation-port', String(AUTO_PORT)], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, RUST_LOG: 'warn' } })
  let simLog = ''
  sim.stderr.on('data', d => { simLog = (simLog + d).slice(-4000) })
  sim.on('exit', () => { simExited = true })
  if (!(await waitFor(`${SIM}/api/ping`, 60_000, () => !simExited))) throw new Error(`simulator did not come up:\n${simLog}`)
  await sleep(BOOT_SETTLE_MS)

  const manifestPath = join(OUT, '..', 'lens-manifest.json')
  const manifest = wanted.length && existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  const byFlow = new Map()
  for (const f of frames) byFlow.set(f.flow, [...(byFlow.get(f.flow) ?? []), f])
  for (const [flow, list] of byFlow) {
    const dir = join(OUT, flow)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    manifest[flow] = []
    for (const f of list) {
      if (simExited) throw new Error(`simulator exited mid-run:\n${simLog}`)
      await control(`?want=${f.id}`, { method: 'POST' })
      let shown = false
      for (let i = 0; i < 40 && !shown; i++) { shown = (await control('')).shown === f.id; if (!shown) await sleep(250) }
      if (!shown) throw new Error(`[${f.id}] the page never reported it painted`)
      await sleep(SETTLE_MS)
      const res = await fetch(`${SIM}/api/screenshot/glasses`)
      if (!res.ok) throw new Error(`[${f.id}] screenshot failed: ${res.status}`)
      const file = `${String(f.index + 1).padStart(2, '0')}.png`
      writeFileSync(join(dir, file), Buffer.from(await res.arrayBuffer()))
      manifest[flow].push({ file: `lens/${flow}/${file}`, caption: f.caption, holdMs: f.holdMs, screen: f.state.screen })
      console.log(`[${f.id}] lens/${flow}/${file}  ${f.caption}`)
    }
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`Done: ${frames.length} frame(s) in ${byFlow.size} flow(s).`)
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  await cleanup()
}
