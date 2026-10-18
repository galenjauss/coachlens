import { describe, it, expect } from 'vitest'
import { MIN_DIP_MS, NodDetector, type NodConfig } from './nod'

const cfg: NodConfig = { enabled: true, axis: 'y', threshold: 0.3, windowMs: 600, cooldownMs: 1500 }

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
    // half-way back only, then the window runs out
    expect(feed(d, clock, [[0, 0.1], [100, 0.6], [200, 0.6], [300, 0.35], [400, 0.35], [800, 0.1]])).toEqual([])
  })

  it('ignores a dip held longer than 600 ms (looking down is not a nod)', () => {
    const { d, clock } = make()
    expect(feed(d, clock, [[0, 0.1], [100, 0.6], [400, 0.6], [701, 0.6], [800, 0.6], [900, 0.1]])).toEqual([])
  })

  it('ignores a slow tilt: the resting value follows it (time-based)', () => {
    const { d, clock } = make()
    const ramp: [number, number][] = Array.from({ length: 40 }, (_, i) => [i * 100, 0.1 + i * 0.02]) // +0.8 over 4 s
    expect(feed(d, clock, [...ramp, ...ramp.slice().reverse().map(([, y], i): [number, number] => [4000 + i * 100, y])])).toEqual([])
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
})
