import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion'
import { ease, enterAt } from '../components/motion'
import { Atmos, SceneShell } from '../components/SceneShell'
import { C, FONT } from '../theme'

const TILES = [
  ['Football coach', '#12 late off the snap · 3rd time'],
  ['Math tutor', 'Sam: distribute the negative'],
  ['Martial arts', 'Priya · guard (3rd time)'],
  ['Classroom teacher', 'Row 3 hasn’t spoken today'],
  ['Personal trainer', 'Maria · deadlift PR +10'],
  ['Swim coach', 'Lane 4 · 50m split -0.8s'],
  ['Piano teacher', 'Ava · left-hand tempo'],
  ['Dance instructor', 'Leo · late on the 5-6-7-8'],
  ['Climbing coach', 'Nina · flag the left foot'],
  ['Debate coach', 'Theo · rebuttal ran 40s long'],
  ['Soccer coach', 'Back line · step up together'],
  ['Yoga instructor', 'Kim · knee past toes'],
  ['Tennis coach', 'Max · split-step late'],
  ['Chess coach', 'Ari · hung a piece twice'],
  ['Driving instructor', 'Check blind spot · 2nd time'],
  ['Your class', '> Tap to start class'],
] as const
const COLS = 4
const GAP = 22
const GRID_W = 1728
const TILE_W = (GRID_W - GAP * (COLS - 1)) / COLS
const TILE_H = 166
const GRID_TOP = 250
/** Stagger from the centre tile outward, so the push-in starts on martial arts. */
const order = TILES.map((_, i) => {
  const r = Math.floor(i / COLS)
  const c = i % COLS
  return Math.hypot(c - 1.5, (r - 1.5) * 1.3)
})
const PULL = [150, 250] as const
const LINE_AT = 236
export const MOSAIC_CUES = { tick: [8], whoosh: [PULL[0]], shimmer: [LINE_AT] }

export const S12Mosaic: React.FC = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const push = ease(frame, [0, PULL[0]], [0, 1])
  const pull = ease(frame, [PULL[0], PULL[1]], [0, 1])
  const zoom = (1.38 + 0.12 * push) * (1 - pull) + 1 * pull
  const line = enterAt(frame, fps, LINE_AT)
  return (
    <SceneShell>
      <Atmos y="55%" tint="61,255,122" strength={0.02} />
      <AbsoluteFill style={{ scale: String(zoom), transformOrigin: `960px ${GRID_TOP + TILE_H * 2 + GAP * 1.5}px` }}>
        <div style={{ position: 'absolute', left: 96, top: GRID_TOP, width: GRID_W, display: 'grid', gridTemplateColumns: `repeat(${COLS}, ${TILE_W}px)`, gap: GAP }}>
          {TILES.map(([who, line], i) => {
            const p = enterAt(frame, fps, 6 + order[i]! * 14)
            const ours = who === 'Martial arts' || who === 'Your class'
            return (
              <div
                key={who}
                style={{
                  height: TILE_H, borderRadius: 22, padding: '22px 26px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                  background: ours ? 'linear-gradient(170deg, #122017 0%, #0B110D 100%)' : 'linear-gradient(170deg, #101412 0%, #0A0D0C 100%)', border: `1px solid ${ours ? 'rgba(61,255,122,0.35)' : C.hair}`, opacity: p, translate: `0 ${(1 - p) * 30}px`,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 20px 40px rgba(0,0,0,0.35)',
                }}
              >
                <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 30, letterSpacing: '-0.015em', color: ours ? C.white : C.muted }}>{who}</div>
                <div style={{ fontFamily: FONT.lens, fontWeight: 400, fontSize: 29, lineHeight: 1.15, whiteSpace: 'nowrap', letterSpacing: '-0.005em', color: C.green, textShadow: '0 0 4px rgba(61,255,122,0.5), 0 0 14px rgba(61,255,122,0.25)' }}>{line}</div>
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 96, top: 110, fontFamily: FONT.head, fontWeight: 800, fontSize: 96, letterSpacing: '-0.045em', color: C.white, opacity: line, translate: `0 ${(1 - line) * -20}px` }}>
        Any room. <span style={{ color: C.muted }}>Any coach.</span>
      </div>
    </SceneShell>
  )
}
