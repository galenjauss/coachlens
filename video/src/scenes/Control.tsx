import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { SlotShot } from '../components/FootageSlot'
import { Serif, Word } from '../components/Kinetic'
import { PhoneShot } from '../components/PhoneShot'
import { Shot } from '../components/Shot'
import { TypeCard } from '../components/TypeCard'
import { ease, EASE, lin } from '../lib/anim'
import { C, FIELD, FONT } from '../theme'
import { SECTIONS, SLOTS, T } from '../timeline'

const K = T.control
const mono = (color: string): React.CSSProperties => ({ fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color })

function Autonomy() {
  const f = useCurrentFrame()
  const tap = K.tapReview - K.autonomy
  const chosen = f >= tap
  const word = (t: string, at: number, active: boolean) => (
    <div style={{ opacity: chosen && !active ? 0.28 : 1, height: 150 }}>
      <Word text={t} at={at} size={150} color={chosen && active ? C.green : C.paper} from="left" distance={500} />
    </div>
  )
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 250 }}>
        <div style={{ ...mono(FIELD.cobalt.soft), marginBottom: 20 }}>EVERY AGENT · HOW MUCH ON ITS OWN?</div>
        {word('Auto.', 4, false)}
        {word('Review.', 19, true)}
        {word('Off.', 34, false)}
        <div style={{ marginTop: 30, opacity: lin(f, [tap + 8, tap + 16], [0, 1]) }}>
          <Serif text="nothing sends without your OK." at={tap + 8} size={60} color={C.paper} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1080, top: 70 }}>
        <PhoneShot
          screens={[
            { src: 'phone/parentEmail/01.png', at: 0 },
            { src: 'phone/parentEmail/02.png', at: tap + 1 },
          ]}
          height={880}
          ry={[-22, -10]}
          rx={[7, 3]}
          span={[0, 120]}
          cam={[{ f: 10, s: 1, x: 215, y: 466 }, { f: 40, s: 1.25, x: 215, y: 300 }, { f: tap + 4, s: 1.25, x: 215, y: 300 }, { f: tap + 30, s: 1.9, x: 215, y: 230 }]}
          cursor={[{ f: 30, x: 320, y: 640 }, { f: tap - 3, x: 215, y: 196 }, { f: tap + 50, x: 220, y: 200 }]}
          taps={[tap]}
        />
      </div>
    </AbsoluteFill>
  )
}

function Agents() {
  const lines = [
    { t: 'Red needs you.', c: C.red, at: 15 },
    { t: 'Amber waits.', c: C.amber, at: 30 },
    { t: 'Green is done.', c: C.green, at: 45 },
  ]
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(61,255,122,0.10), transparent 55%)' }} />
      <div style={{ position: 'absolute', left: 200, top: 70 }}>
        <PhoneShot
          screens={[{ src: 'phone/agents/01.png', at: 0 }]}
          height={880}
          enterFrom="left"
          ry={[22, 12]}
          rx={[7, 3]}
          span={[0, 105]}
          cam={[{ f: 8, s: 1, x: 215, y: 466 }, { f: 70, s: 1.4, x: 215, y: 330 }, { f: 105, s: 1.5, x: 215, y: 380 }]}
        />
      </div>
      <div style={{ position: 'absolute', left: 860, top: 300 }}>
        <div style={{ ...mono(C.green), marginBottom: 20 }}>AGENTS · ONE TILE EACH · LIVE</div>
        {lines.map(l => (
          <div key={l.t} style={{ height: 130 }}>
            <Word text={l.t} at={l.at} size={118} color={l.c} from="right" distance={500} />
          </div>
        ))}
      </div>
    </AbsoluteFill>
  )
}

function Priya() {
  const s3 = K.priya3 - K.priya
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 320, width: 820 }}>
        <div style={{ ...mono(FIELD.cobalt.soft), marginBottom: 16 }}>STUDENT PROFILE · PRIYA RAO</div>
        <Word text="Her file," at={4} size={170} color={C.paper} mode="slam" />
        <div style={{ marginTop: 18 }}>
          <Serif text="written while you coach." at={8} size={76} color={C.paper} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1080, top: 70 }}>
        <PhoneShot
          screens={[
            { src: 'phone/priya/01.png', at: 0 },
            { src: 'phone/priya/03.png', at: s3, enter: 'scroll' },
          ]}
          height={880}
          ry={[-22, -12]}
          rx={[7, 3]}
          span={[0, 105]}
          cam={[{ f: 6, s: 1, x: 215, y: 466 }, { f: 45, s: 1.6, x: 215, y: 250 }, { f: s3 - 2, s: 1.6, x: 215, y: 250 }, { f: s3 + 20, s: 1.2, x: 215, y: 420 }]}
        />
      </div>
    </AbsoluteFill>
  )
}

const MONTAGE = [
  { src: 'phone/insights/02.png', label: 'INSIGHTS', from: 'right' as const },
  { src: 'phone/deck/02.png', label: 'PLANS', from: 'left' as const },
  { src: 'phone/today/04.png', label: 'DRILL DECKS', from: 'right' as const },
  { src: 'phone/review/02.png', label: 'DRAFTS', from: 'left' as const },
]

function Montage({ i }: { i: number }) {
  const m = MONTAGE[i]
  if (!m) return null
  const left = i % 2 === 0
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: left ? 1100 : 300, top: 90 }}>
        <PhoneShot screens={[{ src: m.src, at: 0 }]} height={860} enterAt={-8} enterFrom={m.from} ry={left ? [-20, -16] : [20, 16]} span={[0, 22]} cam={[{ f: 0, s: 1.05, x: 215, y: 420 }, { f: 22, s: 1.18, x: 215, y: 400 }]} />
      </div>
      <div style={{ position: 'absolute', left: left ? 150 : 900, top: 420 }}>
        <Word text={m.label} at={-3} size={150} color={C.paper} from={left ? 'left' : 'right'} distance={400} snappy />
        <div style={{ ...mono(C.green), marginTop: 10 }}>{`0${i + 1} / 04 · ON YOUR PHONE`}</div>
      </div>
    </AbsoluteFill>
  )
}

function Teach() {
  const f = useCurrentFrame()
  const end = SECTIONS.finale.from - K.teach
  const z = 1 + ease(f, [end - 16, end], [0, 1], EASE.inExpo) * 3
  return (
    <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: '1290px 640px' }}>
      <div style={{ position: 'absolute', left: 140, top: 340 }}>
        <div style={{ ...mono(FIELD.green.soft), marginBottom: 14 }}>SET UP · STEP 1 OF 6</div>
        <Word text="What do" at={-8} size={160} color={C.black} mode="letters" stagger={0.6} />
        <Word text="you teach?" at={-4} size={160} color={C.black} mode="letters" stagger={0.6} />
      </div>
      <div style={{ position: 'absolute', left: 1080, top: 70 }}>
        <PhoneShot
          screens={[{ src: 'phone/onboarding/01.png', at: 0 }]}
          height={880}
          enterAt={-4}
          enterFrom="bottom"
          ry={[-18, -8]}
          rx={[6, 2]}
          span={[0, end]}
          cam={[{ f: 0, s: 1.15, x: 215, y: 380 }, { f: end - 8, s: 1.5, x: 215, y: 420 }]}
          cursor={[{ f: 2, x: 215, y: 268 }, { f: 8, x: 215, y: 345 }, { f: 14, x: 215, y: 422 }, { f: 20, x: 215, y: 500 }]}
        />
      </div>
    </AbsoluteFill>
  )
}

/** Slot C's fallback: the real phone flow. Shots use global frames again. */
function SlotCFallback() {
  return (
    <>
      <Shot from={K.autonomy} to={K.card} enter="whipL">
        <Autonomy />
      </Shot>
      <Shot from={K.card} to={K.agents}>
        <TypeCard text="YOUR CALL." color={C.black} tag="AUTO · REVIEW · OFF, PER AGENT" mode="slam" />
      </Shot>
      <Shot from={K.agents} to={K.kidCard} enter="whipR">
        <Agents />
      </Shot>
      <Shot from={K.kidCard} to={K.priya}>
        <TypeCard text="EVERY KID" color={C.black} tag="A FILE THAT WRITES ITSELF" />
      </Shot>
      <Shot from={K.priya} to={K.montage[0]} enter="whipL" exit="whipL">
        <Priya />
      </Shot>
      {MONTAGE.map((_, i) => (
        <Shot key={i} from={K.montage[i] ?? 0} to={K.montage[i + 1] ?? K.teach} enter={i === 0 ? 'whipL' : i % 2 ? 'whipR' : 'whipL'} exit={i < 3 ? (i % 2 ? 'whipL' : 'whipR') : 'cut'}>
          <Montage i={i} />
        </Shot>
      ))}
    </>
  )
}

/** 1:48–2:04 · drop: Auto · Review · Off, the agents, a kid's file, a phone montage, "What do you teach?" */
export function Control() {
  return (
    <>
      <SlotShot id="C" from={SLOTS.C.from} to={SLOTS.C.to} label="ON YOUR PHONE" portrait fallback={<SlotCFallback />} />
      <Shot from={K.teach} to={SECTIONS.finale.from}>
        <Teach />
      </Shot>
    </>
  )
}
