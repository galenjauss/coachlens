import { random, useCurrentFrame } from 'remotion'
import { C, FONT } from '../theme'
import { lin } from './motion'

/** A quiet voice meter (what the G2 mic is hearing) while the coach speaks: off-white, never green. */
export const VoiceBars: React.FC<{ from: number; to: number; style?: React.CSSProperties }> = ({ from, to, style }) => {
  const frame = useCurrentFrame()
  const o = lin(frame, [from, from + 8, to, to + 8], [0, 1, 1, 0])
  if (o <= 0) return null
  const bars = 28
  return (
    <div style={{ opacity: o, ...style }}>
      <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted, marginBottom: 26 }}>G2 MIC · LISTENING</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, height: 120 }}>
        {Array.from({ length: bars }, (_, i) => {
          const speaking = frame < to - 4
          const n = random(`v${i}-${Math.floor(frame / 2)}`)
          const env = Math.sin((i / (bars - 1)) * Math.PI)
          const h = speaking ? 10 + 100 * env * (0.25 + 0.75 * n) : 8
          return <div key={i} style={{ width: 8, height: h, borderRadius: 4, background: C.white, opacity: 0.35 + 0.5 * env }} />
        })}
      </div>
    </div>
  )
}
