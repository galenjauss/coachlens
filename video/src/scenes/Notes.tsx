import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { SlotShot } from '../components/FootageSlot'
import { Serif, Typewriter, Word } from '../components/Kinetic'
import { LensShot } from '../components/LensShot'
import { Shot } from '../components/Shot'
import { TypeCard } from '../components/TypeCard'
import { lin } from '../lib/anim'
import { C, FONT } from '../theme'
import { SLOTS, T, typedLine } from '../timeline'

const N = T.notes
const mono = (color: string): React.CSSProperties => ({ fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color })
const glow = (a: number) => <AbsoluteFill style={{ background: `radial-gradient(ellipse at 40% 50%, rgba(61,255,122,${a}), transparent 60%)` }} />

function Pr() {
  return (
    <AbsoluteFill>
      {glow(0.1)}
      <div style={{ position: 'absolute', left: 90, top: 250 }}>
        <LensShot
          frames={[
            { src: 'lens/pr/01.png', at: 0 },
            { src: 'lens/pr/02.png', at: 27 },
            { src: 'lens/pr/03.png', at: 54 },
          ]}
          scale={2}
          dolly={[0.92, 1.02]}
          ry={[-6, 4]}
          span={[0, 120]}
          xfade={0}
          punchAt={27}
        />
      </div>
      <div style={{ position: 'absolute', right: 120, top: 330, textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
        <div style={mono(C.green)}>PT · MON 6:00</div>
        <Word text="225" at={27} size={240} color={C.paper} mode="slam" />
        <div style={{ ...mono(C.paper), fontSize: 28 }}>LB · PR +10 · LOGGED</div>
      </div>
    </AbsoluteFill>
  )
}

function Brief() {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      {glow(0.12)}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 140, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <div style={mono(C.green)}>ASKED BETWEEN DRILLS</div>
        <Serif text="“How’s Priya doing?”" at={0} size={76} color={C.paper} />
      </div>
      <div style={{ position: 'absolute', left: 344, top: 300 }}>
        <LensShot
          frames={[
            { src: 'lens/brief/01.png', at: 0 },
            { src: 'lens/brief/02.png', at: 27 },
          ]}
          scale={2}
          dolly={[0.98, 1.22]}
          ry={[-9, -2]}
          rx={[7, 2]}
          span={[0, 135]}
          xfade={3}
          focus={fr => (fr >= 27 && fr < 40 ? lin(fr, [27, 40], [8, 0]) : 0)}
        />
      </div>
      <div style={{ position: 'absolute', right: 130, bottom: 150, opacity: lin(f, [42, 52], [0, 1]) }}>
        <Serif text="five lines. one glance." at={42} size={58} color={C.green} />
      </div>
    </AbsoluteFill>
  )
}

function Ask() {
  const f = useCurrentFrame()
  const a = N.answer - N.ask
  const nm = N.names.map(n => n - N.ask)
  return (
    <AbsoluteFill>
      {glow(0.1)}
      <div style={{ position: 'absolute', left: 140, right: 140, top: 130 }}>
        <div style={{ ...mono(C.green), marginBottom: 14 }}>ASK THE CLASS · OUT LOUD</div>
        <Typewriter line={typedLine('ask')} frame={f + N.ask} size={64} color={C.paper} caret={C.green} />
      </div>
      <div style={{ position: 'absolute', left: 344, top: 330 }}>
        <LensShot
          frames={[
            { src: 'lens/answer/01.png', at: 0 },
            { src: 'lens/answer/02.png', at: a },
          ]}
          scale={2}
          dolly={[0.95, 1.12]}
          ry={[8, 2]}
          rx={[6, 3]}
          span={[0, 150]}
          xfade={0}
          reveal={[
            { x: 62, y: 52, w: 244, h: 32, from: (nm[0] ?? a) - 2, to: (nm[2] ?? a) + 2, start: a },
            { x: 2, y: 84, w: 72, h: 28, from: (nm[3] ?? a) - 2, to: (nm[3] ?? a) + 3, start: a },
          ]}
          highlight={[{ x: 62, y: 54, w: 84, h: 28, from: (nm[0] ?? a) + 20, to: (nm[0] ?? a) + 30, color: 'rgba(255,91,31,0.38)' }]}
        />
      </div>
    </AbsoluteFill>
  )
}

function Roll() {
  const done = N.rollDone - N.roll
  return (
    <AbsoluteFill>
      {glow(0.1)}
      <div style={{ position: 'absolute', left: 120, top: 360, width: 520 }}>
        <div style={mono(C.green)}>ROLL CALL · BY VOICE</div>
        <div style={{ marginTop: 18 }}>
          <Serif text="“Everyone except Mia.”" at={0} size={82} color={C.paper} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 640, top: 250 }}>
        <LensShot
          frames={[
            { src: 'lens/rollCall/03.png', at: 0 },
            { src: 'lens/rollCall/04.png', at: 10 },
            { src: 'lens/rollCall/05.png', at: 16 },
            { src: 'lens/rollCall/06.png', at: done },
          ]}
          scale={2}
          dolly={[0.92, 1.04]}
          ry={[-14, -6]}
          span={[0, 105]}
          xfade={0}
          punchAt={done}
        />
      </div>
    </AbsoluteFill>
  )
}

/** Slot B's fallback: the PR card, a type card, the brief. Shots use global frames again. */
function SlotBFallback() {
  return (
    <>
      <Shot from={N.pr} to={N.checkCard} enter="whipL">
        <Pr />
      </Shot>
      <Shot from={N.checkCard} to={N.brief}>
        <TypeCard text="CHECK ON A KID" color={C.black} tag="ASK ABOUT ANYONE · BETWEEN DRILLS" />
      </Shot>
      <Shot from={N.brief} to={N.askCard} enter="whipL">
        <Brief />
      </Shot>
    </>
  )
}

/** 1:00–1:20 · drop: type cards on fields, alternating with the real lens captures. */
export function Notes() {
  return (
    <>
      <Shot from={N.prCard} to={N.pr}>
        <TypeCard text="LOG A PR" color={C.black} tag="SAY IT ONCE · IT'S ON THEIR RECORD" />
      </Shot>
      <SlotShot id="B" from={SLOTS.B.from} to={SLOTS.B.to} label="REAL G2 · REAL CLASS" fallback={<SlotBFallback />} />
      <Shot from={N.askCard} to={N.ask}>
        <TypeCard text="ASK THE CLASS" color={C.paper} tag="ANSWERS FROM YOUR OWN NOTES" />
      </Shot>
      <Shot from={N.ask} to={N.rollCard} enter="whipL">
        <Ask />
      </Shot>
      <Shot from={N.rollCard} to={N.roll}>
        <TypeCard text="TAKE ATTENDANCE" color={C.black} tag="ONE SENTENCE · WHOLE ROSTER" />
      </Shot>
      <Shot from={N.roll} to={T.notice.banner} enter="whipL">
        <Roll />
      </Shot>
    </>
  )
}
