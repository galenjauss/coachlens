import { Video } from '@remotion/media'
import type React from 'react'
import { AbsoluteFill, getStaticFiles, staticFile } from 'remotion'
import { C } from '../theme'
import { MonoTag } from './Type'

/** The footage file for a slot, if one has been dropped into public/footage/. */
export function footageFor(id: string): string | null {
  const names = new Set(getStaticFiles().map(f => f.name))
  for (const ext of ['mp4', 'mov', 'webm']) {
    const name = `footage/${id}.${ext}`
    if (names.has(name)) return name
  }
  return null
}

/**
 * A real-footage slot. With `public/footage/<id>.mp4|mov` present it plays the clip, cover-fit in a
 * rounded frame, with `overlay` (captions, tags) on top; otherwise it renders `fallback`.
 */
export const FootageSlot: React.FC<{ id: string; label: string; fallback: React.ReactNode; overlay?: React.ReactNode }> = ({ id, label, fallback, overlay }) => {
  const src = footageFor(id)
  if (!src) return <>{fallback}</>
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 96, right: 96, top: 96, bottom: 200, borderRadius: 36, overflow: 'hidden', boxShadow: `0 0 0 1px ${C.hair}, 0 40px 100px rgba(0,0,0,0.6)` }}>
        <Video src={staticFile(src)} muted objectFit="cover" style={{ width: '100%', height: '100%' }} />
      </div>
      <MonoTag style={{ position: 'absolute', left: 96, bottom: 120 }} color={C.muted}>{label}</MonoTag>
      {overlay}
    </AbsoluteFill>
  )
}
