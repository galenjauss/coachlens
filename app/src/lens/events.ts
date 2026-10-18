import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import type { LensEvent } from './state'
import type { ImuSample } from './nod'

// CLICK is 0 and protobuf omits zero values, so a tap arrives as an envelope with eventType undefined.
// Default INSIDE the envelope check only: an event with no sysEvent must never read as a click.
const typeOf = (env?: { eventType?: OsEventTypeList }): OsEventTypeList | null => (env ? env.eventType ?? OsEventTypeList.CLICK_EVENT : null)

const IGNORED_SYS = new Set<OsEventTypeList>([
  OsEventTypeList.IMU_DATA_REPORT, OsEventTypeList.FOREGROUND_EXIT_EVENT, OsEventTypeList.ABNORMAL_EXIT_EVENT, OsEventTypeList.SYSTEM_EXIT_EVENT,
])

/** Maps one SDK event to a lens gesture. IMU samples go to the nod detector via `imuSample`, never here. */
export function toLensEvent(e: EvenHubEvent, now: number = Date.now()): LensEvent | null {
  const s = e.sysEvent?.imuData ? null : typeOf(e.sysEvent)
  const t = typeOf(e.textEvent)
  const l = typeOf(e.listEvent)
  if (e.sysEvent && (s === null || IGNORED_SYS.has(s)) && !e.textEvent && !e.listEvent) return null
  if (s === OsEventTypeList.LONG_PRESS_EVENT) return { type: 'longPress' }
  if (s === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) return { type: 'longPressRelease' }
  if (s === OsEventTypeList.FOREGROUND_ENTER_EVENT) return { type: 'resumed' }
  if (s === OsEventTypeList.DOUBLE_CLICK_EVENT || t === OsEventTypeList.DOUBLE_CLICK_EVENT || l === OsEventTypeList.DOUBLE_CLICK_EVENT) return { type: 'doubleTap' }
  if (l === OsEventTypeList.CLICK_EVENT) return { type: 'listSelect', index: e.listEvent?.currentSelectItemIndex ?? 0, now }
  if (t === OsEventTypeList.SCROLL_TOP_EVENT || s === OsEventTypeList.SCROLL_TOP_EVENT) return { type: 'swipeUp' }
  if (t === OsEventTypeList.SCROLL_BOTTOM_EVENT || s === OsEventTypeList.SCROLL_BOTTOM_EVENT) return { type: 'swipeDown' }
  if (s === OsEventTypeList.CLICK_EVENT || t === OsEventTypeList.CLICK_EVENT) return { type: 'tap', now }
  return null
}

/** The IMU axes from an IMU_DATA_REPORT, or null for any other event. */
export function imuSample(e: EvenHubEvent): ImuSample | null {
  const sys = e.sysEvent
  if (!sys || sys.eventType !== OsEventTypeList.IMU_DATA_REPORT || !sys.imuData) return null
  return { x: sys.imuData.x, y: sys.imuData.y, z: sys.imuData.z }
}
