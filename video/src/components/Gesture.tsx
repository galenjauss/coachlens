import type React from 'react'
import { useCurrentFrame } from 'remotion'
import { C, FONT } from '../theme'
import { ease, lin } from './motion'

/**
 * A touchpad gesture on the G2 temple: expanding rings at (x, y) starting at frame `at`, with a mono
 * label ("TAP", "2× TAP"). `double` fires a second ring 7 frames later.
 */
export const TapRipple: React.FC<{ at: number; x: number; y: number; label?: string; double?: boolean; hold?: number }> = ({ at, x, y, label = 'TAP', double = false, hold = 40 }) => {
  const frame = useCurrentFrame()
  const local = frame - at
  if (local < -4 || local > hold + 20) return null
  const rings = double ? [0, 7] : [0]
  const labelIn = ease(local, [0, 8], [0, 1])
  const labelOut = lin(local, [hold, hold + 12], [1, 0])
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 0, height: 0 }}>
      {rings.map(d => {
        const p = ease(local - d, [0, 22], [0, 1])
        const o = lin(local - d, [0, 4, 24], [0, 0.9, 0])
        return (
          <div key={d} style={{ position: 'absolute', left: -60, top: -60, width: 120, height: 120, borderRadius: '50%', border: `2px solid ${C.white}`, opacity: o, scale: String(0.2 + p * 0.9) }} />
        )
      })}
      <div style={{ position: 'absolute', left: -9, top: -9, width: 18, height: 18, borderRadius: '50%', background: C.white, opacity: lin(local, [0, 3, 14], [0, 1, 0.35]) * labelOut }} />
      <div
        style={{
          position: 'absolute', left: 36, top: -16, fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em',
          color: C.white, whiteSpace: 'nowrap', opacity: labelIn * labelOut, translate: `${(1 - labelIn) * -10}px 0`,
        }}
      >
        {label}
      </div>
    </div>
  )
}
