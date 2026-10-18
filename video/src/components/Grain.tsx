import { AbsoluteFill, useCurrentFrame } from 'remotion'

/** Light film grain (lighter than v1, re-seeded every 3 frames to keep the bitrate sane) and a vignette. */
export function Grain() {
  const frame = useCurrentFrame()
  const seed = Math.floor(frame / 3) % 24
  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.05, mixBlendMode: 'overlay' }}>
        <filter id="grain">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain)" />
      </svg>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, transparent 64%, rgba(0,0,0,0.2) 100%)' }} />
    </AbsoluteFill>
  )
}
