import type React from 'react'
import { AbsoluteFill } from 'remotion'
import { Serif, Word } from '../components/Kinetic'
import { LensShot } from '../components/LensShot'
import { PhoneShot } from '../components/PhoneShot'
import { Shot } from '../components/Shot'
import { C, FIELD, FONT } from '../theme'
import { T } from '../timeline'

const N = T.notice
const mono = (color: string): React.CSSProperties => ({ fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color })

function Banner() {
  const slam = N.slam - N.banner
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 130, top: 330, width: 640 }}>
        <div style={mono(FIELD.orange.soft)}>INSIGHTS AGENT · MID-DRILL</div>
        <div style={{ marginTop: 14 }}>
          <Word text="Heads-up." at={slam} size={150} color={C.black} mode="slam" />
        </div>
        <div style={{ marginTop: 16 }}>
          <Serif text="agents that notice." at={N.serif - N.banner} size={80} color={C.black} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 700, top: 280 }}>
        <LensShot
          frames={[
            { src: 'lens/banner/01.png', at: 0 },
            { src: 'lens/banner/02.png', at: slam },
          ]}
          scale={2}
          dolly={[0.8, 0.9]}
          ry={[-15, -9]}
          span={[0, 90]}
          xfade={0}
          punchAt={slam}
        />
      </div>
    </AbsoluteFill>
  )
}

function Phone() {
  const s = N.scroll - N.phone
  const w = N.working - N.phone
  const d = N.drafted - N.phone
  const rt = N.reviewTap - N.phone
  const rv = N.review - N.phone
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 66% 50%, rgba(242,193,78,0.22), transparent 58%)' }} />
      <div style={{ position: 'absolute', left: 130, top: 300, width: 760 }}>
        <div style={mono(C.amber)}>FROM YOUR AGENTS · TODAY</div>
        <div style={{ marginTop: 18, height: 190, position: 'relative' }}>
          <Word text="Do it." at={w} size={190} color={C.paper} mode="slam" exitAt={rv - 4} exitTo="up" />
          <div style={{ position: 'absolute', inset: 0 }}>
            <Word text="Review." at={rv} size={190} color={C.paper} from="down" distance={400} />
          </div>
        </div>
        <div style={{ marginTop: 26 }}>
          <Serif text="drafted, then it waits for your OK." at={d + 6} size={64} color={C.amber} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1090, top: 70 }}>
        <PhoneShot
          screens={[
            { src: 'phone/today/03.png', at: 0 },
            { src: 'phone/doIt/02.png', at: s, enter: 'scroll' },
            { src: 'phone/doIt/03.png', at: d, enter: 'fade' },
            { src: 'phone/doIt/04.png', at: rv, enter: 'slide' },
          ]}
          height={880}
          ry={[-22, -12]}
          rx={[7, 3]}
          span={[0, 195]}
          cam={[
            { f: s, s: 1, x: 215, y: 466 },
            { f: s + 16, s: 1.55, x: 215, y: 420 },
            { f: d + 24, s: 1.55, x: 215, y: 420 },
            { f: rt - 6, s: 1, x: 215, y: 466 },
            { f: rv + 6, s: 1, x: 215, y: 466 },
            { f: rv + 30, s: 1.45, x: 215, y: 300 },
          ]}
          cursor={[
            { f: 26, x: 330, y: 700 },
            { f: w - 3, x: 230, y: 818 },
            { f: w + 12, x: 175, y: 468 },
            { f: d + 18, x: 178, y: 470 },
            { f: rt - 2, x: 161, y: 900 },
            { f: rv + 10, x: 161, y: 900 },
          ]}
          taps={[w, rt]}
        />
      </div>
    </AbsoluteFill>
  )
}

const INSIGHTS = [
  { name: 'GUS', what: 'READY TO TEST' },
  { name: 'NOAH', what: 'GRADE DROP' },
  { name: 'ELI', what: 'NO FEEDBACK' },
]

/** Three insights stack on eighth notes and hold as one readable card. */
function Insights() {
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 150, top: 190, ...mono(FIELD.cobalt.soft), fontSize: 24 }}>3 OF 7 INSIGHTS · THE AGENTS NOTICED</div>
      <div style={{ position: 'absolute', left: 140, top: 270, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {INSIGHTS.map((it, i) => (
          <div key={it.name} style={{ height: 170, display: 'flex', alignItems: 'center' }}>
            <Word text={`${it.name} · ${it.what}`} at={(N.words[i] ?? N.words[0]) - N.words[0] - 1} size={150} color={C.paper} from={i % 2 ? 'left' : 'right'} distance={700} snappy />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

function Wrapup() {
  const m = N.missed - N.wrapup
  const tap = N.tap - N.wrapup
  const nc = N.nextClass - N.wrapup
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(61,255,122,0.12), transparent 60%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 140, display: 'flex', justifyContent: 'center' }}>
        <div style={mono(C.green)}>DOUBLE-TAP · END CLASS · THE WRAP-UP</div>
      </div>
      <div style={{ position: 'absolute', left: 344, top: 220 }}>
        <LensShot
          frames={[
            { src: 'lens/wrapup/01.png', at: 0 },
            { src: 'lens/wrapup/02.png', at: 10 },
            { src: 'lens/wrapup/03.png', at: 18 },
            { src: 'lens/wrapup/04.png', at: 26 },
          ]}
          scale={2}
          dolly={[0.98, 1.14]}
          ry={[10, 3]}
          rx={[6, 2]}
          span={[0, 135]}
          xfade={2}
          taps={[tap]}
          highlight={[
            { x: 2, y: 82, w: 150, h: 27, from: m, to: m + 14, color: 'rgba(255,91,31,0.42)' },
            { x: 2, y: 206, w: 268, h: 27, from: nc - 4, to: nc + 10, color: 'rgba(61,255,122,0.22)' },
          ]}
        />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 900, display: 'flex', justifyContent: 'center' }}>
        <Serif text="Eli and Fay go first, next class." at={nc} size={70} color={C.paper} />
      </div>
    </AbsoluteFill>
  )
}

/** 1:20–1:36 · the ★ banner, Do it on the phone, insight flash-bys, the wrap-up. */
export function Notice() {
  return (
    <>
      <Shot from={N.banner} to={N.phone} exit="whipL">
        <Banner />
      </Shot>
      <Shot from={N.phone} to={N.words[0]} enter="whipL">
        <Phone />
      </Shot>
      <Shot from={N.words[0]} to={N.wrapup}>
        <Insights />
      </Shot>
      <Shot from={N.wrapup} to={T.origin.count} enter="whipL">
        <Wrapup />
      </Shot>
    </>
  )
}
