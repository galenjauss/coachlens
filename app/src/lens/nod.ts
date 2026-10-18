export type ImuAxis = 'x' | 'y' | 'z'
export type ImuSample = { x?: number; y?: number; z?: number }

/**
 * Nod = the chosen axis moves `threshold` away from its resting value and comes back within `windowMs`.
 * The sign of `threshold` is the direction of the dip (negative = the value goes down while nodding).
 */
export interface NodConfig { axis: ImuAxis; threshold: number; windowMs: number; cooldownMs: number }

/** How quickly the resting value follows slow head movement (per sample, 0..1). */
const BASELINE_ALPHA = 0.2

/**
 * Fires once per nod: on the sample where the head comes BACK, if it left the resting value by more
 * than the threshold less than `windowMs` earlier. A slow tilt is ignored twice over: the resting value
 * follows it, and a dip held past the window is dropped (the new position becomes the resting value).
 * After firing, nothing fires for `cooldownMs`. Pure: time comes from the injected clock.
 */
export class NodDetector {
  private baseline: number | null = null
  private dipSince: number | null = null
  private lastFire = Number.NEGATIVE_INFINITY

  constructor(private cfg: NodConfig, private now: () => number = Date.now) {}

  push(sample: ImuSample): boolean {
    const v = sample[this.cfg.axis] ?? 0 // protobuf omits zero values
    const t = this.now()
    if (this.baseline === null) { this.baseline = v; return false }
    const delta = v - this.baseline
    const past = this.cfg.threshold >= 0 ? delta >= this.cfg.threshold : delta <= this.cfg.threshold
    if (past) {
      if (this.dipSince === null) this.dipSince = t
      else if (t - this.dipSince > this.cfg.windowMs) { this.baseline = v; this.dipSince = null } // held: a tilt, not a nod
      return false
    }
    const dip = this.dipSince
    this.dipSince = null
    this.baseline += BASELINE_ALPHA * delta
    if (dip === null || t - dip > this.cfg.windowMs || t - this.lastFire < this.cfg.cooldownMs) return false
    this.lastFire = t
    return true
  }
}
