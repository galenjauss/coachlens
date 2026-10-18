import type React from 'react'
import { Img, staticFile, useCurrentFrame } from 'remotion'
import { ease, EASE, lin, pop } from '../lib/anim'
import { PHOSPHOR } from '../theme'

export type LensFrame = { src: string; at: number }

/** A rectangle in the capture's own 576×288 pixel space. */
export type CapRect = { x: number; y: number; w: number; h: number }

interface LensShotProps {
  /** Real simulator captures (paths under public/captures/lens), each shown from its local frame. */
  frames: readonly LensFrame[]
  /** Integer upscale of the 576×288 capture (2 → 1152×576). */
  scale?: number
  /** Local frame the glass lands. */
  enterAt?: number
  enter?: 'pop' | 'fade' | 'none' | 'rise'
  /** Y/X rotation (deg) at start and end of [t0, t1]: slow parallax drift. */
  ry?: readonly [number, number]
  rx?: readonly [number, number]
  /** Dolly scale over [t0, t1]. */
  dolly?: readonly [number, number]
  span?: readonly [number, number]
  /** Rack focus: blur px as a function of local frame. */
  focus?: (f: number) => number
  /** Crossfade between captures (frames). 0 = hard swap like the device. */
  xfade?: number
  highlight?: readonly (CapRect & { from: number; to: number; color: string })[]
  /** Hide the capture right of a sweep (reveals lines left to right). */
  reveal?: readonly (CapRect & { from: number; to: number })[]
  taps?: readonly number[]
  /** Brightness of the lit pixels 0..1 (fade-up from dark). */
  power?: (f: number) => number
  style?: React.CSSProperties
  /** Extra kick in scale (impact) at a local frame. */
  punchAt?: number
}

const GLASS = '#060a08'

/** A real lens capture floating in 3D: dark glass, phosphor glow, parallax, push-in, rack focus. */
export function LensShot({
  frames, scale = 2, enterAt = 0, enter = 'pop', ry = [-16, -10], rx = [7, 4], dolly = [1, 1.12], span, focus, xfade = 2,
  highlight, reveal, taps = [], power, style, punchAt,
}: LensShotProps) {
  const f = useCurrentFrame()
  const W = 576 * scale
  const H = 288 * scale
  const pad = 34 * scale * 0.5
  const [t0, t1] = span ?? [enterAt, enterAt + 150]
  const k = lin(f, [t0, t1], [0, 1])
  const kk = EASE.inOut(k)
  const e = enter === 'pop' ? pop(f, enterAt, 150, 16, 0.9) : enter === 'rise' ? ease(f, [enterAt, enterAt + 20], [0, 1]) : enter === 'fade' ? lin(f, [enterAt, enterAt + 12], [0, 1]) : 1
  const punch = punchAt === undefined ? 0 : Math.max(0, 1 - pop(f, punchAt, 260, 9, 0.5)) * 0.08
  const s = (dolly[0] + (dolly[1] - dolly[0]) * kk) * (enter === 'pop' ? 0.82 + 0.18 * e : 1) + punch
  const y = enter === 'rise' ? (1 - e) * 140 : 0
  const rotY = ry[0] + (ry[1] - ry[0]) * kk
  const rotX = rx[0] + (rx[1] - rx[0]) * kk
  const blur = focus ? focus(f) : 0
  const lit = power ? power(f) : 1
  const shown = frames.filter(fr => fr.at <= f)
  const cur = shown[shown.length - 1] ?? frames[0]
  const prev = shown.length > 1 ? shown[shown.length - 2] : undefined
  const xf = cur && prev && xfade > 0 ? lin(f, [cur.at, cur.at + xfade], [0, 1]) : 1
  // Unrevealed parts of the capture are cut out with an even-odd clip path (no overlay boxes).
  const holes = (reveal ?? [])
    .map(r => {
      const p = lin(f, [r.from, r.to], [0, 1])
      const x = (r.x + r.w * p) * scale
      const w = r.w * (1 - p) * scale
      return w > 0.5 ? `M${x} ${r.y * scale} h${w} v${r.h * scale} h${-w} Z` : ''
    })
    .join(' ')
  const clip = holes ? `path(evenodd, 'M0 0 H${W} V${H} H0 Z ${holes}')` : undefined
  const img = (src: string, op: number) => (
    <div style={{ position: 'absolute', left: pad, top: pad, width: W, height: H, filter: PHOSPHOR, opacity: op * lit }}>
      <Img src={staticFile(`captures/${src}`)} style={{ width: W, height: H, imageRendering: 'pixelated', clipPath: clip, display: 'block' }} />
    </div>
  )
  const sheenX = -40 + rotY * 3
  return (
    <div style={{ perspective: 1700, opacity: enter === 'fade' || enter === 'rise' ? e : lin(f, [enterAt - 1, enterAt + 2], [0, 1]), ...style }}>
      <div
        style={{
          position: 'relative',
          width: W + pad * 2,
          height: H + pad * 2,
          transform: `translateY(${y}px) rotateY(${rotY}deg) rotateX(${rotX}deg) scale(${s})`,
          transformStyle: 'preserve-3d',
          filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 26 * scale * 0.5,
            background: `linear-gradient(160deg, #0d1411 0%, ${GLASS} 55%, #030504 100%)`,
            boxShadow: '0 1px 0 rgba(255,255,255,0.10) inset, 0 0 0 1px rgba(236,239,234,0.10), 0 24px 40px rgba(0,0,0,0.45), 0 60px 140px rgba(0,0,0,0.55), 0 0 120px rgba(61,255,122,0.10)',
            overflow: 'hidden',
          }}
        >
          {(highlight ?? []).map((h, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: pad + h.x * scale,
                top: pad + h.y * scale,
                height: h.h * scale,
                width: h.w * scale * ease(f, [h.from, h.to], [0, 1], EASE.inOut),
                background: h.color,
                borderRadius: 4,
              }}
            />
          ))}
          {prev && xf < 1 ? img(prev.src, 1 - xf) : null}
          {cur ? img(cur.src, xf) : null}
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)', mixBlendMode: 'multiply' }} />
          <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(115deg, transparent ${30 + sheenX * 0.2}%, rgba(255,255,255,0.06) ${38 + sheenX * 0.2}%, transparent ${52 + sheenX * 0.2}%)` }} />
        </div>
        {taps.map(t => {
          const p = lin(f, [t, t + 16], [0, 1])
          if (f < t || p >= 1) return null
          return (
            <div
              key={t}
              style={{
                position: 'absolute',
                left: W + pad * 2 + 30,
                top: (H + pad * 2) / 2,
                width: 40 + p * 160,
                height: 40 + p * 160,
                transform: 'translate(-50%, -50%)',
                borderRadius: '50%',
                border: `3px solid rgba(61,255,122,${1 - p})`,
                boxShadow: `0 0 24px rgba(61,255,122,${0.6 * (1 - p)})`,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}
