import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { timecode } from '../lib/anim'
import { C, FIELD, FONT } from '../theme'
import { BAR, BEAT, FINALE_AT, LABELS, fieldAt } from '../timeline'

/** Finale beat length in frames (~176 BPM measured; the HUD reads 175). */
const FINALE_BEAT = (60 / 175.5) * 30

const Bracket = ({ x, y, color }: { x: 'left' | 'right'; y: 'top' | 'bottom'; color: string }) => (
  <div
    style={{
      position: 'absolute',
      [x]: 40,
      [y]: 40,
      width: 26,
      height: 26,
      [`border${y === 'top' ? 'Top' : 'Bottom'}`]: `2px solid ${color}`,
      [`border${x === 'left' ? 'Left' : 'Right'}`]: `2px solid ${color}`,
    }}
  />
)

/** Motion-reel HUD on every frame: brackets, title, live bar counter + BPM, section label, timecode. */
export function Hud() {
  const frame = useCurrentFrame()
  const field = FIELD[fieldAt(frame).field]
  const label = [...LABELS].reverse().find(l => l.at <= frame) ?? LABELS[0]
  const finale = frame >= FINALE_AT
  const beatIdx = finale ? Math.floor((frame - FINALE_AT) / FINALE_BEAT) : Math.floor(frame / BEAT)
  const barIdx = finale ? Math.floor(beatIdx / 4) : Math.floor(frame / BAR)
  const inBeat = beatIdx % 4
  const text: React.CSSProperties = { fontFamily: FONT.mono, fontWeight: 500, fontSize: 15, letterSpacing: '0.22em', color: field.soft, whiteSpace: 'nowrap' }
  const strong: React.CSSProperties = { color: field.ink, fontWeight: 700 }
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <Bracket x="left" y="top" color={field.soft} />
      <Bracket x="right" y="top" color={field.soft} />
      <Bracket x="left" y="bottom" color={field.soft} />
      <Bracket x="right" y="bottom" color={field.soft} />
      <div style={{ ...text, position: 'absolute', left: 80, top: 46, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: 9, background: fieldAt(frame).field === 'green' ? C.black : C.green, boxShadow: `0 0 8px ${C.green}` }} />
        <span style={strong}>COACHLENS</span>
        <span>— LAUNCH FILM 2026</span>
      </div>
      <div style={{ ...text, position: 'absolute', right: 80, top: 46, display: 'flex', alignItems: 'center', gap: 18 }}>
        <span>SCENE {String(label?.scene ?? 1).padStart(2, '0')} / 07</span>
        <span style={{ display: 'flex', gap: 5 }}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ width: 9, height: 9, border: `1.5px solid ${field.soft}`, background: i === inBeat ? field.ink : 'transparent' }} />
          ))}
        </span>
        <span>
          BAR <span style={strong}>{(barIdx % 8) + 1}/8</span> · <span style={strong}>{finale ? 175 : 120} BPM</span>
        </span>
      </div>
      <div style={{ ...text, position: 'absolute', left: 80, bottom: 46 }}>{label?.label}</div>
      <div style={{ ...text, position: 'absolute', right: 80, bottom: 46 }}>
        F{String(frame).padStart(4, '0')}&nbsp;&nbsp;<span style={strong}>{timecode(frame)}</span>
      </div>
    </AbsoluteFill>
  )
}
