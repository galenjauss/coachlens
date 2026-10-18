import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { LensFrame, lensFrameSize } from '../components/LensFrame'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { Footnote } from '../components/Type'
import { APPS_CHECKED, APPS_FOR_COACHES, ORIGINALITY_FOOTNOTE } from '../config'
import { C, FONT } from '../theme'

const COUNT = [6, 58] as const
const CUT = 120
const ZERO_AT = 146
const NOW_AT = 252
export const ORIGINALITY_CUES = { tick: [COUNT[1]], thump: [ZERO_AT], whoosh: [CUT], shimmer: [NOW_AT + 6] }

export const S11Originality: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const n = Math.round(ease(frame, [COUNT[0], COUNT[1]], [0, APPS_CHECKED]))
  const plus = enterAt(frame, fps, COUNT[1])
  const zero = enterAt(frame, fps, ZERO_AT)
  const shake = frame >= ZERO_AT && frame < ZERO_AT + 10 ? Math.sin((frame - ZERO_AT) * 2.6) * (10 - (frame - ZERO_AT)) * 1.6 : 0
  const scale = 1.5
  const { w, h } = lensFrameSize(scale)
  const pulse = lin(frame, [NOW_AT + 6, NOW_AT + 16, NOW_AT + 50], [0, 1, 0])
  return (
    <SceneShell>
      <Atmos y="48%" strength={0.035} />
      {frame < CUT ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: 340, letterSpacing: '-0.06em', color: C.white, fontVariantNumeric: 'tabular-nums', lineHeight: 0.9, translate: '0 -30px' }}>
            {n}<span style={{ opacity: plus, display: 'inline-block', translate: `${(1 - plus) * -20}px 0` }}>+</span>
          </div>
          <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 60, letterSpacing: '-0.02em', color: C.muted, marginTop: 10, opacity: enterAt(frame, fps, 14) }}>G2 apps we checked.</div>
        </AbsoluteFill>
      ) : frame < NOW_AT ? (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', translate: `${shake}px 0` }}>
          <div style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 72, letterSpacing: '-0.03em', color: C.white, opacity: enterAt(frame, fps, CUT + 2), translate: '0 -40px' }}>
            Built for coaches &amp; teachers:
          </div>
          <div
            style={{
              fontFamily: FONT.head, fontWeight: 800, fontSize: 420, letterSpacing: '-0.06em', color: C.white, lineHeight: 0.85,
              opacity: Math.min(1, zero * 2), scale: String(1.6 - 0.6 * zero), filter: `blur(${(1 - zero) * 12}px)`,
            }}
          >
            {APPS_FOR_COACHES}
          </div>
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
          <LensFrame scale={scale} rim={1} bloom={pulse} style={{ position: 'absolute', left: (1920 - w) / 2, top: (1080 - h) / 2, scale: String(1 + 0.03 * pulse), opacity: enterAt(frame, fps, NOW_AT) }} />
          <div style={{ position: 'relative', fontFamily: FONT.head, fontWeight: 800, fontSize: 200, letterSpacing: '-0.05em', color: C.white, opacity: enterAt(frame, fps, NOW_AT + 2), filter: `blur(${(1 - enterAt(frame, fps, NOW_AT + 2)) * 8}px)` }}>
            Until now.
          </div>
        </AbsoluteFill>
      )}
      <Footnote style={{ position: 'absolute', left: 96, bottom: 96, opacity: lin(frame, [10, 24, NOW_AT - 6, NOW_AT], [0, 1, 1, 0]) }}>
        {ORIGINALITY_FOOTNOTE}
      </Footnote>
    </SceneShell>
  )
}
