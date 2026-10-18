import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ClassDots } from '../components/ClassDots'
import { Serif, Typewriter, Word } from '../components/Kinetic'
import { Shot } from '../components/Shot'
import { APPS_CHECKED, APPS_FOR_COACHES, ORIGINALITY_FOOTNOTE } from '../config'
import { ease, EASE, lin, rand } from '../lib/anim'
import { C, FONT } from '../theme'
import { T, typedLine } from '../timeline'

const O = T.origin
const COUNT_FRAMES = 96
const countAt = (f: number): number => Math.round(APPS_CHECKED * EASE.outCubic(lin(f, [6, COUNT_FRAMES], [0, 1])))
/** First frame the counter reaches `i` (so dot i pops in with its number). */
const frameFor = (i: number): number => {
  for (let f = 0; f <= COUNT_FRAMES; f++) if (countAt(f) > i) return f
  return COUNT_FRAMES
}

function Count() {
  const f = useCurrentFrame()
  const n = countAt(f)
  return (
    <AbsoluteFill>
      <ClassDots n={APPS_CHECKED} cx={1340} cy={520} size={330} layout="phyllo" dot={5} color="rgba(236,239,234,0.75)" litColor={C.green} appearAt={frameFor} spin={0.08} />
      <div style={{ position: 'absolute', left: 150, top: 300 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color: C.green }}>ORIGINALITY CHECK</div>
        <div style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: 300, lineHeight: 0.95, letterSpacing: '-0.04em', color: C.paper, fontVariantNumeric: 'tabular-nums' }}>
          {n}
          <span style={{ color: n >= APPS_CHECKED ? C.green : 'transparent' }}>+</span>
        </div>
        <Serif text="G2 apps we checked." at={O.serif - O.count} size={78} color={C.paper} />
      </div>
      <div style={{ position: 'absolute', left: 150, bottom: 110, fontFamily: FONT.mono, fontSize: 18, letterSpacing: '0.16em', color: C.muted }}>{ORIGINALITY_FOOTNOTE}</div>
    </AbsoluteFill>
  )
}

function Built() {
  const f = useCurrentFrame()
  const push = lin(f, [0, 120], [1, 1.12])
  const jitter = lin(f, [60, 120], [0, 4])
  return (
    <AbsoluteFill style={{ transform: `scale(${push}) translate(${(rand(f) - 0.5) * jitter}px, ${(rand(f + 9) - 0.5) * jitter}px)` }}>
      <div style={{ position: 'absolute', left: 170, top: 400, width: 1600 }}>
        <Typewriter line={typedLine('built')} frame={f + O.built} size={140} color={C.black} caret={C.orange} />
        <div style={{ marginTop: 30, fontFamily: FONT.mono, fontSize: 26, letterSpacing: '0.3em', color: 'rgba(7,9,10,0.55)', opacity: lin(f, [60, 70], [0, 1]) }}>
          COUNTING · {Math.floor(lin(f, [60, 118], [0, APPS_CHECKED]))} / {APPS_CHECKED}
        </div>
      </div>
    </AbsoluteFill>
  )
}

function Zero() {
  const f = useCurrentFrame()
  const shake = f < O.shakeEnd - O.zero ? (1 - f / (O.shakeEnd - O.zero)) * 26 : 0
  const sx = (rand(f * 1.7) - 0.5) * shake
  const sy = (rand(f * 2.3 + 4) - 0.5) * shake
  const burst = ease(f, [0, 26], [0, 1], EASE.outExpo)
  return (
    <AbsoluteFill style={{ transform: `translate(${sx}px, ${sy}px)` }}>
      <AbsoluteFill style={{ opacity: 1 - burst }}>
        <ClassDots n={APPS_CHECKED} cx={960} cy={520} size={330 + burst * 1300} layout="phyllo" dot={6} color={C.black} litColor={C.black} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', marginTop: -70 }}>
        <Word text={String(APPS_FOR_COACHES)} at={0} size={760} color={C.black} mode="slam" />
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 860, textAlign: 'center', fontFamily: FONT.mono, fontSize: 34, letterSpacing: '0.34em', color: C.black, opacity: lin(f, [6, 12], [0, 1]) }}>
        OF {APPS_CHECKED}+ · FOR COACHES & TEACHERS
      </div>
    </AbsoluteFill>
  )
}

function UntilNow() {
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <Serif text="until now." at={0} size={230} color={C.paper} stagger={6} />
    </AbsoluteFill>
  )
}

/** 1:36–1:48 · breakdown: 220+ apps counted, then on the drop, a giant 0, and "until now." */
export function Origin() {
  return (
    <>
      <Shot from={O.count} to={O.built}>
        <Count />
      </Shot>
      <Shot from={O.built} to={O.zero}>
        <Built />
      </Shot>
      <Shot from={O.zero} to={O.untilNow}>
        <Zero />
      </Shot>
      <Shot from={O.untilNow} to={T.control.autonomy} exit="whipL">
        <UntilNow />
      </Shot>
    </>
  )
}
