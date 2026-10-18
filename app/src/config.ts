import { ImuReportPace } from '@evenrealities/even_hub_sdk'
import type { NodConfig } from './lens/nod'

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'

/**
 * Nod to toggle the lens (experimental). The IMU axis and sign are undocumented: calibrate on
 * hardware with the phone readout (open the app with `?imu=1`). Nod a few times, find the axis
 * with the largest swing, and set `threshold` to about half that swing, signed in the direction
 * the value moves when the head goes down (negative = it decreases).
 */
// Calibrated on Galen's G2: x rests ≈ -0.11 and dips to ≈ -0.55 on a nod (y barely moves), so the dip
// is ≈ -0.44 from the resting value; the threshold is about half of that, below the baseline.
export const NOD: NodConfig = { enabled: true, axis: 'x', threshold: -0.22, windowMs: 600, cooldownMs: 1200 }
/**
 * IMU report pace while class runs (or the readout is open). SDK range P100…P1000; the SDK default is
 * P100. The nod detector needs ≥ 2 dipped samples ≥ 120 ms apart plus the return inside 600 ms, so
 * keep this at P100–P200 (P300+ cannot fit three samples in the window). The readout shows the rate.
 */
export const IMU_PACE: ImuReportPace = ImuReportPace.P100
export const IMU_LOG: boolean = import.meta.env.VITE_IMU_LOG === '1'
