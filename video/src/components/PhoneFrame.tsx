import type React from 'react'

/** Phone tokens from app/src/phone/theme.css. */
export const P = {
  bg: '#232323', card: '#2f2f2f', line: '#3a3a3a', text: '#e5e5e5', muted: '#a3a3a3',
  accent: '#3dff7a', danger: '#ffb4b4', dangerBg: '#5a2a2a', warn: '#e8d36a', ink: '#0b0b0b', tabs: '#1a1a1a',
} as const

export const PHONE_W = 430
export const PHONE_H = 880

/** A clean, logo-free phone: dark titanium band, thin bezel, island, the app's screen inside. */
export const PhoneFrame: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'relative', width: PHONE_W, height: PHONE_H, ...style }}>
    <div
      style={{
        position: 'absolute', inset: 0, borderRadius: 72, background: 'linear-gradient(145deg, #2a2d2b, #121413 40%, #1b1e1c)',
        boxShadow: '0 40px 90px rgba(0,0,0,0.6), inset 0 0 0 1.5px rgba(255,255,255,0.12), inset 0 0 0 4px #0b0c0c',
      }}
    />
    <div style={{ position: 'absolute', inset: 12, borderRadius: 60, overflow: 'hidden', background: P.bg, fontFamily: '-apple-system, "SF Pro Text", system-ui, sans-serif', color: P.text }}>
      {children}
      <div style={{ position: 'absolute', top: 14, left: '50%', translate: '-50% 0', width: 120, height: 34, borderRadius: 20, background: '#000' }} />
    </div>
    <div style={{ position: 'absolute', inset: 0, borderRadius: 72, background: 'linear-gradient(120deg, rgba(255,255,255,0.06), rgba(255,255,255,0) 30%)', pointerEvents: 'none' }} />
  </div>
)
