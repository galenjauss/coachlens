import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ease, EASE } from '../lib/anim'
import { C } from '../theme'

interface IrisProps {
  /** Local frame the ring starts opening, and how long it takes. */
  at: number
  dur?: number
  cx?: number
  cy?: number
  ring?: string
  children: React.ReactNode
}

/**
 * The lens-ring iris: the CoachLens ring (with its focus dot) opens from the centre and the next
 * picture is seen through it, until it fills the frame.
 */
export function IrisReveal({ at, dur = 14, cx = 960, cy = 540, ring = C.green, children }: IrisProps) {
  const f = useCurrentFrame()
  const p = ease(f, [at, at + dur], [0, 1], EASE.inExpo)
  const r = 40 + p * 1250
  if (f < at) return null
  const done = p >= 1
  const sw = 10 + r * 0.05
  const dotA = -Math.PI / 4
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ clipPath: done ? undefined : `circle(${r}px at ${cx}px ${cy}px)` }}>{children}</AbsoluteFill>
      {!done ? (
        <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={ring} strokeWidth={sw} style={{ filter: `drop-shadow(0 0 ${14 + r * 0.02}px rgba(61,255,122,0.7))` }} />
          <circle cx={cx + Math.cos(dotA) * r * 0.43} cy={cy + Math.sin(dotA) * r * 0.43} r={sw * 0.9} fill={ring} opacity={1 - p} />
        </svg>
      ) : null}
    </AbsoluteFill>
  )
}
