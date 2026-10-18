import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { LensIcon } from '../components/LensIcon'
import { ease, enterAt, typed } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { C, FONT } from '../theme'

const WORD = 'CoachLens'
const TYPE_AT = 40
const SUB_AT = 78
export const MEET_CUES = { shimmer: [30], tick: [TYPE_AT], whoosh: [] as number[] }

export const S03Meet: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const draw = ease(frame, [4, 38], [0, 1])
  const dot = enterAt(frame, fps, 30)
  const lines = ease(frame, [34, 52], [0, 1])
  const chars = Math.min(WORD.length, typed(frame, fps, TYPE_AT, 22))
  const sub = enterAt(frame, fps, SUB_AT)
  const settle = ease(frame, [0, 210], [0, 1])
  return (
    <SceneShell>
      <Atmos y="46%" strength={0.04} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', scale: String(1.02 - 0.02 * settle) }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 44, translate: '0 -40px' }}>
          <LensIcon size={200} draw={draw} dot={dot} lines={lines} />
          <div style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: 168, letterSpacing: '-0.045em', color: C.white, minWidth: 820 }}>
            {WORD.slice(0, chars)}
            <span style={{ display: 'inline-block', width: 8, height: 130, marginLeft: 8, translate: '0 14px', background: C.green, opacity: chars < WORD.length || frame % 30 < 18 ? (frame > SUB_AT + 30 ? 0 : 1) : 0, boxShadow: `0 0 16px ${C.green}` }} />
          </div>
        </div>
        <div style={{ position: 'absolute', top: 640, fontFamily: FONT.head, fontWeight: 500, fontSize: 52, letterSpacing: '-0.02em', color: C.muted, opacity: sub, translate: `0 ${(1 - sub) * 24}px` }}>
          Hands-free AI agents for coaches, <span style={{ color: C.white }}>on Even G2.</span>
        </div>
      </AbsoluteFill>
    </SceneShell>
  )
}
