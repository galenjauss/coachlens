#!/usr/bin/env -S npx tsx
/**
 * The e2e stack: the isolated API (scripts/e2e/api.ts, a child process, fresh in-memory DB), the app's Vite dev
 * server on :5191 (with the harness remote-control plugin), and the official Even Hub simulator, launched ONCE on
 * http://localhost:5191/?e2e=sim and kept up for every scenario. Quit with Ctrl-C or SIGTERM: the simulator gets
 * SIGTERM (never SIGKILL), then Vite and the API stop.
 *
 *   node_modules/.bin/tsx scripts/e2e/stack.ts            # API + Vite + simulator
 *   node_modules/.bin/tsx scripts/e2e/stack.ts --no-sim   # API + Vite only (phone-UI scenarios)
 *
 * Stack control (harness only, through Vite): POST /__e2e-stack/restart-api restarts the API with a fresh
 * database and a fresh seed (the simulator stays up; its page re-pairs). GET /__e2e-stack/status.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { APP_URL, ROOT, SIM, Simulator, sleep, startVite } from './lib'
import { TEST_PAIRING_PEPPER } from './seed'

const noSim = process.argv.includes('--no-sim')
let api: ChildProcess | null = null
let apiReady = false
let apiLog = ''

async function startApi(): Promise<void> {
  apiReady = false
  apiLog = ''
  api = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), [join(ROOT, 'scripts', 'e2e', 'api.ts')], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], detached: true, // own process group: SIGTERM reaches tsx's node child too
    env: { ...process.env, RESEND_API_KEY: '', ANTHROPIC_API_KEY: '', OPENAI_API_KEY: '', DATABASE_URL: '', PAIRING_PEPPER: TEST_PAIRING_PEPPER },
  })
  const onData = (d: Buffer) => {
    apiLog = (apiLog + d).slice(-20000)
    if (String(d).includes('E2E_API_READY')) apiReady = true
    process.stdout.write(`[api] ${String(d)}`)
  }
  api.stdout!.on('data', onData)
  api.stderr!.on('data', onData)
  const end = Date.now() + 90_000
  while (!apiReady && Date.now() < end) {
    if (api.exitCode !== null) throw new Error(`api exited:\n${apiLog}`)
    await sleep(200)
  }
  if (!apiReady) throw new Error(`api did not start:\n${apiLog}`)
}
async function stopApi(): Promise<void> {
  if (!api || api.exitCode !== null) return
  const p = api
  await new Promise<void>(r => { p.once('exit', () => r()); try { process.kill(-p.pid!, 'SIGTERM') } catch { p.kill('SIGTERM') } setTimeout(r, 5000) })
}

const stackPlugin = {
  name: 'coachlens-e2e-stack', apply: 'serve' as const,
  configureServer(server: { middlewares: { use(path: string, fn: (req: IncomingMessage, res: ServerResponse) => void): void } }) {
    server.middlewares.use('/__e2e-stack', (req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/restart-api') && req.method === 'POST') {
        void (async () => {
          try { await stopApi(); await startApi(); res.end(JSON.stringify({ ok: true })) } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: String(e) })) }
        })()
        return
      }
      res.end(JSON.stringify({ apiReady, sim: !noSim && !sim.exited, simLog: sim.log.slice(-2000) }))
    })
  },
}

const sim = new Simulator()
let vite: Awaited<ReturnType<typeof startVite>>['vite'] | null = null
async function shutdown(code = 0) {
  console.log('[stack] stopping: simulator (SIGTERM), vite, api')
  await sim.stop()
  await vite?.close()
  await stopApi()
  process.exit(code)
}
process.on('SIGINT', () => { void shutdown(130) })
// Last resort: never leave the API's process group behind.
process.on('exit', () => { if (api?.pid && api.exitCode === null) { try { process.kill(-api.pid, 'SIGTERM') } catch { /* gone */ } } })
process.on('SIGTERM', () => { void shutdown(0) })

try {
  await startApi()
  vite = (await startVite([stackPlugin])).vite
  console.log(`[stack] app on ${APP_URL}`)
  if (!noSim) {
    await sim.launch(`${APP_URL}/?e2e=sim`)
    console.log('[stack] simulator up (automation :9898)')
    // The SDK logs every 100 ms mic frame to the console; the simulator's console buffer holds 2000 entries, and
    // once it was full the webview stopped answering. Drain it (DELETE /api/console) every few seconds.
    setInterval(() => { void fetch(`${SIM}/api/console`, { method: 'DELETE' }).catch(() => {}) }, 3000)
  }
  console.log('E2E_STACK_READY')
} catch (e) {
  console.error('[stack]', e instanceof Error ? e.message : e)
  await shutdown(1)
}
