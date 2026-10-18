import { useEffect, useRef, useState } from 'react'
import { NOD } from '../config'
import { bus, type ImuSampleEvent } from '../core/bus'
import { isImuDebugOn, setImuDebug } from '../core/imuDebug'

const WINDOW_MS = 2000
type Axis = 'x' | 'y' | 'z'
const AXES: Axis[] = ['x', 'y', 'z']
type Stamped = ImuSampleEvent & { t: number }
interface View { last: Stamped; range: Record<Axis, [number, number]>; hz: number; nods: number }

const fmt = (v: number) => (v >= 0 ? ' ' : '') + v.toFixed(2)

/** Live x/y/z, the swing of each axis over the last 2 s, and the sample rate, from the lens via the bus. */
function summarize(buf: Stamped[], nods: number): View | null {
  const last = buf.at(-1)
  if (!last) return null
  const range = Object.fromEntries(AXES.map(a => [a, [Math.min(...buf.map(s => s[a])), Math.max(...buf.map(s => s[a]))]])) as View['range']
  const span = buf.length > 1 ? (last.t - buf[0]!.t) / 1000 : 0
  return { last, range, hz: span > 0 ? (buf.length - 1) / span : 0, nods }
}

/**
 * Nod calibration readout (open the app with `?imu=1`; Hide turns it off). While it is open the lens
 * keeps the IMU on, so it works before a class starts. Shows nothing until the IMU reports.
 */
export function ImuDebug() {
  const [on, setOn] = useState(isImuDebugOn)
  const [view, setView] = useState<View | null>(null)
  const buf = useRef<Stamped[]>([])
  const nods = useRef(0)

  useEffect(() => {
    if (!on) return
    bus.emit('imuDebug', true)
    const off = bus.on('imuSample', s => {
      const t = Date.now()
      if (s.nod) nods.current += 1
      buf.current = [...buf.current.filter(x => t - x.t <= WINDOW_MS), { ...s, t }]
      setView(summarize(buf.current, nods.current))
    })
    return () => { off(); bus.emit('imuDebug', false) }
  }, [on])

  if (!on) return null
  const hide = () => { setImuDebug(false); setOn(false) }
  return (
    <aside aria-label="IMU calibration" style={{
      margin: '8px 16px', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
      background: 'var(--card)', color: 'var(--text)', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 13, lineHeight: 1.5,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>IMU · nod calibration</strong>
        <button type="button" onClick={hide} style={{ font: 'inherit' }}>Hide</button>
      </div>
      {!view ? <p className="muted" role="status">Waiting for IMU samples from the glasses…</p> : (
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
      <div className="muted">config: axis {NOD.axis} · threshold {NOD.threshold} · within {NOD.windowMs} ms</div>
    </aside>
  )
}
