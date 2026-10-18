export type ImuAxis = 'x' | 'y' | 'z'
export type ImuSample = { x?: number; y?: number; z?: number }

/**
 * Nod = the chosen axis moves `threshold` away from its resting value and comes back within
 * `windowMs`. The sign of `threshold` is the direction of the dip (negative = the value goes down
 * while nodding). `enabled: false` is the kill switch (the controller ignores nods).
 */
export interface NodConfig { enabled: boolean; axis: ImuAxis; threshold: number; windowMs: number; cooldownMs: number }

/** Time constant of the resting value: it follows slow head movement (posture, walking drift). */
export const BASELINE_TAU_MS = 800
/** A real nod stays past the threshold at least this long… */
export const MIN_DIP_MS = 120
/** …and for at least this many samples (one noisy sample is never a nod). */
export const MIN_DIP_SAMPLES = 2

type Past = { first: number; last: number; samples: number }

/**
 * A nod at any natural speed: the movement starts (`onset`: past half the threshold), reaches the
 * threshold for ≥ MIN_DIP_MS over ≥ MIN_DIP_SAMPLES consecutive samples, and comes BACK (within
 * threshold/2 of rest), all within `windowMs` of the onset. From onset until it ends the resting
 * value is frozen, so a slow dip is never absorbed into it. Looking down and staying down (no return
 * within the window) never fires: that position becomes the new resting value. A hard swing the
 * other way (walking jitter) cancels. After firing, nothing fires for `cooldownMs`.
 * Pure: time comes from the injected clock.
 */
export class NodDetector {
  private baseline: number | null = null
  private lastT = 0
  private onset: number | null = null
  private past: Past | null = null
  private inPast = false
  private lastFire = Number.NEGATIVE_INFINITY

  constructor(private cfg: NodConfig, private now: () => number = Date.now) {}

  private reset(): void { this.onset = null; this.past = null; this.inPast = false }

  push(sample: ImuSample): boolean {
    const v = sample[this.cfg.axis] ?? 0 // protobuf omits zero values
    const t = this.now()
    const dt = Math.max(0, t - this.lastT)
    this.lastT = t
    if (this.baseline === null) { this.baseline = v; return false }
    const T = Math.abs(this.cfg.threshold)
    const d = (this.cfg.threshold >= 0 ? 1 : -1) * (v - this.baseline) // + = toward the nod

    if (d <= -T) { this.reset(); this.track(v, dt); return false } // swung hard the other way
    if (d > T / 2) { // moving away from rest: baseline frozen
      if (this.onset === null) this.onset = t
      if (d >= T) {
        // A dip is one unbroken run of past-threshold samples: past again after leaving = restart.
        if (!this.past || !this.inPast) this.past = { first: t, last: t, samples: 1 }
        else { this.past.samples += 1; this.past.last = t }
        this.inPast = true
      } else this.inPast = false
      if (t - this.onset > this.cfg.windowMs) { this.baseline = v; this.reset() } // stayed down: a tilt, not a nod
      return false
    }
    // Back near rest: decide, then resume tracking.
    const p = this.past
    const fire = p !== null && this.onset !== null && t - this.onset <= this.cfg.windowMs
      && p.samples >= MIN_DIP_SAMPLES && p.last - p.first >= MIN_DIP_MS && t - this.lastFire >= this.cfg.cooldownMs
    this.reset()
    this.track(v, dt)
    if (fire) this.lastFire = t
    return fire
  }

  private track(v: number, dt: number): void {
    this.baseline! += (1 - Math.exp(-dt / BASELINE_TAU_MS)) * (v - this.baseline!)
  }
}
