import { useCurrentFrame } from 'remotion'
import { lin, pop } from '../lib/anim'

export type DotLayout = 'ring' | 'grid' | 'phyllo'

interface ClassDotsProps {
  n: number
  /** Centre in px (inside a 1920×1080 canvas). */
  cx: number
  cy: number
  size: number
  layout: DotLayout
  /** Optional second layout to morph to, and the 0..1 morph amount. */
  to?: DotLayout
  morph?: number
  dot: number
  color: string
  litColor: string
  /** Frame each dot pops in (index → frame); default: all present. */
  appearAt?: (i: number) => number
  /** Frame each dot lights up, or undefined for never. */
  litAt?: (i: number) => number | undefined
  /** Degrees per frame. */
  spin?: number
  ringLine?: string
}

const place = (layout: DotLayout, i: number, n: number, size: number): [number, number] => {
  if (layout === 'ring') {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    return [Math.cos(a) * size, Math.sin(a) * size]
  }
  if (layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(n * 1.25))
    const rows = Math.ceil(n / cols)
    const gap = (size * 2) / Math.max(cols - 1, 1)
    return [((i % cols) - (cols - 1) / 2) * gap, (Math.floor(i / cols) - (rows - 1) / 2) * gap]
  }
  const r = size * Math.sqrt((i + 0.5) / n)
  const a = i * 2.39996323
  return [Math.cos(a) * r, Math.sin(a) * r]
}

/** A class of kids as dots: ring, grid or phyllotaxis; dots pop in and light up as kids get feedback. */
export function ClassDots({ n, cx, cy, size, layout, to, morph = 0, dot, color, litColor, appearAt, litAt, spin = 0, ringLine }: ClassDotsProps) {
  const f = useCurrentFrame()
  const rot = f * spin
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      {ringLine ? <circle cx={cx} cy={cy} r={size} fill="none" stroke={ringLine} strokeWidth={1.5} opacity={lin(f, [0, 10], [0, 1])} /> : null}
      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        {Array.from({ length: n }).map((_, i) => {
          const [ax, ay] = place(layout, i, n, size)
          const [bx, by] = to ? place(to, i, n, size) : [ax, ay]
          const x = ax + (bx - ax) * morph
          const y = ay + (by - ay) * morph
          const s = appearAt ? pop(f, appearAt(i), 260, 12, 0.5) : 1
          const la = litAt?.(i)
          const lit = la === undefined ? 0 : pop(f, la, 200, 10, 0.5)
          const r = dot * s * (1 + lit * 0.35)
          return (
            <g key={i}>
              {lit > 0.01 ? <circle cx={cx + x} cy={cy + y} r={r * 2.6} fill={litColor} opacity={0.18 * lit} /> : null}
              <circle cx={cx + x} cy={cy + y} r={Math.max(0, r)} fill={lit > 0.5 ? litColor : color} />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
