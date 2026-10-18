import type React from 'react'
import { Img, staticFile, useCurrentFrame } from 'remotion'
import { ease, EASE, lin, pop } from '../lib/anim'
import { DirBlur } from './DirBlur'

/** CSS viewport of the real phone captures (860×1864 at 2x). */
const VW = 430
const VH = 932
const SWAP = 7

export type PhoneScreen = { src: string; at: number; enter?: 'cut' | 'fade' | 'scroll' | 'slide' }
/** Camera keyframe: zoom `s` centred on (x, y) in the 430×932 screen space. */
export type PhoneCam = { f: number; s: number; x: number; y: number }
export type CursorKey = { f: number; x: number; y: number }

interface PhoneShotProps {
  screens: readonly PhoneScreen[]
  /** Rendered screen height in px. */
  height?: number
  enterAt?: number
  enterFrom?: 'right' | 'left' | 'bottom'
  ry?: readonly [number, number]
  rx?: readonly [number, number]
  span?: readonly [number, number]
  cam?: readonly PhoneCam[]
  cursor?: readonly CursorKey[]
  taps?: readonly number[]
  style?: React.CSSProperties
  focus?: (f: number) => number
}

const camAt = (cam: readonly PhoneCam[] | undefined, f: number): { s: number; x: number; y: number } => {
  if (!cam || cam.length === 0) return { s: 1, x: VW / 2, y: VH / 2 }
  const first = cam[0]
  if (!first || f <= first.f) return first ?? { s: 1, x: VW / 2, y: VH / 2 }
  for (let i = 1; i < cam.length; i++) {
    const a = cam[i - 1]
    const b = cam[i]
    if (a && b && f <= b.f) {
      const t = EASE.inOut(lin(f, [a.f, b.f], [0, 1]))
      return { s: a.s + (b.s - a.s) * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  return cam[cam.length - 1] ?? first
}

const cursorAt = (keys: readonly CursorKey[], f: number): { x: number; y: number; on: number } | null => {
  const first = keys[0]
  if (!first || f < first.f - 8) return null
  let pos = { x: first.x, y: first.y }
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (a && b && f > a.f) {
      const t = EASE.inOut(lin(f, [a.f, b.f], [0, 1]))
      pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
    }
  }
  const last = keys[keys.length - 1]
  const on = lin(f, [first.f - 8, first.f], [0, 1]) * (last ? lin(f, [last.f + 20, last.f + 30], [1, 0]) : 1)
  return { ...pos, on }
}

/** A real phone capture in an iPhone-style frame, tilted in 3D, with camera push-ins and touch taps. */
export function PhoneShot({ screens, height = 860, enterAt = 0, enterFrom = 'right', ry = [-20, -10], rx = [8, 4], span, cam, cursor = [], taps = [], style, focus }: PhoneShotProps) {
  const f = useCurrentFrame()
  const k = height / VH
  const W = VW * k
  const bezel = 14 * k * 1.1
  const [t0, t1] = span ?? [enterAt, enterAt + 120]
  const kk = EASE.inOut(lin(f, [t0, t1], [0, 1]))
  const e = pop(f, enterAt, 120, 15, 0.9)
  const ePrev = pop(f - 1, enterAt, 120, 15, 0.9)
  const off = 1500 * (1 - e)
  const vOff = 1500 * (e - ePrev)
  const tx = enterFrom === 'right' ? off : enterFrom === 'left' ? -off : 0
  const ty = enterFrom === 'bottom' ? off : 0
  const c = camAt(cam, f)
  const shown = screens.filter(s => s.at <= f)
  const cur = shown[shown.length - 1] ?? screens[0]
  const prev = shown.length > 1 ? shown[shown.length - 2] : undefined
  const st = cur ? f - cur.at : SWAP
  const mode = cur?.enter ?? 'cut'
  const p = ease(st, [0, SWAP], [0, 1], EASE.outCubic)
  const pv = ease(st - 1, [0, SWAP], [0, 1], EASE.outCubic)
  const swapping = prev && st < SWAP && mode !== 'cut'
  const layer = (src: string, s: React.CSSProperties) => (
    <Img src={staticFile(`captures/${src}`)} style={{ position: 'absolute', left: 0, top: 0, width: W, height: VH * k, ...s }} />
  )
  const cp = cursorAt(cursor, f)
  const blur = focus ? focus(f) : 0
  return (
    <div style={{ perspective: 1800, ...style }}>
      <DirBlur x={enterFrom === 'bottom' ? 0 : vOff * 0.35} y={enterFrom === 'bottom' ? vOff * 0.35 : 0}>
        <div
          style={{
            transform: `translate(${tx}px, ${ty}px) rotateY(${ry[0] + (ry[1] - ry[0]) * kk}deg) rotateX(${rx[0] + (rx[1] - rx[0]) * kk}deg) scale(${c.s}) translate(${(VW / 2 - c.x) * k}px, ${(VH / 2 - c.y) * k}px)`,
            transformStyle: 'preserve-3d',
            filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
          }}
        >
          <div
            style={{
              position: 'relative',
              width: W + bezel * 2,
              height: VH * k + bezel * 2,
              borderRadius: 62 * k,
              background: 'linear-gradient(145deg, #2a2d2c, #0b0c0c 40%, #1b1d1c)',
              padding: bezel,
              boxShadow: '0 0 0 2px #3a3d3c inset, 0 2px 0 rgba(255,255,255,0.15) inset, 0 30px 50px rgba(0,0,0,0.45), 0 80px 160px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ position: 'absolute', right: -5 * k, top: 210 * k, width: 5 * k, height: 90 * k, borderRadius: 3, background: '#2a2d2c' }} />
            <div style={{ position: 'absolute', left: -5 * k, top: 180 * k, width: 5 * k, height: 60 * k, borderRadius: 3, background: '#2a2d2c' }} />
            <div style={{ position: 'relative', width: W, height: VH * k, borderRadius: 50 * k, overflow: 'hidden', background: '#222' }}>
              {swapping && prev && mode === 'fade' ? layer(prev.src, {}) : null}
              {swapping && prev && mode === 'scroll' ? (
                <DirBlur x={0} y={(p - pv) * 900 * k * 0.3} style={{ position: 'absolute', inset: 0 }}>
                  {layer(prev.src, { transform: `translateY(${-p * VH * k}px)` })}
                  {cur ? layer(cur.src, { transform: `translateY(${(1 - p) * VH * k}px)` }) : null}
                </DirBlur>
              ) : null}
              {swapping && prev && mode === 'slide' ? (
                <DirBlur x={(p - pv) * W * 0.3} style={{ position: 'absolute', inset: 0 }}>
                  {layer(prev.src, { transform: `translateX(${-p * W}px)` })}
                  {cur ? layer(cur.src, { transform: `translateX(${(1 - p) * W}px)` }) : null}
                </DirBlur>
              ) : null}
              {cur && !(swapping && (mode === 'scroll' || mode === 'slide')) ? layer(cur.src, { opacity: swapping && mode === 'fade' ? p : 1 }) : null}
              {taps.map(t => {
                const tp = lin(f, [t, t + 18], [0, 1])
                if (f < t || tp >= 1 || !cp) return null
                return (
                  <div
                    key={t}
                    style={{
                      position: 'absolute',
                      left: cp.x * k,
                      top: cp.y * k,
                      width: (30 + tp * 110) * k,
                      height: (30 + tp * 110) * k,
                      transform: 'translate(-50%, -50%)',
                      borderRadius: '50%',
                      background: `rgba(255,255,255,${0.25 * (1 - tp)})`,
                      border: `${3 * k}px solid rgba(255,255,255,${0.8 * (1 - tp)})`,
                    }}
                  />
                )
              })}
              {cp ? (
                <div
                  style={{
                    position: 'absolute',
                    left: cp.x * k,
                    top: cp.y * k,
                    width: 46 * k,
                    height: 46 * k,
                    transform: `translate(-50%, -50%) scale(${taps.some(t => f >= t && f < t + 6) ? 0.78 : 1})`,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.32)',
                    border: `${2.5 * k}px solid rgba(255,255,255,0.9)`,
                    boxShadow: '0 4px 18px rgba(0,0,0,0.45)',
                    opacity: cp.on,
                  }}
                />
              ) : null}
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,0.07), transparent 35%)', pointerEvents: 'none' }} />
            </div>
          </div>
        </div>
      </DirBlur>
    </div>
  )
}
