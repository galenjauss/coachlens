/** Phone IMU calibration readout: on with `?imu=1` (remembered on this device), off with `?imu=0` or its Hide button. */
const FLAG_KEY = 'coachlens.imuDebug'

function storage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}

/** Reads the URL switch (and remembers it), else the remembered flag. Never throws. */
export function isImuDebugOn(search: string = typeof location === 'undefined' ? '' : location.search): boolean {
  const q = new URLSearchParams(search).get('imu')
  if (q === '1' || q === '0') { setImuDebug(q === '1'); return q === '1' }
  try { return storage()?.getItem(FLAG_KEY) === '1' } catch { return false }
}

export function setImuDebug(on: boolean): void {
  try {
    const s = storage()
    if (on) s?.setItem(FLAG_KEY, '1')
    else s?.removeItem(FLAG_KEY)
  } catch (e) {
    console.warn('[imu] could not save the debug flag', e)
  }
}
