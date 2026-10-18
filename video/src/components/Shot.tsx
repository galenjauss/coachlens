import type React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { EASE, lin } from '../lib/anim'
import { WHIP_LEN } from '../timeline'
import { DirBlur } from './DirBlur'

export type Move = 'cut' | 'whipL' | 'whipR' | 'whipU' | 'whipD' | 'zoom' | 'fade'
const H = WHIP_LEN / 2
const horizontal = (m: Move) => m === 'whipL' || m === 'whipR'
const vertical = (m: Move) => m === 'whipU' || m === 'whipD'
const W = 2100

const offset = (m: Move, q: number, sign: 1 | -1): React.CSSProperties => {
  switch (m) {
    case 'whipL': return { transform: `translateX(${sign * -W * q}px)` }
    case 'whipR': return { transform: `translateX(${sign * W * q}px)` }
    case 'whipU': return { transform: `translateY(${sign * -1200 * q}px)` }
    case 'whipD': return { transform: `translateY(${sign * 1200 * q}px)` }
    case 'zoom': return { transform: `scale(${sign === 1 ? 1 - 0.5 * q : 1 + 1.2 * q})`, opacity: 1 - q }
    case 'fade': return { opacity: 1 - q }
    default: return {}
  }
}

function Mover({ len, enter, exit, children }: { len: number; enter: Move; exit: Move; children: React.ReactNode }) {
  const t = useCurrentFrame()
  // Enter: q goes 1 → 0 across [-H, H); the content arrives from the opposite side of the motion.
  const qi = enter === 'cut' ? 0 : 1 - EASE.outCubic(lin(t, [-H, H], [0, 1]))
  const qo = exit === 'cut' ? 0 : EASE.inCubic(lin(t, [len - H, len + H], [0, 1]))
  const a = offset(enter, qi, -1)
  const b = offset(exit, qo, 1)
  const transform = [a.transform, b.transform].filter(Boolean).join(' ') || undefined
  const opacity = Number(a.opacity ?? 1) * Number(b.opacity ?? 1)
  // Directional blur from the whip's own velocity, so the camera-blur samples blend into a streak.
  const qiPrev = enter === 'cut' ? 0 : 1 - EASE.outCubic(lin(t - 1, [-H, H], [0, 1]))
  const qoPrev = exit === 'cut' ? 0 : EASE.inCubic(lin(t - 1, [len - H, len + H], [0, 1]))
  const speed = Math.abs(qi - qiPrev) * (horizontal(enter) ? W : 1200) + Math.abs(qo - qoPrev) * (horizontal(exit) ? W : 1200)
  const horiz = (qi > 0 ? horizontal(enter) : horizontal(exit))
  const vert = (qi > 0 ? vertical(enter) : vertical(exit))
  return (
    <AbsoluteFill style={{ transform, opacity }}>
      <DirBlur x={horiz ? speed * 0.12 : 0} y={vert ? speed * 0.12 : 0} style={{ position: 'absolute', inset: 0 }}>
        {children}
      </DirBlur>
    </AbsoluteFill>
  )
}

interface ShotProps {
  /** Global frame of the cut in, and of the cut out. */
  from: number
  to: number
  enter?: Move
  exit?: Move
  children: React.ReactNode
  name?: string
}

/**
 * A shot on the global timeline. Children see frame 0 at the cut-in. Whips overlap the neighbouring
 * shot by WHIP_LEN/2 frames on each side (the global camera motion blur covers those frames).
 */
export function Shot({ from, to, enter = 'cut', exit = 'cut', children, name }: ShotProps) {
  const pre = enter === 'cut' ? 0 : H
  const post = exit === 'cut' ? 0 : H
  return (
    <Sequence from={from - pre} durationInFrames={to - from + pre + post} name={name}>
      <Sequence from={-pre} layout="none">
        <Mover len={to - from} enter={enter} exit={exit}>
          {children}
        </Mover>
      </Sequence>
    </Sequence>
  )
}
