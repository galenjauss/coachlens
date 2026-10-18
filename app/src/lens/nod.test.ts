import { describe, it, expect } from 'vitest'
import { NOD } from '../config'
import { MIN_DIP_MS, NodDetector, type NodConfig } from './nod'

const cfg: NodConfig = { enabled: true, axis: 'y', threshold: 0.3, windowMs: 1500, cooldownMs: 1500 }

/** Feed (time, y) samples; returns the times at which the detector fired. */
function feed(d: NodDetector, clock: { t: number }, samples: [number, number][]): number[] {
  const fired: number[] = []
  for (const [t, y] of samples) { clock.t = t; if (d.push({ x: 0, y, z: 1 })) fired.push(t) }
  return fired
}
const make = (c: NodConfig = cfg) => { const clock = { t: 0 }; return { clock, d: new NodDetector(c, () => clock.t) } }
/** A deliberate ~300 ms nod at 100 ms sampling starting at `t`: three dipped samples, then back. */
const nod = (t: number, down = 0.6, rest = 0.1): [number, number][] => [[t, down], [t + 100, down], [t + 200, down], [t + 300, rest]]

describe('NodDetector', () => {
  it('a slow ~1.2 s nod fires (the dip is not absorbed into the resting value)', () => {
    const { d, clock } = make()
    const ys = [0.1, 0.1, 0.1, 0.18, 0.28, 0.4, 0.5, 0.6, 0.6, 0.6, 0.6, 0.55, 0.45, 0.35, 0.25, 0.12]
    const samples = ys.map((y, i): [number, number] => [i * 100, y]) // ~1.2 s from leaving rest to back
    expect(feed(d, clock, samples)).toEqual([1400]) // 0.25 is back within threshold/2 of rest
  })

  it('a fast ~300 ms nod fires', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.1], [200, 0.6], [300, 0.6], [400, 0.6], [500, 0.1]])).toEqual([500])
  })

  it('looking down and staying down for 3 s (then coming back up) never fires', () => {
    const { d, clock } = make()
    const down: [number, number][] = Array.from({ length: 30 }, (_, i) => [100 + i * 100, 0.6])
    expect(feed(d, clock, [[0, 0.1], ...down, [3100, 0.4], [3200, 0.2], [3300, 0.1], [3400, 0.1]])).toEqual([])
  })

  it('looking down slowly, staying, then slowly back up never fires', () => {
    const { d, clock } = make()
    const slowDown: [number, number][] = Array.from({ length: 20 }, (_, i) => [i * 100, 0.1 + i * 0.03]) // 2 s down
    const stay: [number, number][] = Array.from({ length: 20 }, (_, i) => [2000 + i * 100, 0.7]) // 2 s held
    const slowUp: [number, number][] = Array.from({ length: 20 }, (_, i) => [4000 + i * 100, 0.7 - i * 0.03]) // 2 s up
    expect(feed(d, clock, [...slowDown, ...stay, ...slowUp])).toEqual([])
  })

  it('a deliberate ~300 ms nod fires once, on the way back', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.1], ...nod(200)])).toEqual([500])
  })

  it('a one-sample spike does not fire', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.9], [200, 0.1], [300, 0.1]])).toEqual([])
  })

  it(`a dip shorter than ${MIN_DIP_MS} ms does not fire, even with two samples`, () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.6], [150, 0.6], [250, 0.1]])).toEqual([])
  })

  it('walking-like oscillation (alternating small spikes) does not fire', () => {
    const { d, clock } = make()
    const walk: [number, number][] = Array.from({ length: 60 }, (_, i) => [i * 100, 0.1 + (i % 2 ? 0.4 : -0.4)])
    expect(feed(d, clock, [[-100, 0.1], ...walk])).toEqual([])
    const bob: [number, number][] = Array.from({ length: 60 }, (_, i) => [6000 + i * 100, 0.1 + [0, 0.35, 0.05, -0.2][i % 4]!])
    expect(feed(d, clock, bob)).toEqual([])
  })

  it('needs a real return (within threshold/2 of rest) inside the window', () => {
    const { d, clock } = make()
    // half-way back only, until the 1.5 s window runs out
    expect(feed(d, clock, [[0, 0.1], [100, 0.6], [200, 0.6], [300, 0.35], [1000, 0.35], [1700, 0.35], [1800, 0.1]])).toEqual([])
  })

  it('a slow posture drift (+0.3 over 6 s) never fires: the resting value follows it', () => {
    const { d, clock } = make()
    const drift: [number, number][] = Array.from({ length: 60 }, (_, i) => [i * 100, 0.1 + i * 0.005])
    expect(feed(d, clock, [...drift, ...drift.slice().reverse().map(([, y], i): [number, number] => [6000 + i * 100, y])])).toEqual([])
  })

  it('negative threshold means the value goes down while nodding', () => {
    const { d, clock } = make({ ...cfg, threshold: -0.3 })
    expect(feed(d, clock, [[0, 0.5], ...nod(100, 0.9, 0.5)])).toEqual([])
    expect(feed(d, clock, [[2000, 0.5], ...nod(2100, 0.1, 0.5)])).toEqual([2400])
  })

  it('cooldown: a second nod right after the first is ignored, a later one fires', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], ...nod(100), ...nod(500), ...nod(2000)])).toEqual([400, 2300])
  })

  it('treats a missing axis value as 0 (protobuf omits zeros)', () => {
    const { d, clock } = make()
    const fired = [0, 100, 250, 350].map(t => { clock.t = t; return d.push(t === 0 || t === 350 ? { x: 1 } : { y: 0.5 }) })
    expect(fired).toEqual([false, false, false, true])
  })

  it("calibrated config (Galen's G2: x rests ≈ -0.11, dips to ≈ -0.55): a nod fires, jitter does not", () => {
    expect(NOD).toMatchObject({ enabled: true, axis: 'x', threshold: -0.22 })
    const clock = { t: 0 }
    const d = new NodDetector(NOD, () => clock.t)
    const at = (t: number, x: number, y = 0.01) => { clock.t = t; return d.push({ x, y, z: 0.9 }) }
    const jitter = [-0.11, -0.16, -0.07, -0.13, -0.09, -0.18, -0.1].map((x, i) => at(i * 100, x, i % 2 ? -0.07 : 0.02))
    expect(jitter.some(Boolean)).toBe(false)
    expect([at(1000, -0.11), at(1100, -0.55), at(1200, -0.52), at(1300, -0.4), at(1400, -0.12)]).toEqual([false, false, false, false, true])
  })
})
