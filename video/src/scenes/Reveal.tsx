import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { ClassDots } from '../components/ClassDots'
import { IrisReveal } from '../components/Iris'
import { Serif, Word } from '../components/Kinetic'
import { LensIcon } from '../components/LensIcon'
import { AGENT_ACTIONS, CurvedMarquee, MarqueeRow } from '../components/Marquee'
import { Shot } from '../components/Shot'
import { ease, lin, pop } from '../lib/anim'
import { C, FONT } from '../theme'
import { T } from '../timeline'

const R = T.reveal
const LIT = [7, 13]
const mono: React.CSSProperties = { fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.3em', color: 'rgba(236,239,234,0.6)' }

function TheClass() {
  const f = useCurrentFrame()
  const clock = lin(f, [0, 120], [0, 45 * 60])
  const given = f >= R.lit2 - R.classStart ? 2 : f >= R.lit1 - R.classStart ? 1 : 0
  const bump = pop(f, given === 2 ? R.lit2 - R.classStart : R.lit1 - R.classStart, 300, 10, 0.5)
  return (
    <AbsoluteFill>
      <ClassDots n={20} cx={560} cy={500} size={250} layout="grid" dot={20} color="rgba(236,239,234,0.22)" litColor={C.green}
        appearAt={i => (i % 5) * 2 + Math.floor(i / 5) * 3} litAt={i => (i === LIT[0] ? R.lit1 - R.classStart : i === LIT[1] ? R.lit2 - R.classStart : undefined)} />
      <div style={{ position: 'absolute', left: 1000, top: 250 }}>
        <div style={mono}>CLASS CLOCK</div>
        <div style={{ fontFamily: FONT.mono, fontWeight: 700, fontSize: 72, color: C.paper, letterSpacing: '0.04em', marginTop: 8 }}>
          {String(Math.floor(clock / 60)).padStart(2, '0')}:{String(Math.floor(clock % 60)).padStart(2, '0')}
          <span style={{ color: C.muted }}> / 45:00</span>
        </div>
        <div style={{ ...mono, marginTop: 44 }}>FEEDBACK GIVEN</div>
        <div style={{ fontFamily: FONT.head, fontWeight: 800, fontSize: 260, lineHeight: 0.9, letterSpacing: '-0.04em', color: C.paper }}>
          <span style={{ color: C.green, display: 'inline-block', transform: `scale(${1 + (1 - bump) * 0.4})`, transformOrigin: '50% 80%' }}>{given}</span>
          <span style={{ color: 'rgba(236,239,234,0.35)' }}>/20</span>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 820, display: 'flex', justifyContent: 'center' }}>
        <Serif text="by dinner, I remember two." at={R.serif - R.classStart} size={100} color={C.paper} />
      </div>
    </AbsoluteFill>
  )
}

function Wordmark() {
  const f = useCurrentFrame()
  const local = f
  const ringDraw = ease(local, [0, 14], [0, 1])
  const ringScale = 1 + ease(local, [R.irisOpen - R.ring, R.irisOpen - R.ring + 14], [0, 1], (t: number) => t * t * t) * 9
  const markAt = R.wordmark - R.ring
  const push = lin(local, [markAt, markAt + 90], [1, 1.06])
  return (
    <AbsoluteFill>
      {local < R.irisOpen - R.ring + 14 ? (
        <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', transform: `scale(${ringScale})` }}>
          <LensIcon size={360} draw={ringDraw} dot={ease(local, [8, 16], [0, 1])} lines={0} color={C.paper} />
        </AbsoluteFill>
      ) : null}
      <IrisReveal at={R.irisOpen - R.ring} dur={14} ring={C.paper}>
        <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(61,255,122,0.16), transparent 60%), #07090A', alignItems: 'center', justifyContent: 'center', transform: `scale(${push})` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 44, marginTop: -60 }}>
            <div style={{ transform: `scale(${pop(local, markAt - 4, 200, 12, 0.6)})` }}>
              <LensIcon size={190} color={C.paper} />
            </div>
            <Word text="CoachLens" at={markAt} size={210} color={C.paper} mode="letters" stagger={1.3} />
          </div>
          <div style={{ marginTop: 34 }}>
            <Serif text="hands-free AI agents for coaches, on Even G2" at={R.tagline - R.ring} size={66} color={C.green} />
          </div>
        </AbsoluteFill>
      </IrisReveal>
    </AbsoluteFill>
  )
}

function Agents() {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 150, opacity: 0.9 }}>
        <MarqueeRow words={AGENT_ACTIONS} size={70} color={C.paper} dot={C.orange} speed={-16} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 250, opacity: 0.45 }}>
        <MarqueeRow words={[...AGENT_ACTIONS].reverse()} size={70} color={C.paper} dot={C.green} speed={12} outline offset={300} />
      </div>
      <AbsoluteFill style={{ transform: `translateY(${lin(f, [0, 20], [300, 0])}px)`, opacity: 0.95 }}>
        <CurvedMarquee text={AGENT_ACTIONS.join(' • ')} radius={1500} cx={960} cy={2420} size={58} color={C.paper} dotColor={C.orange} speed={-0.07} />
      </AbsoluteFill>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 410, display: 'flex', justifyContent: 'center', gap: 40 }}>
        <Word text="Seven agents." at={R.seven - R.marquee} size={190} color={C.paper} mode="slam" exitAt={R.zero - R.marquee - 3} exitTo="up" />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 410, display: 'flex', justifyContent: 'center' }}>
        <Word text="One sentence." at={R.zero - R.marquee} size={190} color={C.paper} from="down" distance={700} />
      </div>
    </AbsoluteFill>
  )
}

/** 0:12–0:24 · 20 dots, two lit; the lens-ring iris into the wordmark; agent marquees. */
export function Reveal() {
  return (
    <>
      <Shot from={R.classStart} to={R.ring}>
        <TheClass />
      </Shot>
      <Shot from={R.ring} to={R.marquee} exit="whipL">
        <Wordmark />
      </Shot>
      <Shot from={R.marquee} to={T.quiet.g2} enter="whipL" exit="zoom">
        <Agents />
      </Shot>
    </>
  )
}
