import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { API_URL, IMU_LOG, TILT } from './config'
import { createApi } from './core/api'
import { Outbox } from './core/outbox'
import { bridgeKV, browserKV, KEYS, type KV } from './core/storage'
import { startLens } from './lens/controller'
import { mountPhone } from './phone/mount'

const BRIDGE_TIMEOUT_MS = 3000

async function boot(): Promise<void> {
  const bridgePromise = waitForEvenAppBridge()
  const bridge = await Promise.race([bridgePromise, new Promise<null>(r => setTimeout(() => r(null), BRIDGE_TIMEOUT_MS))])
  const kv: KV = bridge ? bridgeKV(bridge) : browserKV()
  const api = createApi(API_URL, () => kv.get(KEYS.token))
  mountPhone({ api, kv, hasGlasses: Boolean(bridge) })
  const lens = (b: Awaited<typeof bridgePromise>) => startLens({ bridge: b, api, kv, outbox: new Outbox(kv), tilt: TILT, logImu: IMU_LOG })
  if (bridge) {
    await lens(bridge)
    return
  }
  // Slow bridge (or a plain browser, where it never comes): the phone UI is already up; start the
  // lens whenever the bridge arrives. It shares the phone's KV so pairing/class choice stay in sync.
  bridgePromise.then(b => lens(b)).catch(e => console.error('[boot] late lens start failed', e))
}

boot().catch(e => console.error('[boot]', e))
