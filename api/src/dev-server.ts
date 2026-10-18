import { serve } from '@hono/node-server'
import { createApp } from './app'
import { prodDeps } from './prod'

const deps = { ...prodDeps(), defer: (p: Promise<unknown>) => { p.catch(e => console.error('[defer]', e)) } }
serve({ fetch: createApp(deps).fetch, port: 8787, hostname: '0.0.0.0' }, i => console.log(`api on http://0.0.0.0:${i.port}`))
