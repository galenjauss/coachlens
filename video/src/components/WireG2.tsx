import { useCurrentFrame } from 'remotion'
import { lin } from '../lib/anim'
import { C, FONT } from '../theme'

type P3 = [number, number, number]

/** A rounded-rect lens rim as a 3D polyline (superellipse), centred at (cx, 0, 0). */
const rim = (cx: number, w: number, h: number, n = 48): P3[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    const c = Math.cos(a)
    const s = Math.sin(a)
    const e = 0.42
    return [cx + Math.sign(c) * Math.abs(c) ** e * w, Math.sign(s) * Math.abs(s) ** e * h, 0]
  })

const LW = 150
const LH = 98
const GAP = 34
const LEFT = rim(-(LW + GAP), LW, LH)
const RIGHT = rim(LW + GAP, LW, LH)
const BRIDGE: P3[] = [[-GAP, -30, 0], [-GAP * 0.5, -46, 0], [GAP * 0.5, -46, 0], [GAP, -30, 0]]
const TEMPLE_L: P3[] = [[-(2 * LW + GAP), -40, 0], [-(2 * LW + GAP) - 6, -44, -120], [-(2 * LW + GAP) - 10, -44, -380], [-(2 * LW + GAP) - 6, 10, -470]]
const TEMPLE_R: P3[] = TEMPLE_L.map(([x, y, z]) => [-x, y, z])
/** The display window in the right lens: where the 576×288 picture lives. */
const DISPLAY: P3[] = [[LW + GAP - 92, -34, 2], [LW + GAP + 92, -34, 2], [LW + GAP + 92, 46, 2], [LW + GAP - 92, 46, 2], [LW + GAP - 92, -34, 2]]

interface WireG2Props {
  /** Y rotation in degrees and X tilt. */
  yaw: number
  pitch: number
  scale: number
  cx: number
  cy: number
  color?: string
  /** 0..1 draw-on progress. */
  draw?: number
  /** Glow of the display window (0 = dark glass). */
  lit?: number
  labels?: number
}

/** A wireframe Even G2, drawn from 3D polylines with a perspective projection. */
export function WireG2({ yaw, pitch, scale, cx, cy, color = C.paper, draw = 1, lit = 0, labels = 0 }: WireG2Props) {
  const f = useCurrentFrame()
  const ya = (yaw * Math.PI) / 180
  const pa = (pitch * Math.PI) / 180
  const proj = ([x, y, z]: P3): [number, number] => {
    const x1 = x * Math.cos(ya) + z * Math.sin(ya)
    const z1 = -x * Math.sin(ya) + z * Math.cos(ya)
    const y1 = y * Math.cos(pa) - z1 * Math.sin(pa)
    const z2 = y * Math.sin(pa) + z1 * Math.cos(pa)
    const d = 1400 / (1400 - z2)
    return [cx + x1 * d * scale, cy + y1 * d * scale]
  }
  const path = (pts: P3[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${proj(p).map(v => v.toFixed(1)).join(' ')}`).join(' ')
  const parts = [LEFT, RIGHT, BRIDGE, TEMPLE_L, TEMPLE_R]
  const disp = proj(DISPLAY[1] ?? [0, 0, 0])
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <path d={path(RIGHT)} fill={`rgba(61,255,122,${0.05 + lit * 0.12})`} stroke="none" />
      {parts.map((pts, i) => {
        // The far temple sits behind the lenses: drawn as a dim hidden line, engineering-drawing style.
        const hidden = pts === TEMPLE_L
        const p = lin(draw, [i * 0.12, i * 0.12 + 0.5], [0, 1])
        return hidden ? (
          <path key={i} d={path(pts)} fill="none" stroke={color} strokeWidth={1.4} strokeDasharray="7 7" opacity={0.35 * p} />
        ) : (
          <path key={i} d={path(pts)} fill="none" stroke={color} strokeWidth={2.2} strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} />
        )
      })}
      {[0.82, 0.64].map((k, i) => (
        <path key={`in${i}`} d={path(rim(LW + GAP, LW * k, LH * k))} fill="none" stroke={color} strokeWidth={1} opacity={0.25 * draw} />
      ))}
      <path d={path(DISPLAY)} fill="none" stroke={C.green} strokeWidth={1.6} strokeDasharray="6 5" opacity={0.5 * draw + lit * 0.5} style={{ filter: lit > 0 ? `drop-shadow(0 0 ${8 * lit}px ${C.green})` : undefined }} />
      {labels > 0.01 ? (
        <g opacity={labels} style={{ fontFamily: FONT.mono, fontSize: 15, letterSpacing: '0.2em' }}>
          <line x1={disp[0]} y1={disp[1]} x2={disp[0] + 120} y2={disp[1] - 110} stroke={color} strokeWidth={1} />
          <text x={disp[0] + 128} y={disp[1] - 114} fill={color}>
            {'DISPLAY · 576×288 · GREEN'}
          </text>
          <text x={disp[0] + 128} y={disp[1] - 90} fill={C.muted}>
            {`LIT PIXELS: ${lit > 0.5 ? 'SOME' : 'NONE'}  ·  T+${String(Math.floor(f / 3)).padStart(3, '0')}`}
          </text>
        </g>
      ) : null}
    </svg>
  )
}
