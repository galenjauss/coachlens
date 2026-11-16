import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { findUnlistedUrls, manifestWhitelist, rewriteDeadUrls } from './src/build/bundleUrls'

/**
 * BUILD ONLY: Even Hub review rejects bundles that contain URL literals outside the manifest's
 * network.whitelist. Rewrites known-dead dependency URLs after minification, then fails the build
 * if any unlisted URL is left, so a new dependency can't silently reintroduce a rejection.
 */
function evenHubUrlGuard(): Plugin {
  return {
    name: 'coachlens-evenhub-url-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      const manifest: unknown = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8'))
      const whitelist = manifestWhitelist(manifest)
      const problems: string[] = []
      for (const file of Object.values(bundle)) {
        if (file.type === 'chunk') {
          file.code = rewriteDeadUrls(file.code)
          problems.push(...findUnlistedUrls(file.code, whitelist).map((u) => `${file.fileName}: ${u}`))
        } else if (typeof file.source === 'string') {
          problems.push(...findUnlistedUrls(file.source, whitelist).map((u) => `${file.fileName}: ${u}`))
        }
      }
      if (problems.length > 0) {
        this.error(
          `Bundle references URLs missing from app.json network.whitelist:\n  ${problems.join('\n  ')}\n` +
            'Add the host to the whitelist if the app calls it, or a rewrite in src/build/bundleUrls.ts if it is dead.',
        )
      }
    },
  }
}


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
  plugins: [react(), fixtureControl(), evenHubUrlGuard()],
  server: { host: true, port: 5173 },
  build: { target: 'esnext' },
})
