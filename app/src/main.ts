import { waitForEvenAppBridge } from '@evenrealities/even_hub_sdk'
import { API_URL, IMU_LOG, TILT } from './config'
import { createApi } from './core/api'
import { Outbox } from './core/outbox'
import { bridgeKV, browserKV, KEYS, type KV } from './core/storage'
import { startLens } from './lens/controller'
import { mountPhone } from './phone/mount'

const BRIDGE_TIMEOUT_MS = 3000

async function boot(): Promise<void> {
  // In a plain desktop browser the bridge never arrives: run phone-only with browser storage.
  const bridge = await Promise.race([waitForEvenAppBridge(), new Promise<null>(r => setTimeout(() => r(null), BRIDGE_TIMEOUT_MS))])
  const kv: KV = bridge ? bridgeKV(bridge) : browserKV()
  const api = createApi(API_URL, () => kv.get(KEYS.token))
  mountPhone({ api, kv, hasGlasses: Boolean(bridge) })
  if (bridge) await startLens({ bridge, api, kv, outbox: new Outbox(kv), tilt: TILT, logImu: IMU_LOG })
}

boot().catch(e => console.error('[boot]', e))
