import type React from 'react'
import type { PageSpec, TextSpec } from '../lens/appLens'
import { C, FONT } from '../theme'

/** Native G2 display size, in lens pixels. */
export const LENS_W = 576
export const LENS_H = 288
/** Lens font metrics, calibrated against docs/store/screenshots (true simulator captures). */
const FONT_PX = 21
const LINE_PX = 27
const PAD = 6
const PAD_TOP = 7

export type Mark = { text: string; progress: number; tone?: 'green' | 'red' | 'amber' }
export type LineFx = { opacity?: number; strike?: number; flash?: number; tone?: 'red' | 'green' }

export type LensDisplayProps = {
  spec: PageSpec
  /** Screen px per lens px. */
  scale: number
  /** 0 = lens dark, 1 = fully lit. */
  power?: number
  /** Reveal only the first `chars` characters of container `id` (typewriter), with an optional caret. */
  typing?: { id: number; chars: number; caret?: boolean }
  /** Highlight substrings wherever they appear (names in an answer, counts in a summary). */
  marks?: Mark[]
  /** Per-line effects keyed by container id → line index. */
  lineFx?: (id: number, line: number, text: string) => LineFx | undefined
  /** Fade a container in (0..1) by id; containers not listed are fully shown. */
  textOpacity?: Record<number, number>
  /** Slide a container by [dx, dy] lens px (banner entrances). */
  textOffset?: Record<number, [number, number]>
}

const TONE = { green: C.green, red: C.red, amber: C.amber } as const

function renderMarks(line: string, marks: Mark[] | undefined): React.ReactNode {
  if (!marks?.length) return line
  const live = marks.filter(m => m.progress > 0 && line.includes(m.text))
  if (!live.length) return line
  const parts: React.ReactNode[] = []
  let rest = line
  let key = 0
  while (rest.length) {
    const hits = live.map(m => ({ m, i: rest.indexOf(m.text) })).filter(h => h.i >= 0).sort((a, b) => a.i - b.i)
    const hit = hits[0]
    if (!hit) { parts.push(rest); break }
    if (hit.i > 0) parts.push(rest.slice(0, hit.i))
    const tone = TONE[hit.m.tone ?? 'green']
    const p = hit.m.progress
    parts.push(
      <span key={key++} style={{ position: 'relative', display: 'inline-block' }}>
        <span style={{ position: 'absolute', left: -3, right: -3, top: 2, bottom: 1, borderRadius: 3, background: tone, opacity: 0.2 * p, transformOrigin: 'left center', scale: `${p} 1` }} />
        <span style={{ position: 'absolute', left: -1, right: -1, bottom: 0, height: 2, background: tone, opacity: p, transformOrigin: 'left center', scale: `${p} 1`, boxShadow: `0 0 6px ${tone}` }} />
        <span style={{ position: 'relative', color: hit.m.tone && hit.m.tone !== 'green' ? tone : '#B8FFD0' }}>{hit.m.text}</span>
      </span>,
    )
    rest = rest.slice(hit.i + hit.m.text.length)
  }
  return parts
}

function TextBox({ t, props }: { t: TextSpec; props: LensDisplayProps }) {
  const typing = props.typing?.id === t.id ? props.typing : undefined
  const content = typing ? t.content.slice(0, typing.chars) : t.content
  const lines = content.split('\n')
  const opacity = props.textOpacity?.[t.id] ?? 1
  const [dx, dy] = props.textOffset?.[t.id] ?? [0, 0]
  return (
    <div
      style={{
        position: 'absolute', left: t.x, top: t.y, width: t.w, height: t.h, boxSizing: 'border-box',
        padding: `${PAD_TOP}px ${PAD}px ${PAD}px`, overflow: 'hidden', opacity, translate: `${dx}px ${dy}px`,
        border: t.border ? `2px solid ${C.green}` : undefined, borderRadius: t.border ? 5 : undefined,
        boxShadow: t.border ? '0 0 8px rgba(61,255,122,0.35), inset 0 0 8px rgba(61,255,122,0.12)' : undefined,
      }}
    >
      {lines.map((line, i) => {
        const fx = props.lineFx?.(t.id, i, line)
        const isLast = i === lines.length - 1
        return (
          <div key={i} style={{ position: 'relative', height: LINE_PX, lineHeight: `${LINE_PX}px`, whiteSpace: 'pre', opacity: fx?.opacity ?? 1 }}>
            <span style={{ position: 'relative', color: fx?.tone === 'red' ? C.red : undefined }}>
              {renderMarks(line, props.marks)}
              {fx?.strike ? (
                <span style={{ position: 'absolute', left: -2, right: -2, top: '52%', height: 2, background: C.red, boxShadow: `0 0 6px ${C.red}`, transformOrigin: 'left center', scale: `${fx.strike} 1` }} />
              ) : null}
            </span>
            {fx?.flash ? (
              <span style={{ position: 'absolute', inset: '1px -4px', borderRadius: 3, background: C.green, opacity: 0.22 * fx.flash }} />
            ) : null}
            {typing?.caret && isLast ? <span style={{ display: 'inline-block', width: 9, height: 20, marginLeft: 2, translate: '0 4px', background: C.green }} /> : null}
          </div>
        )
      })}
    </div>
  )
}

/** Draws a real PageSpec at its exact 576×288 coordinates, scaled, in the lens font with a phosphor glow. */
export const LensDisplay: React.FC<LensDisplayProps> = props => {
  const { spec, scale, power = 1 } = props
  return (
    <div style={{ position: 'relative', width: LENS_W * scale, height: LENS_H * scale }}>
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: LENS_W, height: LENS_H, scale: String(scale), transformOrigin: '0 0',
          fontFamily: FONT.lens, fontWeight: 400, fontSize: FONT_PX, color: C.green, letterSpacing: '0.01em',
          textShadow: '0 0 3px rgba(61,255,122,0.55), 0 0 10px rgba(61,255,122,0.28)',
          opacity: power, filter: power < 1 ? `brightness(${0.4 + 0.6 * power})` : undefined,
        }}
      >
        {spec.texts.map(t => <TextBox key={`${spec.key}-${t.id}`} t={t} props={props} />)}
        {spec.list ? (
          <div style={{ position: 'absolute', left: spec.list.x, top: spec.list.y, width: spec.list.w, height: spec.list.h, padding: PAD, overflow: 'hidden' }}>
            {spec.list.items.map((it, i) => <div key={i} style={{ height: LINE_PX, lineHeight: `${LINE_PX}px`, whiteSpace: 'pre' }}>{it}</div>)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
