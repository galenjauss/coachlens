import type React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { SlotShot } from '../components/FootageSlot'
import { Serif } from '../components/Kinetic'
import { LensShot } from '../components/LensShot'
import { Shot } from '../components/Shot'
import { WireG2 } from '../components/WireG2'
import { ease, EASE, lin } from '../lib/anim'
import { C, FONT } from '../theme'
import { SECTIONS, SLOTS, T } from '../timeline'

const Q = T.quiet
const monoStep: React.CSSProperties = { fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color: C.green }

function G2() {
  const f = useCurrentFrame()
  const dollyStart = Q.dolly - Q.g2
  const yaw = lin(f, [0, dollyStart], [-58, -20])
  const pitch = lin(f, [0, dollyStart], [14, 8])
  const scale = 1.55 + lin(f, [0, dollyStart], [0, 0.25])
  const z = 1 + ease(f, [dollyStart, dollyStart + 30], [0, 1], EASE.inExpo) * 7
  const dispX = 960 + 184 * Math.cos((yaw * Math.PI) / 180) * scale
  const dispY = 520 + 6 * scale
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: `${dispX}px ${dispY}px`, opacity: lin(f, [dollyStart + 22, dollyStart + 30], [1, 0]) }}>
        <WireG2 yaw={yaw} pitch={pitch} scale={scale} cx={960} cy={520} draw={ease(f, [0, 42], [0, 1], EASE.inOut)} labels={lin(f, [30, 46], [0, 1])} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 860, display: 'flex', justifyContent: 'center', opacity: lin(f, [dollyStart, dollyStart + 12], [1, 0]) }}>
        <Serif text="dark until it matters." at={Q.serif - Q.g2} size={92} color={C.paper} stagger={5} />
      </div>
    </AbsoluteFill>
  )
}

const LENS_FRAMES = [
  { src: 'lens/dark/02.png', at: 0 },
  { src: 'lens/peekTick/01.png', at: Q.peek - Q.glass },
  { src: 'lens/peekTick/02.png', at: Q.peek - Q.glass + 30 },
  { src: 'lens/peekTick/03.png', at: Q.peek - Q.glass + 60 },
  { src: 'lens/lobby/02.png', at: Q.lobby - Q.glass },
  { src: 'lens/planning/01.png', at: Q.planning - Q.glass },
  { src: 'lens/planning/02.png', at: Q.planning - Q.glass + 15 },
  { src: 'lens/planning/03.png', at: Q.planning - Q.glass + 30 },
  { src: 'lens/planning/04.png', at: Q.planning - Q.glass + 45 },
  { src: 'lens/planResult/01.png', at: Q.planResult - Q.glass },
  { src: 'lens/planResult/02.png', at: Q.planResult - Q.glass + 12 },
  { src: 'lens/planResult/03.png', at: Q.diff - Q.glass },
] as const

const STEPS = [
  { at: Q.peek, n: '01 · PEEK', line: 'the drill, the clock, who is next.' },
  { at: Q.lobby, n: '02 · LOBBY', line: 'the plan, and one heads-up.' },
  { at: Q.planning, n: '03 · DOUBLE-TAP', line: 'plan the class out loud.' },
  { at: Q.diff, n: '04 · PLAN UPDATED', line: 'the diff lands. tap to keep it.' },
] as const

/** One continuous lens shot across the breakdown: global offset `g0` so both halves share one camera. */
function Lens({ g0 }: { g0: number }) {
  const f = useCurrentFrame() + (g0 - Q.glass)
  const rack = (cut: number, px: number) => (f >= cut && f < cut + 14 ? lin(f, [cut, cut + 14], [px, 0]) : 0)
  const focus = () => rack(Q.lobby - Q.glass, 9) + rack(Q.planning - Q.glass, 5) + rack(Q.diff - Q.glass, 6)
  const g = f + Q.glass
  const step = [...STEPS].reverse().find(s => s.at <= g)
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 46%, rgba(61,255,122,${lin(g, [Q.peek, Q.peek + 20], [0.03, 0.13])}), transparent 62%)` }} />
      <div style={{ marginTop: -70 }}>
        <Sequence from={-(g0 - Q.glass)} layout="none">
          <LensShot
            frames={LENS_FRAMES}
            scale={2}
            enter="fade"
            enterAt={-2}
            ry={[-15, -5]}
            rx={[8, 3]}
            dolly={[1.0, 1.2]}
            span={[0, SECTIONS.quiet.to - Q.glass]}
            xfade={3}
            focus={focus}
            taps={[Q.tap - Q.glass]}
            power={fr => (fr < Q.peek - Q.glass ? 1 : lin(fr, [Q.peek - Q.glass, Q.peek - Q.glass + 14], [0, 1]))}
          />
        </Sequence>
      </div>
      {step ? (
        <div key={step.n} style={{ position: 'absolute', left: 0, right: 0, top: 880, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <div style={{ ...monoStep, opacity: lin(g, [step.at, step.at + 8], [0, 1]) }}>{step.n}</div>
          <Serif text={step.line} at={step.at - g0} size={64} color={C.paper} />
        </div>
      ) : null}
    </AbsoluteFill>
  )
}

/** 0:24–0:40 · breakdown: wireframe G2, the dark lens, then peek → lobby → planning → plan diff. */
export function Quiet() {
  return (
    <>
      <Shot from={Q.g2} to={Q.glass}>
        <G2 />
      </Shot>
      <Shot from={Q.glass} to={SLOTS.A.from}>
        <Lens g0={Q.glass} />
      </Shot>
      <SlotShot
        id="A"
        from={SLOTS.A.from}
        to={SLOTS.A.to}
        label="LOBBY · PLAN OUT LOUD · THROUGH THE LENS"
        fallback={
          <Shot from={SLOTS.A.from} to={SLOTS.A.to}>
            <Lens g0={SLOTS.A.from} />
          </Shot>
        }
      />
    </>
  )
}
