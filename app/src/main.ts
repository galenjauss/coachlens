import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { API_URL, IMU_LOG, IMU_PACE, NOD } from './config'
import { createApi } from './core/api'
import { Outbox } from './core/outbox'
import { bridgeKV, browserKV, KEYS, type KV } from './core/storage'
import { startLens } from './lens/controller'
import { copyMissing } from './lens/kvHandoff'
import { CLASS_ID_KEY } from './phone/classPref'
import { mountPhone, unmountPhone } from './phone/mount'

const BRIDGE_TIMEOUT_MS = 3000
type Bridge = Awaited<ReturnType<typeof waitForEvenAppBridge>>

/** Phone UI + lens on bridge storage. */
async function runWithBridge(bridge: Bridge): Promise<void> {
  const kv = bridgeKV(bridge)
  const api = createApi(API_URL, () => kv.get(KEYS.token))
  // A phone UI failure must never keep the lens from painting its first page.
  try { mountPhone({ api, kv, hasGlasses: true }) } catch (e) { console.error('[phone] mount failed', e) }
  await startLens({ bridge, api, kv, outbox: new Outbox(kv), nod: NOD, imuPace: IMU_PACE, logImu: IMU_LOG })
}

async function boot(): Promise<void> {
  if (import.meta.env.DEV) {
    const fixture = new URLSearchParams(location.search).get('fixture')
    // DEV ONLY: store-screenshot fixtures (no-op API). `import.meta.env.DEV` is false in a build, so this drops out.
    if (fixture) {
      const [{ bootFixture }, bridge] = await Promise.all([import('./lens/fixtureBoot'), waitForEvenAppBridge()])
      return bootFixture(bridge, fixture)
    }
  }
  const bridgePromise = waitForEvenAppBridge()
  const bridge = await Promise.race([bridgePromise, new Promise<null>(r => setTimeout(() => r(null), BRIDGE_TIMEOUT_MS))])
  if (bridge) return runWithBridge(bridge)

  // No bridge yet: phone-only on browser storage (a plain desktop browser never gets one).
  const browser: KV = browserKV()
  mountPhone({ api: createApi(API_URL, () => browser.get(KEYS.token)), kv: browser, hasGlasses: false })

  // Slow bridge: switch everything to bridge storage when it arrives, carrying over a token or
  // class picked in the first seconds (without overwriting what the bridge already has).
  const late = await bridgePromise
  await copyMissing(browser, bridgeKV(late), [KEYS.token, CLASS_ID_KEY])
  unmountPhone()
  await runWithBridge(late)
}

boot().catch(e => console.error('[boot]', e))
