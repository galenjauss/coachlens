export type ImuAxis = 'x' | 'y' | 'z'
export type ImuSample = { x?: number; y?: number; z?: number }

/**
 * Nod = the chosen axis moves `threshold` away from its resting value, stays there briefly, and
 * comes back within `windowMs`. The sign of `threshold` is the direction of the dip (negative = the
 * value goes down while nodding). `enabled: false` is the kill switch (the controller ignores nods).
 */
export interface NodConfig { enabled: boolean; axis: ImuAxis; threshold: number; windowMs: number; cooldownMs: number }

/** Time constant of the resting value: it follows slow head movement (looking down, walking). */
export const BASELINE_TAU_MS = 800
/** A real nod stays past the threshold at least this long… */
export const MIN_DIP_MS = 120
/** …and for at least this many samples (one noisy sample is never a nod). */
export const MIN_DIP_SAMPLES = 2

/** `returning`: the past-threshold run ended; waiting for the head to come back. */
type Dip = { start: number; lastPast: number; samples: number; returning: boolean }

/**
 * Fires once per nod, on the sample where the head is BACK (within threshold/2 of the resting value),
 * if the dip lasted ≥ MIN_DIP_MS over ≥ MIN_DIP_SAMPLES samples and everything happened within
 * `windowMs`. Spikes and walking jitter (single samples) never fire; a dip held past the window is a
 * tilt and becomes the new resting value. After firing, nothing fires for `cooldownMs`.
 * Pure: time comes from the injected clock.
 */
export class NodDetector {
  private baseline: number | null = null
  private lastT = 0
  private dip: Dip | null = null
  private lastFire = Number.NEGATIVE_INFINITY

  constructor(private cfg: NodConfig, private now: () => number = Date.now) {}

  push(sample: ImuSample): boolean {
    const v = sample[this.cfg.axis] ?? 0 // protobuf omits zero values
    const t = this.now()
    const dt = Math.max(0, t - this.lastT)
    this.lastT = t
    if (this.baseline === null) { this.baseline = v; return false }
    const delta = v - this.baseline
    const th = this.cfg.threshold
    const past = th >= 0 ? delta >= th : delta <= th
    const back = Math.abs(delta) <= Math.abs(th) / 2

    if (past) {
      // A dip is one unbroken run of past-threshold samples: past again while returning = jitter, restart.
      if (!this.dip || this.dip.returning) this.dip = { start: t, lastPast: t, samples: 1, returning: false }
      else { this.dip.samples += 1; this.dip.lastPast = t }
      if (t - this.dip.start > this.cfg.windowMs) { this.baseline = v; this.dip = null } // held: a tilt, not a nod
      return false
    }
    if (this.dip) {
      const d = this.dip
      d.returning = true
      const overshoot = th >= 0 ? delta <= -th : delta >= -th // swung hard the other way: walking, not a nod
      if (overshoot || t - d.start > this.cfg.windowMs) { this.dip = null; return false }
      if (!back) return false // on the way back: wait for the next sample
      this.dip = null
      if (d.samples < MIN_DIP_SAMPLES || d.lastPast - d.start < MIN_DIP_MS || t - this.lastFire < this.cfg.cooldownMs) return false
      this.lastFire = t
      return true
    }
    this.baseline += (1 - Math.exp(-dt / BASELINE_TAU_MS)) * delta
    return false
  }
}
