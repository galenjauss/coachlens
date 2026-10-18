import type React from 'react'
import { useCurrentFrame } from 'remotion'
import { FONT } from '../theme'

export const AGENT_ACTIONS = ['FEEDBACK', 'ATTENDANCE', 'PARENT EMAILS', 'REPORT CARDS', 'LESSON PLANS', 'INSIGHTS', 'PRs', 'QUESTIONS'] as const

interface RowProps {
  words: readonly string[]
  size: number
  color: string
  dot: string
  /** px per frame; negative = leftward. */
  speed: number
  outline?: boolean
  offset?: number
  style?: React.CSSProperties
  tracking?: string
}

/** One straight marquee row of words with dot separators. */
export function MarqueeRow({ words, size, color, dot, speed, outline = false, offset = 0, style, tracking = '0.12em' }: RowProps) {
  const f = useCurrentFrame()
  const unit = [...words, ...words, ...words, ...words]
  const approxW = words.join('   ').length * size * 0.72 + words.length * size
  const x = (((offset + f * speed) % approxW) + approxW) % approxW
  return (
    <div style={{ whiteSpace: 'nowrap', overflow: 'visible', ...style }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', transform: `translateX(${-x}px)`, fontFamily: FONT.head, fontWeight: 800, fontSize: size, letterSpacing: tracking, lineHeight: 1 }}>
        {unit.map((w, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span style={outline ? { color: 'transparent', WebkitTextStroke: `${Math.max(1.5, size / 40)}px ${color}` } : { color }}>{w}</span>
            <span style={{ width: size * 0.22, height: size * 0.22, borderRadius: size, background: dot, margin: `0 ${size * 0.5}px` }} />
          </span>
        ))}
      </div>
    </div>
  )
}

interface CurvedProps {
  text: string
  radius: number
  cx: number
  cy: number
  size: number
  color: string
  dotColor: string
  /** Degrees per frame the text travels along the arc. */
  speed: number
  width?: number
  height?: number
}

/** Text on a circular path that keeps travelling (the reel's curved marquee). */
export function CurvedMarquee({ text, radius, cx, cy, size, color, dotColor, speed, width = 1920, height = 1080 }: CurvedProps) {
  const f = useCurrentFrame()
  const id = `arc${Math.round(radius)}${Math.round(cx)}`
  const d = `M ${cx - radius} ${cy} a ${radius} ${radius} 0 1 1 ${radius * 2} 0 a ${radius} ${radius} 0 1 1 ${-radius * 2} 0`
  const circ = 2 * Math.PI * radius
  const parts = text.split('•').map(s => s.trim()).filter(Boolean)
  const reps = Math.max(2, Math.ceil(circ / (text.length * size * 0.75)))
  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
      <defs>
        <path id={id} d={d} />
      </defs>
      <g transform={`rotate(${f * speed} ${cx} ${cy})`}>
        <text style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: size, letterSpacing: '0.18em' }} fill={color}>
          <textPath href={`#${id}`} startOffset="0">
            {Array.from({ length: reps }).flatMap((_, r) =>
              parts.map((p, i) => (
                <tspan key={`${r}-${i}`}>
                  {p}
                  <tspan fill={dotColor}>{'  •  '}</tspan>
                </tspan>
              )),
            )}
          </textPath>
        </text>
      </g>
    </svg>
  )
}
