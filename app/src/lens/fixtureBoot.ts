/**
 * DEV ONLY: boots the lens on a screenshot fixture (no-op API, memory storage). Imported dynamically from
 * main.ts behind `import.meta.env.DEV`, so it is not in a production build.
 *   ?fixture=<name>   one fixture
 *   ?fixture=remote   follow the dev server's /__fixture control (vite.config.ts): one simulator stays open
 *                     while scripts/sim-shots.sh switches fixtures; each switch is acknowledged once painted.
 */
import { NOD } from '../config'
import { Outbox } from '../core/outbox'
import { memoryKV } from '../core/storage'
import { startLens, type LensBridge, type LensHandle } from './controller'
import { FIXTURE_NAMES, fixtureState, isFixtureName, noopApi, type FixtureName } from './fixtures'

const POLL_MS = 300

async function show(bridge: LensBridge, name: FixtureName): Promise<LensHandle> {
  const kv = memoryKV()
  // startLens resolves after its first page is sent to the glasses.
  return startLens({ bridge, api: noopApi(), kv, outbox: new Outbox(kv), nod: { ...NOD, enabled: false }, initialState: fixtureState(name, Date.now()) })
}

export async function bootFixture(bridge: LensBridge, name: string): Promise<void> {
  if (name !== 'remote') {
    if (!isFixtureName(name)) throw new Error(`unknown fixture "${name}" (have: ${FIXTURE_NAMES.join(', ')}, remote)`)
    await show(bridge, name)
    return
  }
  let lens: LensHandle | null = null
  let current: string | null = null
  for (;;) {
    try {
      const { want, shown } = (await (await fetch('/__fixture', { cache: 'no-store' })).json()) as { want: string | null; shown: string | null }
      if (want && want !== current && isFixtureName(want)) {
        lens?.stop()
        lens = await show(bridge, want)
        current = want
      }
      // Acknowledge (again, when the same fixture was re-requested) once it is on the glasses.
      if (want && want === current && shown !== current) await fetch(`/__fixture/shown?name=${encodeURIComponent(want)}`, { method: 'POST' })
    } catch (e) { console.warn('[fixture] control poll failed', e) }
    await new Promise(r => setTimeout(r, POLL_MS))
  }
}
