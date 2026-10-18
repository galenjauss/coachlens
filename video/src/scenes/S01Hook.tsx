import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { LensFrame, lensFrameSize } from '../components/LensFrame'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { C, FONT } from '../theme'

const LINES = [
  { text: '20 kids.', at: 4 },
  { text: '45 minutes.', at: 44 },
  { text: 'Hands full?', at: 84 },
]
const CLEAR = 126
const PUNCH = 140
export const HOOK_CUES = { whoosh: [CLEAR], tick: LINES.map(l => l.at), shimmer: [PUNCH - 4] }

export const S01Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const clear = ease(frame, [CLEAR, CLEAR + 10], [0, 1])
  const punch = enterAt(frame, fps, PUNCH)
  const scale = 1.8
  const { w, h } = lensFrameSize(scale)
  return (
    <SceneShell fadeIn={0}>
      <Atmos y="50%" strength={0.03} />
      <AbsoluteFill style={{ justifyContent: 'center', paddingLeft: 210, opacity: 1 - clear, translate: `0 ${-40 * clear}px` }}>
        {LINES.map((l, i) => {
          const p = enterAt(frame, fps, l.at)
          const next = LINES[i + 1]
          const dim = next ? ease(frame, [next.at, next.at + 10], [1, 0.22]) : 1
          return (
            <div
              key={l.text}
              style={{
                fontFamily: FONT.head, fontWeight: 800, fontSize: 168, letterSpacing: '-0.012em', lineHeight: 1.04, color: C.white,
                opacity: p * dim, translate: `0 ${(1 - p) * 50}px`, filter: `blur(${(1 - p) * 8}px)`,
              }}
            >
              {l.text}
            </div>
          )
        })}
      </AbsoluteFill>
      {/* Beat. Then the answer, with the lens rim waking up behind it. */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <LensFrame
          scale={scale}
          rim={lin(frame, [PUNCH + 6, PUNCH + 40], [0, 1])}
          bloom={lin(frame, [PUNCH + 10, PUNCH + 40, 210], [0, 0.5, 0.35])}
          style={{ position: 'absolute', left: (1920 - w) / 2, top: (1080 - h) / 2, opacity: lin(frame, [PUNCH, PUNCH + 30], [0, 1]), scale: String(0.94 + 0.06 * punch) }}
        />
        <div
          style={{
            position: 'relative', fontFamily: FONT.head, fontWeight: 800, fontSize: 188, letterSpacing: '-0.012em', color: C.white,
            opacity: punch, scale: String(1.08 - 0.08 * punch), filter: `blur(${(1 - punch) * 10}px)`,
          }}
        >
          No problem.
        </div>
      </AbsoluteFill>
    </SceneShell>
  )
}
