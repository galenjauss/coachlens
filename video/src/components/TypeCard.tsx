import { AbsoluteFill } from 'remotion'
import { FONT } from '../theme'
import { Word } from './Kinetic'

interface TypeCardProps {
  text: string
  color: string
  tag?: string
  size?: number
  mode?: 'letters' | 'slam' | 'slide'
}

/** A full-bleed type card between demo beats: one giant line, one mono tag. */
export function TypeCard({ text, color, tag, size, mode = 'letters' }: TypeCardProps) {
  const s = size ?? Math.min(280, 1700 / (text.length * 0.6))
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Word text={text} at={-5} size={s} color={color} mode={mode} stagger={0.9} from="down" />
      {tag ? (
        <div style={{ position: 'absolute', top: 540 + s * 0.62, fontFamily: FONT.mono, fontSize: 24, letterSpacing: '0.34em', color, opacity: 0.72 }}>{tag}</div>
      ) : null}
    </AbsoluteFill>
  )
}
