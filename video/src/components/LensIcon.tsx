import { evolvePath } from '@remotion/paths'
import type React from 'react'
import { C } from '../theme'

/**
 * The CoachLens mark (docs/store/icon/foreground.svg): a lens ring, a focus dot toward the upper right
 * and two short lines. `draw` 0..1 draws the ring on with evolvePath; `dot` and `lines` pop in after.
 */
const RING = 'M 512 212 A 300 300 0 1 1 511.9 212'
export const LensIcon: React.FC<{ size: number; draw?: number; dot?: number; lines?: number; color?: string; dotColor?: string; glowAmt?: number }> = ({
  size, draw = 1, dot = 1, lines = 1, color = C.white, dotColor = C.green, glowAmt = 1,
}) => {
  const ring = evolvePath(draw, RING)
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" style={{ overflow: 'visible' }}>
      <path d={RING} fill="none" stroke={color} strokeWidth={72} strokeLinecap="round" strokeDasharray={ring.strokeDasharray} strokeDashoffset={ring.strokeDashoffset} />
      <circle cx={640} cy={384} r={64 * dot} fill={dotColor} style={{ filter: `drop-shadow(0 0 ${24 * glowAmt}px rgba(61,255,122,0.8))` }} />
      <path d="M332 640 L440 640" stroke={color} strokeWidth={44} strokeLinecap="round" opacity={lines} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - lines} />
      <path d="M332 560 L392 560" stroke={C.muted} strokeWidth={44} strokeLinecap="round" opacity={lines} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - lines} />
    </svg>
  )
}
