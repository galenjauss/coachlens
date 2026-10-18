import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * DEV ONLY (`apply: 'serve'`, never in a build): remote control for the screenshot fixtures, so one
 * simulator stays open while scripts/sim-shots.sh steps through them.
 *   POST /__fixture?want=<name>   the page (opened with ?fixture=remote) switches to that fixture
 *   POST /__fixture/shown?name=x  the page reports the fixture is painted on the glasses
 *   GET  /__fixture               { want, shown }
 */
function fixtureControl(): Plugin {
  let want: string | null = null
  let shown: string | null = null
  const NAME = /^[A-Za-z]{1,32}$/
  return {
    name: 'coachlens-fixture-control',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fixture', (req, res) => {
        const url = new URL(req.url ?? '/', 'http://local')
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'POST') {
          const name = url.pathname === '/shown' ? url.searchParams.get('name') : url.searchParams.get('want')
          if (!name || !NAME.test(name)) { res.statusCode = 400; res.end('{"error":"bad name"}'); return }
          if (url.pathname === '/shown') shown = name
          else { want = name; shown = null }
        }
        res.end(JSON.stringify({ want, shown }))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), fixtureControl()],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
