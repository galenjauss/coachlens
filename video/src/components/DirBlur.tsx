import type React from 'react'
import { useId } from 'react'

interface DirBlurProps {
  /** Blur along x and y in px (a fast horizontal move: x large, y 0). */
  x: number
  y?: number
  children: React.ReactNode
  style?: React.CSSProperties
}

/**
 * Directional motion blur: an SVG gaussian with separate x/y deviation, applied as a CSS filter.
 * Below half a pixel it renders the children untouched.
 */
export function DirBlur({ x, y = 0, children, style }: DirBlurProps) {
  const id = `mb${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const bx = Math.min(80, Math.abs(x))
  const by = Math.min(80, Math.abs(y))
  if (bx < 0.5 && by < 0.5) return <div style={style}>{children}</div>
  return (
    <div style={{ ...style, filter: `url(#${id})` }}>
      <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden>
        <filter id={id} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation={`${bx.toFixed(2)} ${by.toFixed(2)}`} />
        </filter>
      </svg>
      {children}
    </div>
  )
}
