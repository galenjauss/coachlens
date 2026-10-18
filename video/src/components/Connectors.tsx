import { useCurrentFrame } from 'remotion'
import { ease, EASE } from '../lib/anim'

interface ConnectorsProps {
  from: [number, number]
  to: readonly [number, number][]
  /** Local frame each line starts drawing. */
  at: (i: number) => number
  dur?: number
  color: string
  width?: number
}

/** Agent connectors: curves that shoot from a card to each outcome, with a travelling head dot. */
export function Connectors({ from, to, at, dur = 9, color, width = 3 }: ConnectorsProps) {
  const f = useCurrentFrame()
  const [x0, y0] = from
  return (
    <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      {to.map(([x1, y1], i) => {
        const p = ease(f, [at(i), at(i) + dur], [0, 1], EASE.outCubic)
        if (p <= 0) return null
        const mx = x0 + (x1 - x0) * 0.5
        const d = `M ${x0} ${y0} C ${mx} ${y0}, ${mx} ${y1}, ${x1} ${y1}`
        const bx = (t: number) => (1 - t) ** 3 * x0 + 3 * (1 - t) ** 2 * t * mx + 3 * (1 - t) * t * t * mx + t ** 3 * x1
        const by = (t: number) => (1 - t) ** 3 * y0 + 3 * (1 - t) ** 2 * t * y0 + 3 * (1 - t) * t * t * y1 + t ** 3 * y1
        return (
          <g key={i}>
            <path d={d} fill="none" stroke={color} strokeWidth={width} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} strokeLinecap="round" />
            <circle cx={bx(p)} cy={by(p)} r={width * 2.6} fill={color} />
          </g>
        )
      })}
      {f >= at(0) ? <circle cx={x0} cy={y0} r={width * 2.2} fill={color} /> : null}
    </svg>
  )
}
