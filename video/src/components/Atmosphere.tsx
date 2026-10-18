import { AbsoluteFill, random, useCurrentFrame } from 'remotion'

const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1.6 0 0 0 -0.55'/></filter><rect width='300' height='300' filter='url(#n)'/></svg>`,
)}")`

/** Fine film grain (≈4 %), re-offset every frame so it crawls like real grain. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame()
  const x = Math.floor(random(`gx${frame}`) * 300)
  const y = Math.floor(random(`gy${frame}`) * 300)
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, backgroundImage: NOISE, backgroundSize: '300px 300px', backgroundPosition: `${x}px ${y}px` }} />
  )
}

export const Vignette: React.FC<{ strength?: number }> = ({ strength = 0.6 }) => (
  <AbsoluteFill
    style={{ pointerEvents: 'none', background: `radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(0,0,0,${strength}) 100%)` }}
  />
)
