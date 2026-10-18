import { ImuReportPace } from '@evenrealities/even_hub_sdk'
import type { NodConfig } from './lens/nod'

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'

/**
 * Nod to toggle the lens (experimental). The IMU axis and sign are undocumented: calibrate on
 * hardware with the phone readout (open the app with `?imu=1`). Nod a few times, find the axis
 * with the largest swing, and set `threshold` to about half that swing, signed in the direction
 * the value moves when the head goes down (negative = it decreases).
 */
export const NOD: NodConfig = { enabled: true, axis: 'y', threshold: 0.3, windowMs: 600, cooldownMs: 1200 }
/**
 * IMU report pace while class runs (or the readout is open). SDK range P100…P1000; the SDK default is
 * P100. The readout shows the real sample rate: a nod needs at least one sample inside 600 ms.
 */
export const IMU_PACE: ImuReportPace = ImuReportPace.P100
export const IMU_LOG: boolean = import.meta.env.VITE_IMU_LOG === '1'
/**
 * Opt-in (`?partial=1`): send per-second clock changes as partial upgrades (contentOffset/contentLength,
 * `content` = the replacement substring per the SDK reference). Off by default because the simulator
 * ignores the offset (it showed only the changed digits) and hardware behaviour is unverified. The
 * default full upgrade of the ~10-char timer container is already tiny.
 */
export const PARTIAL_UPGRADES: boolean = typeof location !== 'undefined' && new URLSearchParams(location.search).get('partial') === '1'
