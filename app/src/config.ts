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
export const NOD: NodConfig = { enabled: true, axis: 'x', threshold: -0.22, windowMs: 1500, cooldownMs: 1200 }
/**
 * IMU report pace while class runs (or the readout is open). SDK range P100…P1000; the SDK default is
 * P100. The nod detector needs ≥ 2 dipped samples ≥ 120 ms apart and a return within 1.5 s, so keep
 * this at P100–P300 (a fast ~300 ms nod needs ~P100). The IMU runs from lens start until exit.
 */
export const IMU_PACE: ImuReportPace = ImuReportPace.P100
export const IMU_LOG: boolean = import.meta.env.VITE_IMU_LOG === '1'
/**
 * Open the glasses mic and the phone mic together when recording starts; on stop, keep the glasses
 * audio when it has ≥ 0.4 s, else the phone audio (see `selectMic`). Off = the older sequential
 * fallback (phone mic only after MIC_FALLBACK_MS without glasses audio).
 */
export const MIC_DUAL_START: boolean = true
/** Lens suffix for notes waiting in the outbox (`⟳ 2 queued`). Verify the glyph on G2 hardware; swap if it doesn't render. */
export const QUEUED_GLYPH: string = '⟳'
