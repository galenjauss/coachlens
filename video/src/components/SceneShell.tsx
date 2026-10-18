import type React from 'react'
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { C } from '../theme'
import { lin } from './motion'

/** Scene background with a short fade up from black and a quick dip at the end (cuts stay crisp). */
export const SceneShell: React.FC<{ children: React.ReactNode; fadeIn?: number; fadeOut?: number; bg?: string }> = ({ children, fadeIn = 6, fadeOut = 5, bg = C.bg }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const o = Math.min(fadeIn ? lin(frame, [0, fadeIn], [0, 1]) : 1, fadeOut ? lin(frame, [durationInFrames - fadeOut, durationInFrames], [1, 0]) : 1)
  return (
    <AbsoluteFill style={{ background: bg }}>
      <AbsoluteFill style={{ opacity: o }}>{children}</AbsoluteFill>
    </AbsoluteFill>
  )
}

/** A soft, off-centre pool of light so black never reads as flat. */
export const Atmos: React.FC<{ x?: string; y?: string; tint?: string; strength?: number }> = ({ x = '50%', y = '45%', tint = '236,239,234', strength = 0.035 }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse 60% 55% at ${x} ${y}, rgba(${tint},${strength}), rgba(${tint},0) 70%)` }} />
)
