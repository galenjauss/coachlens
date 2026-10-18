import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { IrisReveal } from '../components/Iris'
import { Serif, Word } from '../components/Kinetic'
import { LensIcon } from '../components/LensIcon'
import { LensShot } from '../components/LensShot'
import { CurvedMarquee } from '../components/Marquee'
import { Shot } from '../components/Shot'
import { STORE_LINE } from '../config'
import { ease, lin, pop } from '../lib/anim'
import { C, FIELD, FONT, PHOSPHOR } from '../theme'
import { FLASH_STARTS, SECTIONS, T, USE_CASES, fieldAt } from '../timeline'

/**
 * The hypothetical use-case lens line: the one allowed exception to "never redraw the lens"
 * (these classes are not in the app), so it is small, pixel-crisp Rajdhani in lens green.
 */
function LensStrip({ text, at }: { text: string; at: number }) {
  const f = useCurrentFrame()
  const p = ease(f, [at, at + 7], [0, 1])
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 18,
        padding: '18px 34px 20px 26px',
        borderRadius: 18,
        background: 'linear-gradient(160deg, #0d1411, #050807)',
        boxShadow: '0 0 0 1px rgba(236,239,234,0.12), 0 20px 50px rgba(0,0,0,0.45)',
        transform: `translateY(${(1 - p) * 60}px)`,
        opacity: p,
      }}
    >
      <span style={{ width: 4, height: 40, background: C.green, filter: PHOSPHOR }} />
      <span style={{ fontFamily: FONT.lens, fontWeight: 500, fontSize: 50, color: C.green, filter: PHOSPHOR, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  )
}

function Flash({ i, len }: { i: number; len: number }) {
  const u = USE_CASES[i]
  if (!u) return null
  const ink = FIELD[u.field].ink
  const size = Math.min(250, 1640 / (u.role.length * 0.56))
  const fromDir = i % 2 === 0 ? 'right' : 'left'
  const fast = len < 20
  const f = useCurrentFrame()
  const drift = (fromDir === 'right' ? -1 : 1) * lin(f, [0, Math.max(len, 1)], [0, 60])
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          right: 90,
          top: 330,
          fontFamily: FONT.head,
          fontWeight: 800,
          fontSize: 520,
          lineHeight: 1,
          letterSpacing: '-0.05em',
          color: 'transparent',
          WebkitTextStroke: `3px ${ink}`,
          opacity: 0.22,
          transform: `translateX(${drift}px)`,
        }}
      >
        {String(i + 1).padStart(2, '0')}
      </div>
      <div style={{ position: 'absolute', left: 150, top: 200, fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.32em', color: ink, opacity: 0.8 }}>
        {`USE CASE ${String(i + 1).padStart(2, '0')}/${USE_CASES.length}`}
      </div>
      <div style={{ position: 'absolute', left: 140, top: 300 }}>
        <Word text={u.role} at={fast ? -4 : -2} size={size} color={ink} from={fromDir} distance={fast ? 260 : 520} snappy={fast} />
      </div>
      <div style={{ position: 'absolute', left: 150, top: 300 + size * 1.05 }}>
        <LensStrip text={u.line} at={fast ? -6 : 2} />
      </div>
    </AbsoluteFill>
  )
}

function YourClass() {
  const f = useCurrentFrame()
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(61,255,122,0.14), transparent 60%)' }} />
      <div style={{ position: 'absolute', left: 150, top: 200, fontFamily: FONT.mono, fontSize: 22, letterSpacing: '0.32em', color: C.green }}>USE CASE 16/16 · YOURS</div>
      <div style={{ position: 'absolute', left: 140, top: 270 }}>
        <Word text="Your class." at={-2} size={210} color={C.paper} mode="letters" stagger={1.2} />
      </div>
      <div style={{ position: 'absolute', left: 700, top: 420, opacity: lin(f, [4, 12], [0, 1]) }}>
        <LensShot
          frames={[
            { src: 'lens/home/01.png', at: 0 },
            { src: 'lens/lobby/01.png', at: 44 },
            { src: 'lens/rollCall/01.png', at: 86 },
          ]}
          scale={2}
          enter="rise"
          enterAt={4}
          ry={[-14, -8]}
          rx={[6, 3]}
          dolly={[0.72, 0.8]}
          span={[0, 130]}
          taps={[40, 82]}
          xfade={0}
        />
      </div>
    </AbsoluteFill>
  )
}

function AnyRoom() {
  const f = useCurrentFrame()
  const field = FIELD[fieldAt(f + SECTIONS.finale.from).field]
  return (
    <AbsoluteFill style={{ opacity: 0.55 * lin(f, [0, 20], [0, 1]) * lin(f + SECTIONS.finale.from, [(FLASH_STARTS[15] ?? 0) - 4, FLASH_STARTS[15] ?? 0], [1, 0]) }}>
      <CurvedMarquee text="ANY ROOM • ANY COACH • ANY ROOM • ANY COACH •" radius={1500} cx={960} cy={2560} size={64} color={field.ink} dotColor={field.ink === C.black ? C.black : C.green} speed={-0.09} />
    </AbsoluteFill>
  )
}

/** 2:04–2:26 · the finale track: one full-screen card per coach, cut on its kicks, accelerating. */
export function Finale() {
  const last = USE_CASES.length - 1
  return (
    <>
      {USE_CASES.map((_, i) => {
        const from = FLASH_STARTS[i] ?? SECTIONS.finale.from
        const to = i === last ? SECTIONS.finale.to + 12 : (FLASH_STARTS[i + 1] ?? SECTIONS.finale.to)
        return (
          <Shot key={i} from={from} to={to}>
            {i === last ? <YourClass /> : <Flash i={i} len={to - from} />}
          </Shot>
        )
      })}
      <Sequence from={SECTIONS.finale.from} durationInFrames={SECTIONS.finale.to - SECTIONS.finale.from}>
        <AnyRoom />
      </Sequence>
    </>
  )
}

/** 2:26–2:30 · the lens-ring iris to black: wordmark, STORE_LINE, the serif line. */
export function Close() {
  const f = useCurrentFrame()
  const at = T.close.lines - T.close.iris
  return (
    <IrisReveal at={0} dur={10} ring={C.green}>
      <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 42%, rgba(61,255,122,0.14), transparent 60%), #07090A', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: -110, transform: `scale(${lin(f, [0, 120], [1, 1.05])})` }}>
          <div style={{ transform: `scale(${pop(f, 2, 200, 12, 0.6)})` }}>
            <LensIcon size={170} color={C.paper} />
          </div>
          <Word text="CoachLens" at={4} size={190} color={C.paper} mode="letters" stagger={1} />
        </div>
        <div style={{ marginTop: 30 }}>
          <Serif text="teach the class. CoachLens runs the follow-up." at={at} size={60} color={C.paper} stagger={2} />
        </div>
        <div
          style={{
            marginTop: 44,
            padding: '14px 30px',
            border: `1.5px solid ${C.green}`,
            borderRadius: 999,
            fontFamily: FONT.mono,
            fontWeight: 700,
            fontSize: 28,
            letterSpacing: '0.24em',
            color: C.green,
            textTransform: 'uppercase',
            opacity: lin(f, [at + 14, at + 22], [0, 1]),
            boxShadow: '0 0 30px rgba(61,255,122,0.25)',
          }}
        >
          {STORE_LINE}
        </div>
      </AbsoluteFill>
    </IrisReveal>
  )
}
