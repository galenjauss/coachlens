import { describe, it, expect } from 'vitest'
import { NodDetector, type NodConfig } from './nod'

const cfg: NodConfig = { axis: 'y', threshold: 0.3, windowMs: 600, cooldownMs: 1500 }

/** Feed (time, y) samples; returns the times at which the detector fired. */
function feed(d: NodDetector, clock: { t: number }, samples: [number, number][]): number[] {
  const fired: number[] = []
  for (const [t, y] of samples) { clock.t = t; if (d.push({ x: 0, y, z: 1 })) fired.push(t) }
  return fired
}
const make = (c: NodConfig = cfg) => { const clock = { t: 0 }; return { clock, d: new NodDetector(c, () => clock.t) } }

describe('NodDetector', () => {
  it('fires when the axis dips past the threshold and returns within 600 ms', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.1], [200, 0.5], [300, 0.6], [500, 0.12]])).toEqual([500])
  })

  it('fires with sparse samples (one dipped sample, P500-style)', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [500, 0.6], [1000, 0.1]])).toEqual([1000])
  })

  it('ignores a dip held longer than 600 ms (looking down is not a nod)', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.6], [400, 0.6], [701, 0.6], [800, 0.6], [900, 0.1]])).toEqual([])
  })

  it('ignores a slow tilt: the resting value follows it', () => {
    const { d, clock } = make()
    const ramp: [number, number][] = Array.from({ length: 40 }, (_, i) => [i * 100, 0.1 + i * 0.02]) // +0.8 over 4 s
    expect(feed(d, clock, [...ramp, ...ramp.slice().reverse().map(([, y], i): [number, number] => [4000 + i * 100, y])])).toEqual([])
  })

  it('ignores movement smaller than the threshold', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.35], [200, 0.1], [300, 0.38], [400, 0.1]])).toEqual([])
  })

  it('negative threshold means the value goes down while nodding', () => {
    const { d, clock } = make({ ...cfg, threshold: -0.3 })
    expect(feed(d, clock, [[0, 0.5], [100, 0.9], [200, 0.5]])).toEqual([])
    expect(feed(d, clock, [[2000, 0.5], [2100, 0.1], [2300, 0.5]])).toEqual([2300])
  })

  it('cooldown: a second nod right after the first is ignored, a later one fires', () => {
    const { d, clock } = make()
    const nod = (t: number): [number, number][] => [[t, 0.6], [t + 200, 0.1], [t + 300, 0.1]]
    expect(feed(d, clock, [[0, 0.1], ...nod(100), ...nod(600), ...nod(2000)])).toEqual([300, 2200])
  })

  it('treats a missing axis value as 0 (protobuf omits zeros)', () => {
    const { d, clock } = make()
    clock.t = 0; d.push({ x: 1 })
    clock.t = 100; expect(d.push({ y: 0.5 })).toBe(false)
    clock.t = 200; expect(d.push({ x: 1 })).toBe(true)
  })
})
