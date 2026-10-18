import { useEffect, useRef, useState } from 'react'
import { NOD } from '../config'
import { bus, type ImuSampleEvent } from '../core/bus'
import { readImuDebug, writeImuDebug } from '../core/imuDebug'
import type { KV } from '../core/storage'

const WINDOW_MS = 2000
type Axis = 'x' | 'y' | 'z'
const AXES: Axis[] = ['x', 'y', 'z']
type Stamped = ImuSampleEvent & { t: number }
interface View { last: Stamped; range: Record<Axis, [number, number]>; hz: number; nods: number }

const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(2)

/** Live x/y/z, the swing of each axis over the last 2 s, and the sample rate. */
function summarize(buf: Stamped[], nods: number): View | null {
  const last = buf.at(-1)
  if (!last) return null
  const range = Object.fromEntries(AXES.map(a => [a, [Math.min(...buf.map(s => s[a])), Math.max(...buf.map(s => s[a]))]])) as View['range']
  const span = buf.length > 1 ? (last.t - buf[0]!.t) / 1000 : 0
  return { last, range, hz: span > 0 ? (buf.length - 1) / span : 0, nods }
}

/** The saved "show motion readout" flag, kept in sync with every switch (toggle, Hide, URL). */
function useImuDebugFlag(kv: KV): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    void readImuDebug(kv).then(v => { if (live) setOn(v) })
    const off = bus.on('imuDebug', setOn)
    return () => { live = false; off() }
  }, [kv])
  return on
}

/** Settings switch for the readout (works in a Beta build, no URL params needed). */
export function MotionToggle({ kv }: { kv: KV }) {
  const on = useImuDebugFlag(kv)
  return (
    <details className="card">
      <summary className="label">Settings</summary>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input type="checkbox" checked={on} onChange={e => { void writeImuDebug(kv, e.currentTarget.checked) }} />
        Show motion readout (nod calibration)
      </label>
    </details>
  )
}

/**
 * Nod calibration readout, fed by the lens over the bus. While it is shown the lens keeps the IMU on,
 * so it works before a class starts. Shows "waiting" until the IMU reports.
 */
export function ImuDebug({ kv }: { kv: KV }) {
  const on = useImuDebugFlag(kv)
  const [view, setView] = useState<View | null>(null)
  const buf = useRef<Stamped[]>([])
  const nods = useRef(0)

  useEffect(() => {
    if (!on) return
    return bus.on('imuSample', s => {
      const t = Date.now()
      if (s.nod) nods.current += 1
      buf.current = [...buf.current.filter(x => t - x.t <= WINDOW_MS), { ...s, t }]
      setView(summarize(buf.current, nods.current))
    })
  }, [on])

  if (!on) return null
  return (
    <aside aria-label="Motion readout" style={{
      margin: '8px 16px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
      background: 'var(--card)', color: 'var(--text)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>Motion · nod calibration</strong>
        <button type="button" onClick={() => { void writeImuDebug(kv, false) }} style={{ font: 'inherit' }}>Hide</button>
      </div>
      {!view ? <p className="muted" role="status">Waiting for motion samples from the glasses…</p> : (
        <>
          <div aria-live="off">
            {AXES.map(a => (
              <div key={a} style={{ fontWeight: a === NOD.axis ? 700 : 400 }}>
                {a}: {fmt(view.last[a])}   swing {fmt(view.range[a][0])} … {fmt(view.range[a][1])} ({(view.range[a][1] - view.range[a][0]).toFixed(2)})
              </div>
            ))}
          </div>
          <div className="muted">{view.hz.toFixed(1)} samples/s · nods detected: {view.nods}</div>
        </>
      )}
      <div className="muted">config: {NOD.enabled ? '' : 'NOD OFF · '}axis {NOD.axis} · threshold {NOD.threshold} · within {NOD.windowMs} ms</div>
    </aside>
  )
}
