import type React from 'react'
import { C, FONT } from '../theme'

/** Section tag: `01 · PLAN OUT LOUD`. JetBrains Mono, uppercase, 0.2em tracking. */
export const MonoTag: React.FC<{ num?: string; children: React.ReactNode; style?: React.CSSProperties; color?: string }> = ({ num, children, style, color = C.muted }) => (
  <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 28, letterSpacing: '0.2em', textTransform: 'uppercase', color, whiteSpace: 'nowrap', ...style }}>
    {num ? <span style={{ color: C.green }}>{num}</span> : null}
    {num ? <span style={{ opacity: 0.5 }}>{'  ·  '}</span> : null}
    {children}
  </div>
)

export const Footnote: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontFamily: FONT.mono, fontWeight: 500, fontSize: 22, letterSpacing: '0.12em', color: C.muted, ...style }}>{children}</div>
)

/** Headline type: Inter Tight, tight tracking. */
export const Headline: React.FC<{ size?: number; weight?: 600 | 700 | 800; children: React.ReactNode; style?: React.CSSProperties; color?: string }> = ({ size = 96, weight = 800, children, style, color = C.white }) => (
  <div style={{ fontFamily: FONT.head, fontWeight: weight, fontSize: size, letterSpacing: '-0.012em', lineHeight: 1.02, color, ...style }}>{children}</div>
)

/** A caption line under a demo beat: off-white lead, muted tail. */
export const Caption: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; size?: number }> = ({ children, style, size = 44 }) => (
  <div style={{ fontFamily: FONT.head, fontWeight: 600, fontSize: size, letterSpacing: '-0.005em', lineHeight: 1.15, color: C.white, ...style }}>{children}</div>
)

/** Text with a blinking-free block caret, for typewritten spoken lines. */
export const Typed: React.FC<{ text: string; chars: number; caret?: boolean; caretColor?: string }> = ({ text, chars, caret = true, caretColor = C.white }) => (
  <>
    {text.slice(0, chars)}
    {caret && chars < text.length + 8 ? (
      <span style={{ display: 'inline-block', width: '0.08em', height: '0.95em', marginLeft: '0.06em', translate: '0 0.14em', background: caretColor, opacity: chars >= text.length ? 0.6 : 1 }} />
    ) : null}
  </>
)
