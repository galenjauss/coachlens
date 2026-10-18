import type React from 'react'
import { C, FONT } from '../theme'

/** An outcome chip: a small dark panel with a mono kicker and an off-white result. */
export const Chip: React.FC<{ kicker: string; children: React.ReactNode; tone?: 'green' | 'amber' | 'neutral'; style?: React.CSSProperties; glyph?: string }> = ({ kicker, children, tone = 'green', style, glyph }) => {
  const accent = tone === 'green' ? C.green : tone === 'amber' ? C.amber : C.muted
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 20, padding: '16px 26px 16px 24px', boxSizing: 'border-box', borderRadius: 18, background: 'rgba(14,18,16,0.92)',
        border: `1px solid ${C.hair}`, boxShadow: '0 18px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)', whiteSpace: 'nowrap', ...style,
      }}
    >
      <div style={{ width: 12, height: 12, borderRadius: '50%', background: accent, boxShadow: `0 0 12px ${accent}`, flex: 'none' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.14em', textTransform: 'uppercase', color: tone === 'amber' ? C.amber : C.muted }}>
          {glyph ? <span style={{ marginRight: 10 }}>{glyph}</span> : null}{kicker}
        </div>
        <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: 36, letterSpacing: '-0.005em', color: C.white }}>{children}</div>
      </div>
    </div>
  )
}
