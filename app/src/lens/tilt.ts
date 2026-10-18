export const TILT_HOLD_MS = 300
export const TILT_COOLDOWN_MS = 4000

export type TiltAxis = 'x' | 'y' | 'z'
export interface TiltConfig { axis: TiltAxis; threshold: number }
export type ImuSample = { x?: number; y?: number; z?: number }

/**
 * Fires once when the chosen IMU axis goes past `threshold` and stays there for TILT_HOLD_MS.
 * A negative threshold means "below". After firing it re-arms only once the head comes back
 * (value back inside the threshold) AND TILT_COOLDOWN_MS has passed, so holding the head down
 * never re-peeks in a loop. Pure: time comes from the injected clock.
 */
export class HeadTiltDetector {
  private pastSince: number | null = null
  private lastFire = Number.NEGATIVE_INFINITY
  private armed = true

  constructor(private cfg: TiltConfig, private now: () => number = Date.now) {}

  push(sample: ImuSample): boolean {
    const v = sample[this.cfg.axis] ?? 0 // protobuf omits zero values
    const past = this.cfg.threshold >= 0 ? v >= this.cfg.threshold : v <= this.cfg.threshold
    const t = this.now()
    if (!past) {
      this.pastSince = null
      this.armed = true
      return false
    }
    if (this.pastSince === null) this.pastSince = t
    if (!this.armed || t - this.lastFire < TILT_COOLDOWN_MS || t - this.pastSince < TILT_HOLD_MS) return false
    this.lastFire = t
    this.armed = false
    return true
  }
}
