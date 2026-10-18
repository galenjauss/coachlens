import { describe, it, expect } from 'vitest'
import { OsEventTypeList, type EvenHubEvent } from '@evenrealities/even_hub_sdk'
import { imuSample, toLensEvent } from './events'

const ev = (e: Record<string, unknown>) => e as EvenHubEvent

describe('toLensEvent', () => {
  it('CLICK arrives with eventType undefined inside an envelope → tap with now', () => {
    expect(toLensEvent(ev({ sysEvent: {} }), 42)).toEqual({ type: 'tap', now: 42 })
    expect(toLensEvent(ev({ textEvent: { containerID: 1 } }), 42)).toEqual({ type: 'tap', now: 42 })
  })
  it('an event with no envelopes is not a tap', () => {
    expect(toLensEvent(ev({}))).toBeNull()
    expect(toLensEvent(ev({ audioEvent: { audioPcm: new Uint8Array(2) } }))).toBeNull()
  })
  it('double tap from any envelope', () => {
    expect(toLensEvent(ev({ sysEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }))).toEqual({ type: 'doubleTap' })
    expect(toLensEvent(ev({ textEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }))).toEqual({ type: 'doubleTap' })
    expect(toLensEvent(ev({ listEvent: { eventType: OsEventTypeList.DOUBLE_CLICK_EVENT } }))).toEqual({ type: 'doubleTap' })
  })
  it('swipes from text or sys envelopes', () => {
    expect(toLensEvent(ev({ textEvent: { eventType: OsEventTypeList.SCROLL_TOP_EVENT } }))).toEqual({ type: 'swipeUp' })
    expect(toLensEvent(ev({ sysEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }))).toEqual({ type: 'swipeDown' })
  })
  it('list scrolls are handled natively by the list, not mapped', () => {
    expect(toLensEvent(ev({ listEvent: { eventType: OsEventTypeList.SCROLL_BOTTOM_EVENT } }))).toBeNull()
  })
  it('list click → listSelect with index (index 0 omitted by protobuf)', () => {
    expect(toLensEvent(ev({ listEvent: { currentSelectItemIndex: 2 } }), 7)).toEqual({ type: 'listSelect', index: 2, now: 7 })
    expect(toLensEvent(ev({ listEvent: {} }), 7)).toEqual({ type: 'listSelect', index: 0, now: 7 })
  })
  it('long press and release arrive on sysEvent', () => {
    expect(toLensEvent(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_EVENT } }))).toEqual({ type: 'longPress' })
    expect(toLensEvent(ev({ sysEvent: { eventType: OsEventTypeList.LONG_PRESS_RELEASE_EVENT } }))).toEqual({ type: 'longPressRelease' })
  })
  it('foreground enter → resumed; exits and IMU are not lens events', () => {
    expect(toLensEvent(ev({ sysEvent: { eventType: OsEventTypeList.FOREGROUND_ENTER_EVENT } }))).toEqual({ type: 'resumed' })
    for (const t of [OsEventTypeList.FOREGROUND_EXIT_EVENT, OsEventTypeList.ABNORMAL_EXIT_EVENT, OsEventTypeList.SYSTEM_EXIT_EVENT, OsEventTypeList.IMU_DATA_REPORT]) {
      expect(toLensEvent(ev({ sysEvent: { eventType: t, imuData: { x: 1 } } }))).toBeNull()
    }
  })
  it('a sys envelope carrying imuData is never a tap', () => {
    expect(toLensEvent(ev({ sysEvent: { imuData: { y: 0.3 } } }))).toBeNull()
  })
})

describe('imuSample', () => {
  it('extracts IMU samples only from IMU reports', () => {
    expect(imuSample(ev({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT, imuData: { x: 0.1, y: 0.7 } } }))).toEqual({ x: 0.1, y: 0.7, z: undefined })
    expect(imuSample(ev({ sysEvent: { eventType: OsEventTypeList.IMU_DATA_REPORT } }))).toBeNull()
    expect(imuSample(ev({ sysEvent: {} }))).toBeNull()
    expect(imuSample(ev({}))).toBeNull()
  })
})
