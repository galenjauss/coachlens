import { useCurrentFrame, useVideoConfig } from 'remotion'
import { TapRipple } from '../components/Gesture'
import { lensFrameSize, lensPoint } from '../components/LensFrame'
import { LensStage } from '../components/LensStage'
import { ease, enterAt, lin } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { MonoTag } from '../components/Type'
import { homeRemindedSpec, wrapupSpec } from '../lens/appLens'
import { C, FONT } from '../theme'

const SCALE = 1.45
const LEFT = 96
const TOP = 200
const MARK1 = 22
const MARK2 = 50
const TAP = 160
const FLY = [166, 198] as const
const LAND = 198
export const WRAPUP_CUES = { shimmer: [0], tick: [MARK1, MARK2, LAND], tap: [TAP], whoosh: [FLY[0]] }

const PLAN = ['Warm-up: stance tag · 6m', 'Guard-up jab drill · 6m', 'Partner pad drill · 6m']
const PANEL_X = 1150
const PANEL_Y = 214

export const S09Wrapup: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const { w, h } = lensFrameSize(SCALE)
  const pad = lensPoint(SCALE, 576, 150)
  const from = lensPoint(SCALE, 150, 216)
  const fly = ease(frame, [FLY[0], FLY[1]], [0, 1])
  const sx = LEFT + from.x
  const sy = TOP + from.y
  const tx = PANEL_X + 34
  const ty = PANEL_Y + 112
  const arc = Math.sin(fly * Math.PI) * -120
  const panel = enterAt(frame, fps, 70)
  const open = enterAt(frame, fps, FLY[0] + 12)
  const row = enterAt(frame, fps, LAND)
  return (
    <SceneShell>
      <Atmos x="30%" y="42%" tint="61,255,122" strength={0.02} />
      <MonoTag num="04" style={{ position: 'absolute', left: 96, top: 96, opacity: enterAt(frame, fps, 4) }}>End of class</MonoTag>
      <LensStage
        left={LEFT} top={TOP} scale={SCALE} power={lin(frame, [0, 8], [0, 1])}
        spec={frame < FLY[0] + 6 ? wrapupSpec() : homeRemindedSpec()}
        marks={[
          { text: '9/12 got feedback', progress: ease(frame, [MARK1, MARK1 + 12], [0, 1]) },
          { text: 'Missed: Eli, Mia, Leo', progress: ease(frame, [MARK2, MARK2 + 12], [0, 1]), tone: 'amber' },
          { text: 'Eli, Mia, Leo first next class', progress: ease(frame, [FLY[0] + 10, FLY[0] + 22], [0, 1]) },
        ]}
      />
      <div style={{ position: 'absolute', left: LEFT, top: TOP }}>
        <TapRipple at={TAP} x={pad.x + 56} y={pad.y} label="TAP" hold={26} />
      </div>
      {/* Next class plan, where the missed kids land first */}
      <div
        style={{
          position: 'absolute', left: PANEL_X, top: PANEL_Y, width: 1824 - PANEL_X, padding: '28px 34px', borderRadius: 26, opacity: panel, translate: `${(1 - panel) * 40}px 0`,
          background: 'linear-gradient(180deg, rgba(20,26,22,0.95), rgba(14,18,16,0.95))', border: `1px solid ${C.hair}`, boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', color: C.muted }}>NEXT CLASS · THU</div>
        <div style={{ height: 78 * open, overflow: 'hidden', marginTop: 18 * open }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: 64, padding: '0 18px', borderRadius: 14, background: 'rgba(236,239,234,0.07)', border: `1px solid ${C.hair}`, opacity: row }}>
            <span style={{ fontFamily: FONT.head, fontWeight: 700, fontSize: 34, color: C.white }}>Feedback first:</span>
            <span style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 34, color: C.white }}>Eli, Mia, Leo</span>
          </div>
        </div>
        {PLAN.map((p, i) => (
          <div key={p} style={{ display: 'flex', gap: 18, alignItems: 'baseline', padding: '14px 4px', borderBottom: i < PLAN.length - 1 ? `1px solid ${C.faint}` : undefined }}>
            <span style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, color: C.muted }}>{i + 1}</span>
            <span style={{ fontFamily: FONT.head, fontWeight: 500, fontSize: 34, color: C.muted }}>{p}</span>
          </div>
        ))}
      </div>
      {/* The chip flying from the lens to the plan */}
      {frame >= FLY[0] && frame < LAND + 4 ? (
        <div
          style={{
            position: 'absolute', left: sx + (tx - sx) * fly, top: sy + (ty - sy) * fly + arc, translate: '0 -50%', padding: '12px 22px', borderRadius: 999,
            background: C.white, color: C.bg, fontFamily: FONT.head, fontWeight: 700, fontSize: 32, whiteSpace: 'nowrap', boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            scale: String(0.8 + 0.2 * Math.sin(fly * Math.PI) + 0.1), opacity: lin(frame, [FLY[0], FLY[0] + 4, LAND, LAND + 4], [0, 1, 1, 0]),
          }}
        >
          Eli · Mia · Leo
        </div>
      ) : null}
      <div style={{ position: 'absolute', left: 96, top: TOP + h + 44, width: w + 200, fontFamily: FONT.head, fontWeight: 600, fontSize: 48, letterSpacing: '-0.005em', lineHeight: 1.15, color: C.white, opacity: enterAt(frame, fps, 30) }}>
        See who you missed. <span style={{ color: frame >= TAP ? C.white : C.muted }}>One tap puts them first next class.</span>
      </div>
    </SceneShell>
  )
}
