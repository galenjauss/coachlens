import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { lensFrameSize } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag } from '../components/Type'
import { bannerSpec, DARK_SPEC } from '../lens/appLens'
import { C, FONT } from '../theme'

const SCALE = 1.3
const BANNER_AT = 96
const MOVE_AT = 176
const CARDS_AT = 206
const LINE_AT = 286
const INSIGHTS = [
  { where: 'Kids · Tue', title: 'Gus', detail: 'ready to test · 120 days at rank', action: 'Plan test' },
  { where: 'Algebra · Wed', title: 'Noah', detail: 'grade 84% → 72%', action: 'Draft note' },
  { where: 'Kids · Tue', title: 'Eli', detail: 'no feedback in 3 classes', action: 'Put first' },
]
export const NOTICE_CUES = { shimmer: [BANNER_AT], tick: INSIGHTS.map((_, i) => CARDS_AT + 8 + i * 22), whoosh: [MOVE_AT] }

export const S08Notice: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w, h } = lensFrameSize(SCALE)
  const move = ease(frame, [MOVE_AT, MOVE_AT + 30], [0, 1])
  const left = (1920 - w) / 2 + (96 - (1920 - w) / 2) * move
  const top = 250 + (200 - 250) * move
  const zoom = 1.22 - 0.22 * move
  const lit = frame >= BANNER_AT
  const b = ease(frame, [BANNER_AT, BANNER_AT + 14], [0, 1])
  const quiet = 1 - ease(frame, [BANNER_AT - 6, BANNER_AT + 4], [0, 1])
  return (
    <SceneShell>
      <Atmos x={`${30 + 20 * (1 - move)}%`} y="42%" tint="61,255,122" strength={0.02 * b} />
      <LensStage
        left={left} top={top} zoom={zoom} scale={SCALE}
        spec={lit ? bannerSpec(frame * 33) : DARK_SPEC}
        power={lit ? lin(frame, [BANNER_AT, BANNER_AT + 6], [0, 1]) : 0}
        bloom={lin(frame, [BANNER_AT, BANNER_AT + 8, BANNER_AT + 40], [0, 0.6, 0.15])}
        textOffset={{ 1: [-40 * (1 - b), 0], 2: [-40 * (1 - b), 0] }}
        textOpacity={{ 1: b, 2: b }}
      />
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity: quiet * enterAt(frame, fps, 10) }}>
        <MonoTag color={C.white} style={{ translate: '0 380px', fontSize: 30 }}>Quiet by design</MonoTag>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, BANNER_AT + 10) * (1 - quiet) }}>
        <MonoTag color={C.muted}>Lens dark until it matters</MonoTag>
      </div>
      {/* Insight cards in the side space: what the agents noticed, each with one tap */}
      <div style={{ position: 'absolute', left: 96 + w + 64, top: 200, width: 1824 - (96 + w + 64), display: 'flex', flexDirection: 'column', gap: 22 }}>
        {INSIGHTS.map((it, i) => {
          const p = enterAt(frame, fps, CARDS_AT + i * 22)
          return (
            <div
              key={it.title}
              style={{
                opacity: p, translate: `${(1 - p) * 60}px 0`, display: 'flex', alignItems: 'center', gap: 24, padding: '22px 26px', borderRadius: 22,
                background: 'linear-gradient(180deg, rgba(20,26,22,0.95), rgba(14,18,16,0.95))', border: `1px solid ${C.hair}`, boxShadow: '0 24px 50px rgba(0,0,0,0.45)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.16em', textTransform: 'uppercase', color: C.muted, marginBottom: 8 }}>★ {it.where}</div>
                <div style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 40, letterSpacing: '-0.02em', color: C.white, whiteSpace: 'nowrap' }}>{it.title}</div>
                <div style={{ fontFamily: FONT.head, fontWeight: 500, fontSize: 34, letterSpacing: '-0.01em', color: C.muted, whiteSpace: 'nowrap', marginTop: 2 }}>{it.detail}</div>
              </div>
              <div style={{ flex: 'none', fontFamily: FONT.head, fontWeight: 700, fontSize: 30, color: C.bg, background: C.white, borderRadius: 999, padding: '14px 24px' }}>{it.action}</div>
            </div>
          )
        })}
      </div>
      <div
        style={{
          position: 'absolute', left: 96, right: 96, bottom: 110, fontFamily: FONT.head, fontWeight: 700, fontSize: 60, letterSpacing: '-0.03em', lineHeight: 1.1, color: C.white,
          opacity: enterAt(frame, fps, LINE_AT), translate: `0 ${(1 - enterAt(frame, fps, LINE_AT)) * 24}px`,
        }}
      >
        Agents that notice what you didn’t ask about,<br />
        <span style={{ color: C.muted }}>and speak up only when it matters.</span>
      </div>
    </SceneShell>
  )
}
