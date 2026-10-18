import { Easing, interpolate, spring } from 'remotion'
import { FPS } from '../timeline'

const CLAMP = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** Clamped linear interpolate. */
export const lin = (f: number, input: readonly number[], output: readonly number[]): number =>
  interpolate(f, input as number[], output as number[], CLAMP)

export const EASE = {
  outExpo: Easing.bezier(0.16, 1, 0.3, 1),
  inExpo: Easing.bezier(0.7, 0, 0.84, 0),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  outCubic: Easing.bezier(0.33, 1, 0.68, 1),
  inCubic: Easing.bezier(0.32, 0, 0.67, 0),
} as const

export const ease = (f: number, input: readonly [number, number], output: readonly [number, number], fn = EASE.outExpo): number =>
  interpolate(f, input as unknown as number[], output as unknown as number[], { ...CLAMP, easing: fn })

/** A springy 0→1 that overshoots and settles: giant words landing. */
export const pop = (f: number, delay = 0, stiffness = 170, damping = 13, mass = 0.7): number =>
  spring({ frame: f - delay, fps: FPS, config: { stiffness, damping, mass } })

/** A firm, non-overshooting 0→1. */
export const settle = (f: number, delay = 0, durationInFrames?: number): number =>
  spring({ frame: f - delay, fps: FPS, config: { damping: 200, mass: 0.8 }, durationInFrames })

/** Per-frame velocity of a frame-driven value, for motion blur. */
export const velocity = (fn: (f: number) => number, f: number): number => fn(f) - fn(f - 1)

/** Deterministic pseudo-random in [0, 1). */
export const rand = (seed: number): number => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Timecode HH:MM:SS:FF. */
export const timecode = (f: number): string => {
  const ff = f % FPS
  const s = Math.floor(f / FPS)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`
}
