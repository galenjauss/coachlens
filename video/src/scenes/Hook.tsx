import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ClassDots } from '../components/ClassDots'
import { Glitch, Serif, Word } from '../components/Kinetic'
import { AGENT_ACTIONS, MarqueeRow } from '../components/Marquee'
import { Shot } from '../components/Shot'
import { lin } from '../lib/anim'
import { C, FONT } from '../theme'
import { BEAT, T } from '../timeline'

const H = T.hook
const center: React.CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }

function Kids() {
  return (
    <AbsoluteFill>
      <ClassDots n={20} cx={960} cy={520} size={400} layout="ring" dot={13} color={C.black} litColor={C.black} spin={0.35} appearAt={i => Math.floor(i / 5) * BEAT + (i % 5) * 2} ringLine="rgba(7,9,10,0.25)" />
      <div style={{ ...center, gap: 40, marginTop: -40 }}>
        <Word text="20" at={0} size={400} color={C.black} mode="slam" />
        <Word text="kids." at={H.kidsWord - H.kids20} size={400} color={C.black} from="right" />
      </div>
      <div style={{ ...center, top: 690, alignItems: 'flex-start' }}>
        <Serif text="every one of them, watching you." at={H.kidsSerif - H.kids20} size={66} color={C.black} />
      </div>
    </AbsoluteFill>
  )
}

function Minutes() {
  const f = useCurrentFrame()
  const p = lin(f, [0, 60], [0, 1])
  const r = 420
  const mins = Math.floor(p * 45)
  return (
    <AbsoluteFill>
      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <circle cx={960} cy={520} r={r} fill="none" stroke="rgba(236,239,234,0.18)" strokeWidth={2} />
        <circle cx={960} cy={520} r={r} fill="none" stroke={C.paper} strokeWidth={10} pathLength={1} strokeDasharray={1} strokeDashoffset={1 - p} transform="rotate(-90 960 520)" strokeLinecap="round" />
        {Array.from({ length: 45 }).map((_, i) => {
          const a = (i / 45) * Math.PI * 2 - Math.PI / 2
          return <line key={i} x1={960 + Math.cos(a) * (r + 18)} y1={520 + Math.sin(a) * (r + 18)} x2={960 + Math.cos(a) * (r + (i % 5 === 0 ? 42 : 30))} y2={520 + Math.sin(a) * (r + (i % 5 === 0 ? 42 : 30))} stroke={C.paper} strokeWidth={i % 5 === 0 ? 3 : 1.5} opacity={i / 45 <= p ? 0.9 : 0.25} />
        })}
      </svg>
      <div style={{ ...center, gap: 36, marginTop: -40 }}>
        <Word text="45" at={0} size={330} color={C.paper} mode="slam" />
        <Word text="minutes." at={H.minWord - H.min45} size={330} color={C.paper} from="right" />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 760, textAlign: 'center', fontFamily: FONT.mono, fontSize: 30, letterSpacing: '0.3em', color: C.paper }}>
        CLASS CLOCK {String(mins).padStart(2, '0')}:{String(Math.floor((p * 45 * 60) % 60)).padStart(2, '0')} / 45:00
      </div>
    </AbsoluteFill>
  )
}

function OneCoach() {
  return (
    <AbsoluteFill>
      <div style={{ ...center, marginTop: -60 }}>
        <Word text="One coach." at={0} size={330} color={C.black} mode="letters" stagger={1.4} />
      </div>
      <div style={{ ...center, top: 640, alignItems: 'flex-start' }}>
        <Serif text="and exactly two hands." at={H.coachSerif - H.coach} size={72} color={C.black} />
      </div>
    </AbsoluteFill>
  )
}

function HandsFull() {
  const rows = [0, 1, 2, 3, 4, 5]
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: 0.32, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 }}>
        {rows.map(i => (
          <MarqueeRow key={i} words={AGENT_ACTIONS} size={84} color={C.paper} dot={C.orange} speed={(i % 2 ? 1 : -1) * (14 + i * 3)} outline={i % 2 === 0} offset={i * 400} />
        ))}
      </AbsoluteFill>
      <div style={center}>
        <Glitch text="Hands full?" at={0} size={290} color={C.paper} />
      </div>
    </AbsoluteFill>
  )
}

const TASKS: readonly { word: string; color: string; from: 'left' | 'right' | 'up' | 'down' }[] = [
  { word: 'FEEDBACK', color: C.paper, from: 'right' },
  { word: 'ATTENDANCE', color: C.black, from: 'left' },
  { word: 'PARENT EMAILS', color: C.black, from: 'down' },
  { word: 'REPORT CARDS', color: C.paper, from: 'right' },
]

function Task({ i }: { i: number }) {
  const t = TASKS[i]
  if (!t) return null
  const size = Math.min(300, 1720 / (t.word.length * 0.66))
  return (
    <AbsoluteFill>
      <div style={center}>
        <Word text={t.word} at={-2} size={size} color={t.color} from={t.from} distance={700} snappy />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 740, textAlign: 'center', fontFamily: FONT.mono, fontSize: 26, letterSpacing: '0.32em', color: t.color, opacity: 0.75 }}>
        {`TASK 0${i + 1} / 04 · WHILE YOU TEACH`}
      </div>
    </AbsoluteFill>
  )
}

function NoProblem() {
  return (
    <AbsoluteFill>
      <ClassDots n={20} cx={960} cy={520} size={430} layout="ring" dot={11} color={C.black} litColor={C.black} spin={-0.5} appearAt={i => i} />
      <div style={{ ...center, marginTop: -50 }}>
        <Word text="No problem." at={0} size={300} color={C.black} mode="slam" />
      </div>
      <div style={{ ...center, top: 650, alignItems: 'flex-start' }}>
        <Serif text="coaching, heads-up." at={H.noSerif - H.noProblem} size={84} color={C.black} />
      </div>
    </AbsoluteFill>
  )
}

/** 0:00–0:12 · beat-cut kinetic type on flipping fields. */
export function Hook() {
  return (
    <>
      <Shot from={H.kids20} to={H.min45} exit="whipL">
        <Kids />
      </Shot>
      <Shot from={H.min45} to={H.coach} enter="whipL" exit="whipU">
        <Minutes />
      </Shot>
      <Shot from={H.coach} to={H.hands} enter="whipU">
        <OneCoach />
      </Shot>
      <Shot from={H.hands} to={H.tasks[0]}>
        <HandsFull />
      </Shot>
      {TASKS.map((_, i) => (
        <Shot key={i} from={H.tasks[i] ?? 0} to={H.tasks[i + 1] ?? H.noProblem}>
          <Task i={i} />
        </Shot>
      ))}
      <Shot from={H.noProblem} to={T.reveal.classStart}>
        <NoProblem />
      </Shot>
    </>
  )
}
