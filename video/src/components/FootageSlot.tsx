import { Video } from '@remotion/media'
import type React from 'react'
import { AbsoluteFill, getStaticFiles, Sequence, staticFile, useCurrentFrame } from 'remotion'
import { lin } from '../lib/anim'
import { C, FONT } from '../theme'

/** The footage file for a slot, if one has been dropped into public/footage/. */
export function footageFor(id: string): string | null {
  const names = new Set(getStaticFiles().map(f => f.name))
  for (const ext of ['mp4', 'mov', 'webm']) {
    const name = `footage/${id}.${ext}`
    if (names.has(name)) return name
  }
  return null
}

interface FootageSlotProps {
  id: string
  label: string
  /** Built from real captures only. */
  fallback: React.ReactNode
  /** Phone recordings are portrait; lens/through-the-lens footage is landscape. */
  portrait?: boolean
}

/**
 * A real-footage slot. With `public/footage/<id>.mp4|mov` present it plays the clip in a tilted 3D
 * frame with a slow push-in; otherwise it renders `fallback`.
 */
export function FootageSlot({ id, label, fallback, portrait = false }: FootageSlotProps) {
  const f = useCurrentFrame()
  const src = footageFor(id)
  if (!src) return <>{fallback}</>
  const w = portrait ? 470 : 1440
  const h = portrait ? 1000 : 810
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', perspective: 1800 }}>
      <div
        style={{
          width: w,
          height: h,
          borderRadius: portrait ? 54 : 28,
          overflow: 'hidden',
          transform: `rotateY(${lin(f, [0, 300], [-14, -8])}deg) rotateX(6deg) scale(${lin(f, [0, 300], [1, 1.08])})`,
          boxShadow: '0 0 0 1px rgba(236,239,234,0.14), 0 40px 120px rgba(0,0,0,0.6)',
        }}
      >
        <Video src={staticFile(src)} muted objectFit="cover" style={{ width: '100%', height: '100%' }} />
      </div>
      <div style={{ position: 'absolute', left: 120, bottom: 120, fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.24em', color: C.muted }}>{label}</div>
    </AbsoluteFill>
  )
}


const PAD = 3

interface SlotShotProps {
  id: 'A' | 'B' | 'C'
  from: number
  to: number
  label: string
  portrait?: boolean
  /** Global-frame shots (Shot components) used when no footage file exists. */
  fallback: React.ReactNode
}

/**
 * Places a footage slot on the global timeline (with a few frames of handle so whips into and out of
 * its fallback shots render). The fallback's Shots keep using global frames.
 */
export function SlotShot({ id, from, to, label, portrait, fallback }: SlotShotProps) {
  return (
    <Sequence from={from - PAD} durationInFrames={to - from + PAD * 2} name={`slot-${id}`}>
      <FootageSlot
        id={id}
        label={label}
        portrait={portrait}
        fallback={
          <Sequence from={-(from - PAD)} layout="none">
            {fallback}
          </Sequence>
        }
      />
    </Sequence>
  )
}
