import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { LensIcon } from '../components/LensIcon'
import { ease, enterAt } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { STORE_LINE } from '../config'
import { C, FONT } from '../theme'

export const CLOSE_CUES = { shimmer: [2], tick: [] as number[], whoosh: [] as number[] }

export const S13Close: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const mark = enterAt(frame, fps, 0)
  const store = enterAt(frame, fps, 12)
  const tag = enterAt(frame, fps, 22)
  return (
    <SceneShell fadeIn={4} fadeOut={0}>
      <Atmos y="44%" strength={0.045} />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: mark, scale: String(0.96 + 0.04 * mark), translate: '0 -70px' }}>
          <LensIcon size={150} draw={ease(frame, [0, 20], [0.3, 1])} />
          <div style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: 140, letterSpacing: '-0.012em', color: C.white }}>CoachLens</div>
        </div>
        <div style={{ position: 'absolute', top: 640, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22 }}>
          <div style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 52, letterSpacing: '-0.005em', color: C.white, opacity: store, translate: `0 ${(1 - store) * 16}px`, display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ width: 14, height: 14, borderRadius: '50%', background: C.green, boxShadow: `0 0 14px ${C.green}` }} />
            {STORE_LINE}
          </div>
          <div style={{ fontFamily: FONT.head, fontWeight: 500, fontSize: 36, color: C.muted, opacity: tag }}>Teach the class. CoachLens runs the follow-up.</div>
        </div>
      </AbsoluteFill>
    </SceneShell>
  )
}
