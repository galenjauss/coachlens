import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { FootageSlot } from '../components/FootageSlot'
import { TapRipple } from '../components/Gesture'
import { lensFrameSize, lensPoint } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { Caption, MonoTag } from '../components/Type'
import { lobbySpec, planApplyingSpec, planningSpec, planResultSpec, type PageSpec } from '../lens/appLens'
import { C } from '../theme'

const SCALE = 1.7
const TOP = 150
const DOUBLE_TAP = 66
const PLAN_AT = 80
const HEARD = "okay so let's cut kata 2, a shorter warm-up, and add partner sparring"
const WORD_AT = 104
const WORDS_PER_SEC = 2.4
const APPLY_TAP = 268
const TRANSCRIBE_AT = 274
const APPLY_AT = 290
const RESULT_AT = 312
const DIFF = [RESULT_AT + 14, RESULT_AT + 30, RESULT_AT + 46]
export const PLAN_CUES = { tap: [DOUBLE_TAP, DOUBLE_TAP + 7, APPLY_TAP], shimmer: [4, RESULT_AT], tick: DIFF, whoosh: [] as number[] }

function specAt(frame: number, fps: number): PageSpec {
  if (frame < PLAN_AT) return lobbySpec()
  if (frame < TRANSCRIBE_AT) {
    const words = HEARD.split(' ')
    const n = Math.max(0, Math.min(words.length, Math.floor(((frame - WORD_AT) / fps) * WORDS_PER_SEC)))
    return planningSpec(11 + Math.floor((frame - PLAN_AT) / fps), words.slice(0, n).join(' '))
  }
  if (frame < APPLY_AT) return planApplyingSpec('transcribing')
  if (frame < RESULT_AT) return planApplyingSpec('applying')
  return planResultSpec()
}

const Fallback: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w, h } = lensFrameSize(SCALE)
  const lensLeft = (1920 - w) / 2
  const power = lin(frame, [2, 14], [0, 1])
  const swap = frame === PLAN_AT || frame === RESULT_AT ? 0.75 : 1
  const pad = lensPoint(SCALE, 576, 150)
  return (
    <>
      <LensStage
        top={TOP}
        scale={SCALE}
        spec={specAt(frame, fps)}
        power={power * swap}
        zoom={1 + 0.015 * ease(frame, [RESULT_AT, RESULT_AT + 40], [0, 1])}
        lineFx={(id, line) => {
          if (frame < RESULT_AT || id !== 2) return undefined
          const at = DIFF[line]
          if (at === undefined) return undefined
          const shown = ease(frame, [at - 6, at + 4], [0, 1])
          if (line === 1) return { opacity: shown, strike: ease(frame, [at + 4, at + 16], [0, 1]) }
          return { opacity: shown, flash: lin(frame, [at, at + 4, at + 30], [0, 1, 0]) }
        }}
      />
      <div style={{ position: 'absolute', left: lensLeft, top: TOP }}>
        <TapRipple at={DOUBLE_TAP} x={pad.x + 70} y={pad.y} label="2× TAP · PLAN" double />
        <TapRipple at={APPLY_TAP} x={pad.x + 70} y={pad.y} label="TAP · APPLY" />
      </div>
      <div style={{ position: 'absolute', left: lensLeft, top: TOP + h + 40, width: w }}>
        <Caption style={{ opacity: enterAt(frame, fps, 18) }}>
          Talk the plan through with your assistant.{' '}
          <span style={{ color: frame > RESULT_AT ? C.white : C.muted, opacity: frame > RESULT_AT ? 1 : 0.0 + ease(frame, [RESULT_AT - 20, RESULT_AT], [0, 1]) }}>It reshapes itself.</span>
        </Caption>
      </div>
    </>
  )
}

export const S04Plan: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <SceneShell>
      <Atmos y="40%" tint="61,255,122" strength={0.025} />
      <AbsoluteFill>
        <FootageSlot id="A" label="Real G2 · lobby → planning" fallback={<Fallback />} />
      </AbsoluteFill>
      <MonoTag num="01" style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, 4) }}>Plan out loud</MonoTag>
    </SceneShell>
  )
}
