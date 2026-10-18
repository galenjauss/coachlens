import { describe, it, expect } from 'vitest'
import { HeadTiltDetector, TILT_COOLDOWN_MS, TILT_HOLD_MS } from './tilt'

function clock(start = 0) {
  let t = start
  return { now: () => t, set: (v: number) => { t = v } }
}
const level = { x: 0, y: 0.1, z: 1 }
const down = { x: 0, y: 0.8, z: 0.6 }

describe('HeadTiltDetector', () => {
  it('fires only after the value stays past the threshold for the hold time', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'y', threshold: 0.5 }, c.now)
    expect(d.push(level)).toBe(false)
    c.set(100); expect(d.push(down)).toBe(false)
    c.set(100 + TILT_HOLD_MS - 1); expect(d.push(down)).toBe(false)
    c.set(100 + TILT_HOLD_MS); expect(d.push(down)).toBe(true)
  })

  it('ignores values below the threshold', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'y', threshold: 0.5 }, c.now)
    for (let t = 0; t < 2000; t += 100) { c.set(t); expect(d.push({ x: 0, y: 0.49, z: 1 })).toBe(false) }
  })

  it('a single noisy spike does not fire', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'y', threshold: 0.5 }, c.now)
    c.set(0); expect(d.push(down)).toBe(false)
    c.set(200); expect(d.push(level)).toBe(false)
    c.set(600); expect(d.push(down)).toBe(false)
    c.set(800); expect(d.push(level)).toBe(false)
  })

  it('does not refire while held, and respects the cooldown after returning level', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'y', threshold: 0.5 }, c.now)
    c.set(0); d.push(down)
    c.set(500); expect(d.push(down)).toBe(true)
    c.set(1000); expect(d.push(down)).toBe(false) // still held: no refire
    c.set(1500); expect(d.push(level)).toBe(false)
    c.set(2000); d.push(down)
    c.set(2500); expect(d.push(down)).toBe(false) // inside cooldown
    c.set(3000); expect(d.push(level)).toBe(false)
    c.set(500 + TILT_COOLDOWN_MS); d.push(down)
    c.set(500 + TILT_COOLDOWN_MS + TILT_HOLD_MS); expect(d.push(down)).toBe(true)
  })

  it('supports a negative threshold (tilt in the other direction) and other axes', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'x', threshold: -0.4 }, c.now)
    c.set(0); expect(d.push({ x: -0.6 })).toBe(false)
    c.set(400); expect(d.push({ x: -0.7 })).toBe(true)
  })

  it('treats a missing axis value as 0 (protobuf omits zeros)', () => {
    const c = clock()
    const d = new HeadTiltDetector({ axis: 'y', threshold: 0.5 }, c.now)
    c.set(0); d.push(down)
    c.set(200); expect(d.push({})).toBe(false)
    c.set(600); expect(d.push(down)).toBe(false)
  })
})
