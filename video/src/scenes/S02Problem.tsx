import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from 'remotion'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag } from '../components/Type'
import { C, FONT } from '../theme'

const KIDS = 20
const COLS = 5
const DOT = 76
const GAP = 42
const TICK_START = 12
const TICK_END = 150
/** The two corrections that survive "by dinner". */
const REMEMBERED = new Set([6, 13])
/** When each kid got a correction during class (frame), or null. Deterministic per index. */
const corrected = Array.from({ length: KIDS }, (_, i) => (random(`kid${i}`) < 0.62 || REMEMBERED.has(i) ? TICK_START + 8 + Math.floor(random(`t${i}`) * 118) : null))
const LINE_AT = 156
export const PROBLEM_CUES = { tick: corrected.filter((c): c is number => c !== null).slice(0, 6), whoosh: [LINE_AT - 6] }

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export const S02Problem: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const secs = lin(frame, [TICK_START, TICK_END], [45 * 60, 0])
  const dinner = ease(frame, [TICK_END, TICK_END + 20], [0, 1])
  const line = enterAt(frame, fps, LINE_AT)
  return (
    <SceneShell>
      <Atmos x="70%" y="45%" strength={0.03} />
      <MonoTag style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, 4) }}>
        The moment: mid-class, hands on pads
      </MonoTag>
      {/* Class clock */}
      <div style={{ position: 'absolute', left: 96, top: 250, opacity: enterAt(frame, fps, 6) }}>
        <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted }}>CLASS TIME</div>
        <div style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 200, letterSpacing: '-0.012em', color: C.white, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
          {mmss(secs)}
        </div>
        <div style={{ width: 560, height: 3, background: C.hair, marginTop: 24, borderRadius: 2 }}>
          <div style={{ width: `${(1 - secs / 2700) * 100}%`, height: '100%', background: C.white, borderRadius: 2 }} />
        </div>
      </div>
      {/* 20 kids: corrections flash, then fade from memory; two remain */}
      <div style={{ position: 'absolute', left: 1010, top: 210, display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${DOT}px)`, gap: GAP }}>
        {Array.from({ length: KIDS }, (_, i) => {
          const at = corrected[i] ?? null
          const appear = enterAt(frame, fps, 6 + i * 1.5)
          const flash = at === null ? 0 : REMEMBERED.has(i) ? lin(frame, [at, at + 3, at + 26, TICK_END, TICK_END + 16], [0, 1, 0.55, 0.55, 1]) : lin(frame, [at, at + 3, at + 26], [0, 1, 0.55])
          const kept = REMEMBERED.has(i) ? 1 : 1 - dinner
          const lit = flash * kept
          return (
            <div key={i} style={{ width: DOT, height: DOT, borderRadius: '50%', position: 'relative', opacity: appear, scale: String(0.6 + 0.4 * appear) }}>
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid rgba(236,239,234,0.22)` }} />
              <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: C.white, opacity: lit, boxShadow: `0 0 ${30 * lit}px rgba(236,239,234,${0.5 * lit})` }} />
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 1010, top: 210 + 4 * DOT + 3 * GAP + 36, fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted, opacity: enterAt(frame, fps, 20) }}>
        20 KIDS · {frame < TICK_END ? 'CORRECTED IN CLASS' : 'REMEMBERED BY DINNER'}
      </div>
      <AbsoluteFill style={{ justifyContent: 'flex-end', padding: '0 96px 120px' }}>
        <div style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 84, letterSpacing: '-0.005em', color: C.white, opacity: line, translate: `0 ${(1 - line) * 30}px` }}>
          By dinner, I remember <span style={{ color: C.white, textDecoration: 'underline', textDecorationThickness: 4, textUnderlineOffset: 14 }}>two.</span>
        </div>
      </AbsoluteFill>
    </SceneShell>
  )
}
