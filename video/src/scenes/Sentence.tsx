import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Connectors } from '../components/Connectors'
import { Serif, Typewriter, Word } from '../components/Kinetic'
import { LensShot } from '../components/LensShot'
import { PhoneShot } from '../components/PhoneShot'
import { Shot } from '../components/Shot'
import { lin } from '../lib/anim'
import { C, FIELD, FONT } from '../theme'
import { T, typedLine } from '../timeline'

const S = T.sentence
const mono = (color: string): React.CSSProperties => ({ fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color })

function Rec() {
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 150, top: 300, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Word text="Tap." at={0} size={230} color={C.paper} mode="slam" />
        <Word text="Talk." at={S.talk - S.rec} size={230} color={C.paper} from="left" distance={600} />
        <div style={{ ...mono(FIELD.cobalt.soft), marginTop: 30 }}>TEMPLE TAP · THE G2 MIC LISTENS</div>
      </div>
      <div style={{ position: 'absolute', left: 690, top: 260 }}>
        <LensShot
          frames={[
            { src: 'lens/recording/01.png', at: 0 },
            { src: 'lens/recording/02.png', at: 8 },
            { src: 'lens/recording/03.png', at: 20 },
            { src: 'lens/recording/04.png', at: 32 },
            { src: 'lens/recording/05.png', at: 44 },
          ]}
          scale={2}
          dolly={[0.8, 0.88]}
          ry={[-16, -10]}
          span={[0, 60]}
          xfade={0}
          taps={[0]}
        />
      </div>
    </AbsoluteFill>
  )
}

function Typed() {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 1500 }}>
        <div style={{ ...mono(C.green), marginBottom: 26 }}>COACH, MID-DRILL · SPOKEN, NOT TYPED</div>
        <Typewriter line={typedLine('priya')} frame={f + S.typed} size={112} color={C.paper} caret={C.green} />
      </div>
    </AbsoluteFill>
  )
}

const STAGES = ['HEARD', 'SENDING', 'THINKING', 'CARD', 'AGENTS'] as const
const STAGE_AT = [0, 6, 12, 48, 54]

function Card() {
  const f = useCurrentFrame()
  const stage = STAGE_AT.reduce((acc, a, i) => (f >= a ? i : acc), 0)
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(61,255,122,0.12), transparent 60%)' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, display: 'flex', justifyContent: 'center', gap: 46 }}>
        {STAGES.map((s, i) => (
          <div key={s} style={{ ...mono(i <= stage ? C.green : 'rgba(236,239,234,0.25)'), display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ width: 10, height: 10, borderRadius: 10, background: i <= stage ? C.green : 'transparent', border: `1.5px solid ${i <= stage ? C.green : 'rgba(236,239,234,0.25)'}`, boxShadow: i === stage ? `0 0 12px ${C.green}` : undefined }} />
            {s}
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 344, top: 250 }}>
        <LensShot
          frames={[
            { src: 'lens/note/01.png', at: 0 },
            { src: 'lens/note/02.png', at: 6 },
            { src: 'lens/note/03.png', at: 12 },
            { src: 'lens/note/04.png', at: 18 },
            { src: 'lens/note/05.png', at: 24 },
            { src: 'lens/note/06.png', at: 48 },
            { src: 'lens/note/07.png', at: 54 },
            { src: 'lens/note/08.png', at: 60 },
            { src: 'lens/note/09.png', at: 68 },
            { src: 'lens/note/10.png', at: 76 },
          ]}
          scale={2}
          enter="pop"
          dolly={[0.96, 1.1]}
          ry={[-10, -3]}
          rx={[6, 2]}
          span={[0, 120]}
          xfade={0}
          punchAt={48}
        />
      </div>
      <Connectors from={[1540, 560]} to={[[2000, 300], [2000, 460], [2000, 640], [2000, 800]]} at={i => 108 + i * 2} dur={10} color={C.green} />
    </AbsoluteFill>
  )
}

const OUTCOMES = [
  { word: 'PROGRESS', sub: '3rd time → now a pattern' },
  { word: 'REPORT CARD', sub: 'note added for the term' },
  { word: 'NEXT PLAN', sub: 'guard drill goes first' },
  { word: 'COVERAGE', sub: '7 of 12 kids got feedback' },
] as const

function Summary() {
  const rows = OUTCOMES.map((o, i) => [1040, 210 + i * 175] as [number, number])
  const land = (i: number) => Math.round(i * 7.5) + 2
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 110, top: 330 }}>
        <LensShot frames={[{ src: 'lens/note/10.png', at: 0 }]} scale={1} enter="pop" ry={[12, 6]} rx={[4, 2]} dolly={[1.25, 1.35]} span={[0, 105]} />
      </div>
      <Connectors from={[790, 540]} to={rows.map(([x, y]) => [x - 30, y + 40] as [number, number])} at={i => land(i) - 4} dur={8} color={C.paper} />
      {OUTCOMES.map((o, i) => (
        <div key={o.word} style={{ position: 'absolute', left: rows[i]?.[0] ?? 0, top: rows[i]?.[1] ?? 0 }}>
          <Word text={o.word} at={land(i)} size={104} color={C.paper} from="right" distance={360} snappy />
          <div style={{ ...mono(FIELD.cobalt.soft), fontSize: 24, marginTop: 6 }}>{o.sub.toUpperCase()}</div>
        </div>
      ))}
    </AbsoluteFill>
  )
}

function Urgent() {
  const at = S.urgentLens - S.urgent
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 330 }}>
        <Word text="Urgent?" at={0} size={180} color={C.black} mode="slam" />
        <div style={{ marginTop: 20 }}>
          <Serif text="the parent hears tonight." at={at + 20} size={66} color={C.black} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 740, top: 270 }}>
        <LensShot
          frames={[
            { src: 'lens/urgent/01.png', at },
            { src: 'lens/urgent/02.png', at: at + 21 },
            { src: 'lens/urgent/03.png', at: at + 40 },
            { src: 'lens/urgent/04.png', at: at + 60 },
          ]}
          scale={2}
          enterAt={at - 4}
          dolly={[0.8, 0.88]}
          ry={[-14, -8]}
          span={[at, at + 105]}
          xfade={0}
          punchAt={at + 21}
        />
      </div>
    </AbsoluteFill>
  )
}

function Phone() {
  const z = S.phoneZoom - S.phone
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 70% 50%, rgba(43,70,255,0.35), transparent 60%)' }} />
      <div style={{ position: 'absolute', left: 140, top: 300 }}>
        <div style={mono(C.green)}>PARENT EMAIL AGENT · REVIEW</div>
        <div style={{ marginTop: 20 }}>
          <Word text="Drafted." at={10} size={190} color={C.paper} from="left" distance={500} />
        </div>
        <div style={{ marginTop: 18 }}>
          <Serif text="you decide when it sends." at={z} size={70} color={C.green} />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 1080, top: 60 }}>
        <PhoneShot
          screens={[{ src: 'phone/review/01.png', at: 0 }]}
          height={900}
          enterAt={0}
          ry={[-24, -12]}
          rx={[8, 4]}
          span={[0, 120]}
          cam={[{ f: z, s: 1, x: 215, y: 466 }, { f: z + 28, s: 1.75, x: 215, y: 230 }, { f: z + 80, s: 1.9, x: 260, y: 290 }]}
          cursor={[{ f: z + 34, x: 120, y: 420 }, { f: z + 60, x: 340, y: 323 }, { f: z + 88, x: 342, y: 325 }]}
        />
      </div>
    </AbsoluteFill>
  )
}

/** 0:40–1:00 · drop: tap, talk, the real card and its agent ticks, outcomes, Dee's urgent note, the draft. */
export function Sentence() {
  return (
    <>
      <Shot from={S.rec} to={S.typed} exit="whipL">
        <Rec />
      </Shot>
      <Shot from={S.typed} to={S.card} enter="whipL">
        <Typed />
      </Shot>
      <Shot from={S.card} to={S.summary}>
        <Card />
      </Shot>
      <Shot from={S.summary} to={S.urgent} exit="whipL">
        <Summary />
      </Shot>
      <Shot from={S.urgent} to={S.phone} enter="whipL" exit="whipL">
        <Urgent />
      </Shot>
      <Shot from={S.phone} to={T.notes.prCard} enter="whipL">
        <Phone />
      </Shot>
    </>
  )
}
