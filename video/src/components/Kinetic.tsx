import type React from 'react'
import { useCurrentFrame } from 'remotion'
import { ease, EASE, lin, pop, rand } from '../lib/anim'
import { FONT } from '../theme'
import { type TypeLine, typedChars } from '../timeline'
import { DirBlur } from './DirBlur'

type Dir = 'left' | 'right' | 'up' | 'down'
const VEC: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }

interface WordProps {
  text: string
  /** Local frame the word starts landing. */
  at: number
  size: number
  color: string
  /** Direction it comes FROM. */
  from?: Dir
  mode?: 'slide' | 'letters' | 'slam'
  exitAt?: number
  exitTo?: Dir
  weight?: number
  tracking?: string
  style?: React.CSSProperties
  /** Letter stagger in frames for mode 'letters'. */
  stagger?: number
  distance?: number
  /** Land in ~5 frames (for one-beat shots). */
  snappy?: boolean
}

const wordStyle = (size: number, color: string, weight: number, tracking: string): React.CSSProperties => ({
  fontFamily: FONT.head,
  fontWeight: weight,
  fontSize: size,
  lineHeight: 0.92,
  letterSpacing: tracking,
  color,
  whiteSpace: 'pre',
})

/** Giant kinetic word: slides in with an overshooting spring and directional motion blur. */
export function Word({ text, at, size, color, from = 'right', mode = 'slide', exitAt, exitTo = 'left', weight = 800, tracking = '-0.035em', style, stagger = 1.6, distance = 900, snappy = false }: WordProps) {
  const f = useCurrentFrame()
  if (f < at - 1) return null
  const base = wordStyle(size, color, weight, tracking)
  const [vx, vy] = VEC[from]
  const [ex, ey] = VEC[exitTo]
  const exitP = (fr: number) => (exitAt === undefined ? 0 : ease(fr, [exitAt, exitAt + 7], [0, 1], EASE.inExpo))
  const exitOff = (fr: number) => exitP(fr) * 2200
  if (mode === 'letters') {
    const chars = [...text]
    const mid = pop(f, at + (chars.length * stagger) / 2)
    const midPrev = pop(f - 1, at + (chars.length * stagger) / 2)
    return (
      <div style={{ ...style, transform: `translate(${ex * exitOff(f)}px, ${ey * exitOff(f)}px)` }}>
        <DirBlur x={Math.abs(ex * (exitOff(f) - exitOff(f - 1))) * 0.35} y={Math.abs(mid - midPrev) * size * 0.5}>
          <div style={{ ...base, display: 'flex' }}>
            {chars.map((ch, i) => {
              const p = pop(f, at + i * stagger, 190, 14, 0.6)
              return (
                <span key={i} style={{ display: 'inline-block', overflow: 'hidden', paddingBottom: '0.08em', marginBottom: '-0.08em' }}>
                  <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 105 * (vy >= 0 ? 1 : -1)}%)` }}>{ch}</span>
                </span>
              )
            })}
          </div>
        </DirBlur>
      </div>
    )
  }
  if (mode === 'slam') {
    const s = (fr: number) => 1 + (1 - pop(fr, at, 220, 15, 0.8)) * 1.6
    const ds = Math.abs(s(f) - s(f - 1))
    const op = lin(f, [at, at + 3], [0, 1])
    return (
      <div style={{ ...style, opacity: op, transform: `translate(${ex * exitOff(f)}px, ${ey * exitOff(f)}px) scale(${s(f)})` }}>
        <DirBlur x={ds * 34 + Math.abs(ex * (exitOff(f) - exitOff(f - 1))) * 0.35} y={ds * 34}>
          <div style={base}>{text}</div>
        </DirBlur>
      </div>
    )
  }
  const pos = (fr: number) => (1 - (snappy ? pop(fr, at, 360, 21, 0.55) : pop(fr, at))) * distance
  const dx = vx * pos(f) + ex * exitOff(f)
  const dy = vy * pos(f) + ey * exitOff(f)
  const vxNow = vx * (pos(f) - pos(f - 1)) + ex * (exitOff(f) - exitOff(f - 1))
  const vyNow = vy * (pos(f) - pos(f - 1)) + ey * (exitOff(f) - exitOff(f - 1))
  return (
    <div style={{ ...style, transform: `translate(${dx}px, ${dy}px)` }}>
      <DirBlur x={vxNow * 0.45} y={vyNow * 0.45}>
        <div style={base}>{text}</div>
      </DirBlur>
    </div>
  )
}

interface SerifProps {
  text: string
  at: number
  size: number
  color: string
  style?: React.CSSProperties
  stagger?: number
}

/** The italic serif accent line: words rise out of a mask, one after another. */
export function Serif({ text, at, size, color, style, stagger = 3 }: SerifProps) {
  const f = useCurrentFrame()
  const words = text.split(' ')
  return (
    <div style={{ fontFamily: FONT.serif, fontStyle: 'italic', fontWeight: 400, fontSize: size, lineHeight: 1.08, color, letterSpacing: '-0.01em', display: 'flex', flexWrap: 'wrap', columnGap: '0.24em', ...style }}>
      {words.map((w, i) => {
        const p = ease(f, [at + i * stagger, at + i * stagger + 16], [0, 1])
        return (
          <span key={i} style={{ display: 'inline-block', overflow: 'hidden', padding: '0.06em 0.04em 0.14em', margin: '-0.06em -0.04em -0.14em' }}>
            <span style={{ display: 'inline-block', transform: `translateY(${(1 - p) * 110}%) rotate(${(1 - p) * 4}deg)`, opacity: lin(p, [0, 0.2], [0, 1]) }}>{w}</span>
          </span>
        )
      })}
    </div>
  )
}

interface TypeProps {
  line: TypeLine
  /** Global frame (typewriter lines are placed on the global timeline). */
  frame: number
  size: number
  color: string
  caret: string
  style?: React.CSSProperties
  font?: 'head' | 'mono'
}

/** Typewriter text; its keystrokes are sound cues in timeline.ts. */
export function Typewriter({ line, frame, size, color, caret, style, font = 'head' }: TypeProps) {
  const n = typedChars(line, frame)
  const done = n >= line.text.length
  const blink = done ? Math.floor(frame / 8) % 2 === 0 : true
  return (
    <div style={{ fontFamily: font === 'head' ? FONT.head : FONT.mono, fontWeight: font === 'head' ? 700 : 500, fontSize: size, lineHeight: 1.06, letterSpacing: font === 'head' ? '-0.03em' : '0', color, ...style }}>
      {line.text.slice(0, n)}
      <span style={{ display: 'inline-block', width: '0.07em', height: '0.92em', marginLeft: '0.05em', transform: 'translateY(0.13em)', background: caret, opacity: blink ? 1 : 0 }} />
    </div>
  )
}

interface GlitchProps {
  text: string
  at: number
  size: number
  color: string
  style?: React.CSSProperties
}

/** RGB-split, slice-jitter glitch text (for "Hands full?"). Calms down after ~0.6 s. */
export function Glitch({ text, at, size, color, style }: GlitchProps) {
  const f = useCurrentFrame()
  if (f < at) return null
  const t = f - at
  const amt = t < 18 ? 1 : t < 40 ? (rand(f) > 0.7 ? 0.6 : 0.08) : rand(f) > 0.9 ? 0.4 : 0
  const j = (k: number) => (rand(f * 3.1 + k) - 0.5) * 60 * amt
  const base = wordStyle(size, color, 800, '-0.045em')
  const slices = [0, 1, 2, 3]
  return (
    <div style={{ position: 'relative', ...style }}>
      <div style={{ ...base, position: 'absolute', inset: 0, color: '#FF2E4D', mixBlendMode: 'screen', transform: `translate(${j(1)}px, ${j(2) * 0.2}px)`, opacity: amt > 0.05 ? 0.9 : 0 }}>{text}</div>
      <div style={{ ...base, position: 'absolute', inset: 0, color: '#2B8CFF', mixBlendMode: 'screen', transform: `translate(${j(3)}px, ${j(4) * 0.2}px)`, opacity: amt > 0.05 ? 0.9 : 0 }}>{text}</div>
      {slices.map(i => (
        <div key={i} style={{ ...base, position: i === 0 ? 'relative' : 'absolute', inset: i === 0 ? undefined : 0, clipPath: `inset(${i * 25}% 0 ${100 - (i + 1) * 25}% 0)`, transform: `translateX(${rand(f + i * 7) > 0.6 ? j(i + 5) : 0}px)` }}>
          {text}
        </div>
      ))}
    </div>
  )
}
