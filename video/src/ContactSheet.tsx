import { AbsoluteFill, Img, staticFile } from 'remotion'

/** Dev tool: a 10×6 grid of preview frames from public/_sheet/fNNN.jpg (2 fps), for pacing review. */
export function ContactSheet({ start }: { start: number }) {
  return (
    <AbsoluteFill style={{ background: '#111', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start' }}>
      {Array.from({ length: 60 }).map((_, i) => {
        const n = start + i
        return (
          <div key={i} style={{ width: 192, height: 120, position: 'relative' }}>
            <Img src={staticFile(`_sheet/f${String(n).padStart(3, '0')}.jpg`)} style={{ width: 190, height: 107 }} />
            <div style={{ position: 'absolute', left: 2, bottom: 0, fontSize: 12, color: '#ff0', fontFamily: 'monospace' }}>{((n - 1) / 2).toFixed(1)}s</div>
          </div>
        )
      })}
    </AbsoluteFill>
  )
}
