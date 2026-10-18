import { evolvePath } from '@remotion/paths'
import type React from 'react'
import { C } from '../theme'

/** A drawn connector from (x1,y1) to (x2,y2): a horizontal-tangent cubic, revealed by `progress`. */
export const Connector: React.FC<{ x1: number; y1: number; x2: number; y2: number; progress: number; color?: string; opacity?: number }> = ({ x1, y1, x2, y2, progress, color = C.green, opacity = 1 }) => {
  const mx = (x1 + x2) / 2
  const d = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
  if (progress <= 0) return null
  const ev = evolvePath(progress, d)
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', opacity }}>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.18} strokeWidth={8} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} strokeLinecap="round" />
      <path d={d} fill="none" stroke={color} strokeWidth={2.5} strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} strokeLinecap="round" />
      <circle cx={x1} cy={y1} r={6 * Math.min(1, progress * 4)} fill={color} />
      {progress >= 0.98 ? <circle cx={x2} cy={y2} r={5} fill={color} /> : null}
    </svg>
  )
}
