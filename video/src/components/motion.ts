import { Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { SPRING } from '../theme'

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const

/** 0→1 entrance spring starting at `delay` frames (damping 200, mass 0.8). */
export function useEnter(delay = 0, durationInFrames?: number): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ frame: frame - delay, fps, config: SPRING, durationInFrames })
}

/** Same as useEnter, for use inside loops (pass frame and fps explicitly). */
export const enterAt = (frame: number, fps: number, delay: number, durationInFrames?: number): number =>
  spring({ frame: frame - delay, fps, config: SPRING, durationInFrames })

/** Clamped interpolate with an expo-out curve: the house ease for anything not driven by a spring. */
export const ease = (frame: number, input: [number, number], output: [number, number]): number =>
  interpolate(frame, input, output, { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) })

export const lin = (frame: number, input: number[], output: number[]): number => interpolate(frame, input, output, clamp)

/** Characters revealed by a typewriter at `cps` chars/second, starting at `start`. */
export const typed = (frame: number, fps: number, start: number, cps = 28): number =>
  Math.max(0, Math.floor(((frame - start) / fps) * cps))

/** Frames needed to type `text` at `cps`. */
export const typeFrames = (text: string, fps: number, cps = 28): number => Math.ceil((text.length / cps) * fps)
