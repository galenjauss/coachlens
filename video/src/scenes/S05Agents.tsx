import { useCurrentFrame, useVideoConfig } from 'remotion'
import { Chip } from '../components/Chip'
import { Connector } from '../components/Connector'
import { TapRipple } from '../components/Gesture'
import { lensFrameSize, lensPoint } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin, typed } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag, Typed } from '../components/Type'
import { VoiceBars } from '../components/VoiceBars'
import { DEE_SAID, deeCardSpec, peekSpec, priyaCardSpec, recordingSpec, sendingSpec, type PageSpec } from '../lens/appLens'
import { C, FONT } from '../theme'

const SCALE = 1.35
const LEFT = 96
const TOP = 200
const PRIYA_SAID = 'Priya keeps dropping her guard on the jab.'
const DEE_LINE = `${DEE_SAID}.`

/** Beat sheet (frames from scene start). */
const B = {
  tap1: 34, rec1: 38, say1: 44, stop1: 100, send1: 104, card1: 128, fan: 140,
  out: 318, tap2: 338, rec2: 342, say2: 348, stop2: 410, send2: 414, card2: 438, fan2: 452, done2: 505,
} as const
export const AGENTS_CUES = { tap: [B.tap1, B.stop1, B.tap2, B.stop2], shimmer: [B.card1, B.card2], tick: [0, 1, 2, 3].map(i => B.fan + 14 + i * 5).concat([B.fan2 + 14, B.done2]), whoosh: [B.out] }

const OUTCOMES = [
  { kicker: 'Progress', text: '3rd time → recurring' },
  { kicker: 'Report card', text: 'added' },
  { kicker: 'Next class', text: 'guard drill' },
  { kicker: 'Coverage', text: '7/12' },
]
const CHIP_X = 1130
const CHIP_Y = [226, 358, 490, 622]

function specAt(f: number): PageSpec {
  if (f < B.rec1) return peekSpec(f * 33)
  if (f < B.send1) return recordingSpec(Math.floor((f - B.rec1) / 15))
  if (f < B.card1) return sendingSpec(f < B.send1 + 6 ? 'heard' : f < B.send1 + 14 ? 'sending' : 'thinking', Math.floor((f - B.send1) / 5))
  if (f < B.out + 14) return priyaCardSpec()
  if (f < B.rec2) return peekSpec(f * 33)
  if (f < B.send2) return recordingSpec(Math.floor((f - B.rec2) / 15))
  if (f < B.card2) return sendingSpec(f < B.send2 + 6 ? 'heard' : f < B.send2 + 14 ? 'sending' : 'thinking', Math.floor((f - B.send2) / 5))
  return deeCardSpec(f >= B.done2)
}

export const S05Agents: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w, h } = lensFrameSize(SCALE)
  const anchor = lensPoint(SCALE, 576, 126)
  const ax = LEFT + anchor.x - 6
  const ay = TOP + anchor.y
  const pad = lensPoint(SCALE, 576, 150)
  const first = 1 - ease(frame, [B.out, B.out + 14], [0, 1])
  const second = frame >= B.tap2
  const quote = second ? DEE_LINE : PRIYA_SAID
  const sayAt = second ? B.say2 : B.say1
  const chars = typed(frame, fps, sayAt)
  const quoteIn = second ? enterAt(frame, fps, B.say2 - 4) : enterAt(frame, fps, B.say1 - 4) * first
  const swapDip = frame === B.card1 || frame === B.card2 ? 0.7 : 1
  return (
    <SceneShell>
      <Atmos x="30%" y="40%" tint="61,255,122" strength={0.025} />
      <MonoTag num="02" style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, 4) }}>One sentence in, outcomes out</MonoTag>
      <LensStage left={LEFT} top={TOP} scale={SCALE} spec={specAt(frame)} power={lin(frame, [0, 10], [0, 1]) * swapDip} />
      <div style={{ position: 'absolute', left: LEFT, top: TOP }}>
        <TapRipple at={B.tap1} x={pad.x + 60} y={pad.y} label="TAP · TALK" hold={16} />
        <TapRipple at={B.stop1} x={pad.x + 60} y={pad.y} label="TAP · DONE" hold={20} />
        <TapRipple at={B.tap2} x={pad.x + 60} y={pad.y} label="TAP · TALK" hold={16} />
        <TapRipple at={B.stop2} x={pad.x + 60} y={pad.y} label="TAP · DONE" hold={20} />
      </div>
      {/* What the coach said, typed at speaking pace under the lens */}
      <div style={{ position: 'absolute', left: LEFT + 8, top: TOP + h + 34, width: w - 16, opacity: quoteIn }}>
        <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted, marginBottom: 10 }}>COACH, MID-DRILL</div>
        <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 52, letterSpacing: '-0.025em', lineHeight: 1.12, color: C.white }}>
          “<Typed text={quote} chars={chars} />{chars >= quote.length ? '”' : ''}
        </div>
      </div>
      <VoiceBars from={B.say1 + 20} to={B.stop1} style={{ position: 'absolute', left: CHIP_X + 40, top: 330 }} />
      <VoiceBars from={B.say2 + 20} to={B.stop2} style={{ position: 'absolute', left: CHIP_X + 40, top: 330 }} />
      {/* Fan-out: the card's sentence becomes outcomes */}
      {OUTCOMES.map((o, i) => {
        const start = B.fan + i * 5
        const p = ease(frame, [start, start + 16], [0, 1])
        const chip = enterAt(frame, fps, start + 12)
        const cy = CHIP_Y[i]!
        return (
          <div key={o.kicker} style={{ opacity: first }}>
            <Connector x1={ax} y1={ay} x2={CHIP_X - 4} y2={cy} progress={p} opacity={0.9} />
            <Chip kicker={o.kicker} style={{ position: 'absolute', left: CHIP_X, top: cy - 56, width: 560, opacity: chip, translate: `${(1 - chip) * 30}px 0` }}>{o.text}</Chip>
          </div>
        )
      })}
      {second ? (
        <>
          <Connector x1={ax} y1={ay} x2={CHIP_X - 4} y2={448} progress={ease(frame, [B.fan2, B.fan2 + 16], [0, 1])} color={C.amber} />
          <Chip
            kicker="Parent email" glyph="!" tone="amber"
            style={{ position: 'absolute', left: CHIP_X, top: 448 - 56, width: 560, opacity: enterAt(frame, fps, B.fan2 + 12), translate: `${(1 - enterAt(frame, fps, B.fan2 + 12)) * 30}px 0` }}
          >
            draft for your review
          </Chip>
          <div style={{ position: 'absolute', left: CHIP_X + 4, top: 448 + 80, fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.16em', color: C.muted, opacity: enterAt(frame, fps, B.done2) }}>
            WAITS IN REVIEW FOR YOUR OK
          </div>
        </>
      ) : null}
    </SceneShell>
  )
}
