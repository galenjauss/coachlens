import type React from 'react'
import { LensFrame, type LensFrameProps, lensFrameSize } from './LensFrame'

/** A LensFrame placed on the 1920×1080 canvas: centred horizontally unless `left` is given. */
export const LensStage: React.FC<LensFrameProps & { top: number; left?: number; lift?: number; zoom?: number }> = ({ top, left, lift = 0, zoom = 1, style, ...props }) => {
  const { w } = lensFrameSize(props.scale)
  return (
    <LensFrame
      {...props}
      style={{ position: 'absolute', left: left ?? (1920 - w) / 2, top, translate: `0 ${lift}px`, scale: String(zoom), transformOrigin: 'center center', ...style }}
    />
  )
}
