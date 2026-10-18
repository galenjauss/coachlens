import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { FootageSlot, footageFor } from '../components/FootageSlot'
import { lensFrameSize } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin, typed } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { Caption, MonoTag, Typed } from '../components/Type'
import { briefSpec, mariaCardSpec, recordingSpec } from '../lens/appLens'
import { C, FONT } from '../theme'

const SCALE = 1.6
const TOP = 170
const BEATS = [
  { at: 0, said: 'Maria hit 225 on deadlift.', where: 'PT · Mon 6:00', card: 34, spec: mariaCardSpec },
  { at: 148, said: 'How’s Priya doing?', where: 'Kids · Tue', card: 176, spec: briefSpec },
] as const
export const NOTES_CUES = { shimmer: BEATS.map(b => b.card), whoosh: [BEATS[1].at - 2], tick: [] as number[], tap: BEATS.map(b => b.at + 2) }

const Fallback: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const beat = frame >= BEATS[1].at ? BEATS[1] : BEATS[0]
  const local = frame - beat.at
  const { w, h } = lensFrameSize(SCALE)
  const left = (1920 - w) / 2
  const spec = frame < beat.card ? recordingSpec(Math.floor(local / 15)) : beat.spec()
  const cut = ease(local, [0, 8], [0, 1])
  return (
    <>
      <LensStage top={TOP} scale={SCALE} spec={spec} power={lin(local, [0, 6], [0.2, 1])} zoom={0.97 + 0.03 * cut} />
      <MonoTag style={{ position: 'absolute', left, top: TOP - 56, opacity: cut }}>{beat.where}</MonoTag>
      <div style={{ position: 'absolute', left: left + 8, top: TOP + h + 30, fontFamily: FONT.head, fontWeight: 600, fontSize: 52, letterSpacing: '-0.025em', color: C.white, opacity: cut }}>
        “<Typed text={beat.said} chars={typed(frame, fps, beat.at + 4)} />{typed(frame, fps, beat.at + 4) >= beat.said.length ? '”' : ''}
      </div>
    </>
  )
}

export const S06Notes: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const real = footageFor('B') !== null
  return (
    <SceneShell>
      <Atmos y="40%" tint="61,255,122" strength={0.025} />
      <AbsoluteFill>
        <FootageSlot id="B" label="Real G2 · in class" fallback={<Fallback />} />
      </AbsoluteFill>
      <Caption size={48} style={{ position: 'absolute', right: 96, bottom: 96, textAlign: 'right', opacity: enterAt(frame, fps, 60), color: C.white }}>
        {real ? 'Real G2. Real class.' : <>A PR in the gym.<br />A check-in on the mat.</>}
      </Caption>
    </SceneShell>
  )
}
