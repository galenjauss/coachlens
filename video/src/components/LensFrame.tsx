import type React from 'react'
import { C } from '../theme'
import { LENS_H, LENS_W, LensDisplay, type LensDisplayProps } from './LensDisplay'

export type LensFrameProps = Omit<LensDisplayProps, 'spec'> & {
  spec?: LensDisplayProps['spec']
  /** Rim visibility 0..1 (the lens-off state keeps a 1 px rim). */
  rim?: number
  /** Extra green bloom behind the glass, e.g. a pulse. */
  bloom?: number
  style?: React.CSSProperties
  children?: React.ReactNode
}

/** Glass padding around the 576×288 display, in lens px. */
const GLASS_X = 46
const GLASS_Y = 40

export const lensFrameSize = (scale: number) => ({ w: (LENS_W + GLASS_X * 2) * scale, h: (LENS_H + GLASS_Y * 2) * scale })

/** The stylized G2 lens: a rounded glass window, a faint rim, scanlines, and the real display inside. */
export const LensFrame: React.FC<LensFrameProps> = ({ rim = 1, bloom = 0, style, children, spec, ...display }) => {
  const s = display.scale
  const { w, h } = lensFrameSize(s)
  const power = display.power ?? 1
  const lit = spec ? power : 0
  return (
    <div style={{ position: 'relative', width: w, height: h, ...style }}>
      {/* Ambient spill from the lit display */}
      <div
        style={{
          position: 'absolute', inset: -s * 60, borderRadius: '50%',
          background: `radial-gradient(closest-side, rgba(61,255,122,${0.07 * lit + 0.12 * bloom}), rgba(61,255,122,0) 70%)`,
        }}
      />
      {/* Eyewear frame: a thin dark band with a lit top edge, just outside the glass */}
      <div
        style={{
          position: 'absolute', inset: -9 * s, borderRadius: 73 * s,
          background: 'linear-gradient(180deg, #1A1E1C 0%, #0B0D0C 45%, #0E1110 100%)',
          boxShadow: `inset 0 1px 0 rgba(236,239,234,${0.18 * rim}), 0 0 0 1px rgba(0,0,0,0.6)`, opacity: rim,
        }}
      />
      {/* Glass body */}
      <div
        style={{
          position: 'absolute', inset: 0, borderRadius: 64 * s, overflow: 'hidden',
          background: 'linear-gradient(160deg, #0A0D0C 0%, #040605 55%, #060807 100%)',
          boxShadow: `inset 0 0 0 1px rgba(236,239,234,${0.2 * rim}), inset 0 1px 0 rgba(236,239,234,${0.12 * rim}), 0 ${30 * s}px ${80 * s}px rgba(0,0,0,0.55), 0 0 ${40 * s}px rgba(61,255,122,${0.18 * bloom})`,
        }}
      >
        {/* Display area */}
        <div style={{ position: 'absolute', left: GLASS_X * s, top: GLASS_Y * s }}>
          {spec ? <LensDisplay spec={spec} {...display} /> : null}
        </div>
        {/* Phosphor scanlines */}
        <div
          style={{
            position: 'absolute', inset: 0, opacity: 0.55,
            backgroundImage: `repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) ${Math.max(1, s * 0.6)}px, transparent ${Math.max(1, s * 0.6)}px, transparent ${s * 2}px)`,
          }}
        />
        {/* Glass reflection */}
        <div
          style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(115deg, rgba(255,255,255,0.035) 0%, rgba(255,255,255,0.012) 26%, rgba(255,255,255,0) 40%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.02) 100%)',
          }}
        />
        <div
          style={{
            position: 'absolute', left: '-10%', top: '-60%', width: '70%', height: '120%', rotate: '-18deg',
            background: 'radial-gradient(closest-side, rgba(255,255,255,0.022), rgba(255,255,255,0))',
          }}
        />
      </div>
      {/* Outer hairline rim */}
      <div style={{ position: 'absolute', inset: 0, borderRadius: 64 * s, border: `1px solid rgba(236,239,234,${0.16 * rim})`, pointerEvents: 'none' }} />
      {children}
    </div>
  )
}

/** Where a lens-px point lands inside a LensFrame of `scale` (for overlays and connector anchors). */
export const lensPoint = (scale: number, x: number, y: number) => ({ x: (GLASS_X + x) * scale, y: (GLASS_Y + y) * scale })

export { C }
