import { useCurrentFrame, useVideoConfig } from 'remotion'
import { TapRipple } from '../components/Gesture'
import { lensFrameSize, lensPoint } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin, typed } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag, Typed } from '../components/Type'
import { answerSpec, peekSpec, recordingSpec, sendingSpec, type PageSpec } from '../lens/appLens'
import { C, FONT } from '../theme'

const SCALE = 1.7
const TOP = 150
const ASK = 'Who is forgetting to keep their guard up?'
const B = { tap: 30, rec: 34, say: 40, stop: 96, send: 100, answer: 122 } as const
const NAMES = ['Priya (3)', 'Sam (3)', 'Ava (1)', 'Ben (1)']
const NAME_AT = NAMES.map((_, i) => B.answer + 26 + i * 16)
const NOTE_AT = NAME_AT[3]! + 26
export const ASK_CUES = { tap: [B.tap, B.stop], shimmer: [B.answer], tick: NAME_AT, whoosh: [] as number[] }

function specAt(f: number): PageSpec {
  if (f < B.rec) return peekSpec(f * 33)
  if (f < B.send) return recordingSpec(Math.floor((f - B.rec) / 15))
  if (f < B.answer) return sendingSpec(f < B.send + 6 ? 'heard' : 'sending', Math.floor((f - B.send) / 5))
  return answerSpec()
}

export const S07Ask: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w, h } = lensFrameSize(SCALE)
  const left = (1920 - w) / 2
  const pad = lensPoint(SCALE, 576, 150)
  const chars = typed(frame, fps, B.say)
  return (
    <SceneShell>
      <Atmos y="40%" tint="61,255,122" strength={0.025} />
      <MonoTag num="03" style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, 4) }}>Ask anything</MonoTag>
      <LensStage
        top={TOP} scale={SCALE} spec={specAt(frame)} power={lin(frame, [0, 10], [0, 1]) * (frame === B.answer ? 0.7 : 1)}
        marks={NAMES.map((t, i) => ({ text: t, progress: ease(frame, [NAME_AT[i]!, NAME_AT[i]! + 10], [0, 1]) }))}
      />
      <div style={{ position: 'absolute', left, top: TOP }}>
        <TapRipple at={B.tap} x={pad.x + 70} y={pad.y} label="TAP · ASK" hold={30} />
        <TapRipple at={B.stop} x={pad.x + 70} y={pad.y} label="TAP · DONE" hold={20} />
      </div>
      <div style={{ position: 'absolute', left: left + 8, top: TOP + h + 34, width: w, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 52, letterSpacing: '0', color: C.white, opacity: enterAt(frame, fps, B.say - 4) }}>
          “<Typed text={ASK} chars={chars} />{chars >= ASK.length ? '”' : ''}
        </div>
      </div>
      <div style={{ position: 'absolute', left: left + 8, top: TOP + h + 112, fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted, opacity: enterAt(frame, fps, NOTE_AT) }}>
        <span style={{ color: C.green }}>●</span>  INSTANT · GROUNDED IN YOUR NOTES
      </div>
    </SceneShell>
  )
}
