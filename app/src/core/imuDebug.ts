import { bus } from './bus'
import type { KV } from './storage'

/**
 * Phone motion (IMU) readout for nod calibration. Persisted in KV (bridge storage in the Even app),
 * switched by the Settings toggle on Today, the readout's Hide button, or `?imu=1` / `?imu=0`.
 */
export const IMU_DEBUG_KEY = 'coachlens.imuDebug'

const urlSwitch = (search: string): boolean | null => {
  const q = new URLSearchParams(search).get('imu')
  return q === '1' ? true : q === '0' ? false : null
}

/** Current flag: the URL switch wins (and is saved), else the saved value. Never throws. */
export async function readImuDebug(kv: KV, search: string = typeof location === 'undefined' ? '' : location.search): Promise<boolean> {
  const fromUrl = urlSwitch(search)
  if (fromUrl !== null) {
    await kv.set(IMU_DEBUG_KEY, fromUrl ? '1' : '').catch(e => console.warn('[imu] could not save the readout flag', e))
    return fromUrl
  }
  try { return (await kv.get(IMU_DEBUG_KEY)) === '1' } catch (e) { console.warn('[imu] could not read the readout flag', e); return false }
}

/** Save the flag and tell the lens (IMU on/off) and the readout (show/hide). */
export async function writeImuDebug(kv: KV, on: boolean): Promise<void> {
  try { await kv.set(IMU_DEBUG_KEY, on ? '1' : '') } catch (e) { console.warn('[imu] could not save the readout flag', e) }
  bus.emit('imuDebug', on)
}
