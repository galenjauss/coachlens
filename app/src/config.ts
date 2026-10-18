import type { TiltConfig } from './lens/tilt'

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787'

/**
 * Head-tilt peek. The IMU axis and sign are undocumented: calibrate on hardware (Task 20) by
 * running with VITE_IMU_LOG=1, noting `[imu] x y z` with the head level vs tilted down, then
 * set the axis and a threshold between the two (negative = "below").
 */
export const TILT: TiltConfig = { axis: 'y', threshold: 0.5 }
export const IMU_LOG: boolean = import.meta.env.VITE_IMU_LOG === '1'
