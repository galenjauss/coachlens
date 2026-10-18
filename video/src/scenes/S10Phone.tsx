import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import { FootageSlot } from '../components/FootageSlot'
import { ease, enterAt } from '../components/motion'
import { PhoneFrame } from '../components/PhoneFrame'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag } from '../components/Type'
import { C, FONT } from '../theme'
import { AgentsIdeasScreen, AutonomyScreen, ReviewScreen } from './phoneScreens'

const STEPS = [
  { at: 0, label: 'Review', text: 'Dee’s email, drafted. Sent when you say.' },
  { at: 140, label: 'From your agents', text: 'Gus is ready to test. One tap.' },
  { at: 280, label: 'Autonomy', text: 'Auto · Review · Off, per agent.' },
] as const
const SEND_AT = 84
const DO_AT = 70
const PICK_AT = 60
export const PHONE_CUES = { tap: [SEND_AT, STEPS[1].at + DO_AT, STEPS[2].at + PICK_AT], whoosh: [STEPS[1].at, STEPS[2].at], tick: [] as number[], shimmer: [] as number[] }

const PhoneFallback: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = enterAt(frame, fps, 0)
  return (
    <>
      <PhoneFrame style={{ position: 'absolute', left: 300, top: 100, translate: `0 ${(1 - p) * 60}px`, opacity: p }}>
        {STEPS.map((s, i) => {
          const next = STEPS[i + 1]
          const inX = i === 0 ? 0 : (1 - ease(frame, [s.at, s.at + 16], [0, 1])) * 430
          const outX = next ? -ease(frame, [next.at, next.at + 16], [0, 1]) * 430 : 0
          if (frame < s.at - 1 || (next && frame > next.at + 17)) return null
          return (
            <AbsoluteFill key={s.label} style={{ translate: `${inX + outX}px 0` }}>
              <Sequence from={s.at} layout="none">
                {i === 0 ? <ReviewScreen sendAt={SEND_AT} /> : i === 1 ? <AgentsIdeasScreen doAt={DO_AT} /> : <AutonomyScreen pickAt={PICK_AT} />}
              </Sequence>
            </AbsoluteFill>
          )
        })}
      </PhoneFrame>
    </>
  )
}

export const S10Phone: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <SceneShell>
      <Atmos x="28%" y="50%" strength={0.04} />
      <AbsoluteFill>
        <FootageSlot id="C" label="Phone · agents at work" fallback={<PhoneFallback />} />
      </AbsoluteFill>
      <MonoTag num="05" style={{ position: 'absolute', left: 960, top: 150, opacity: enterAt(frame, fps, 6) }}>After class, on your phone</MonoTag>
      <div style={{ position: 'absolute', left: 960, top: 250, width: 864, display: 'flex', flexDirection: 'column', gap: 34 }}>
        {STEPS.map((s, i) => {
          const next = STEPS[i + 1]
          const active = frame >= s.at && (!next || frame < next.at)
          const shown = enterAt(frame, fps, s.at + 4)
          return (
            <div key={s.label} style={{ display: 'flex', gap: 26, opacity: shown * (active ? 1 : 0.55), translate: `${(1 - shown) * 30}px 0` }}>
              <div style={{ width: 4, borderRadius: 2, background: active ? C.white : C.hair }} />
              <div>
                <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', textTransform: 'uppercase', color: C.muted }}>{s.label}</div>
                <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 44, letterSpacing: '-0.005em', color: C.white, marginTop: 6 }}>{s.text}</div>
              </div>
            </div>
          )
        })}
      </div>
      <div style={{ position: 'absolute', left: 960, bottom: 120, width: 864, fontFamily: FONT.head, fontWeight: 800, fontSize: 68, letterSpacing: '-0.005em', lineHeight: 1.05, color: C.white, opacity: enterAt(frame, fps, 300) }}>
        You choose how much they do on their own.
      </div>
    </SceneShell>
  )
}
