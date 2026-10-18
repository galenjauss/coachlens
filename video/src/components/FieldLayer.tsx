import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ease, EASE } from '../lib/anim'
import { FIELD, type FieldName } from '../theme'
import { fieldAt, prevField } from '../timeline'

const WIPE = 8

function Field({ name, frame }: { name: FieldName; frame: number }) {
  const f = FIELD[name]
  const dark = name === 'black'
  return (
    <AbsoluteFill style={{ background: f.bg }}>
      {dark ? (
        <AbsoluteFill
          style={{
            backgroundImage: 'radial-gradient(rgba(236,239,234,0.10) 1.2px, transparent 1.6px)',
            backgroundSize: '48px 48px',
            backgroundPosition: `${(frame * 0.25) % 48}px ${(frame * 0.12) % 48}px`,
            maskImage: 'radial-gradient(ellipse at 50% 50%, black 20%, transparent 75%)',
          }}
        />
      ) : null}
      <AbsoluteFill
        style={{
          background: dark
            ? 'radial-gradient(ellipse at 50% 40%, rgba(61,255,122,0.05), transparent 60%)'
            : 'radial-gradient(ellipse at 50% 45%, rgba(255,255,255,0.10), transparent 55%), radial-gradient(ellipse at 50% 50%, transparent 60%, rgba(0,0,0,0.12) 100%)',
        }}
      />
    </AbsoluteFill>
  )
}

/** The full-bleed colour field behind everything, flipped on downbeats (cut, wipe or lens iris). */
export function FieldLayer() {
  const frame = useCurrentFrame()
  const cut = fieldAt(frame)
  const t = frame - cut.at
  if (!cut.wipe || t >= WIPE) return <Field name={cut.field} frame={frame} />
  const p = ease(t, [0, WIPE], [0, 1], EASE.outExpo)
  const clip =
    cut.wipe === 'left' ? `inset(0 0 0 ${100 - p * 100}%)` : cut.wipe === 'up' ? `inset(${100 - p * 100}% 0 0 0)` : `circle(${p * 75}% at 50% 50%)`
  return (
    <AbsoluteFill>
      <Field name={prevField(cut).field} frame={frame} />
      <AbsoluteFill style={{ clipPath: clip }}>
        <Field name={cut.field} frame={frame} />
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
