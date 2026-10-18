import type React from 'react'
import { useCurrentFrame, useVideoConfig } from 'remotion'
import { ease, enterAt, lin } from '../components/motion'
import { P } from '../components/PhoneFrame'

/**
 * The phone app's screens, recreated with its theme tokens (app/src/phone/theme.css) and its real copy
 * (Review email card, From your agents, AutonomyControl). Type is set large for 1080p legibility.
 */
const font = '-apple-system, "SF Pro Text", "Inter Tight", system-ui, sans-serif'
const H1: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ fontSize: 50, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff', lineHeight: 1.1 }}>{children}</div>
const Sub: React.FC<{ children: React.ReactNode }> = ({ children }) => <div style={{ fontSize: 28, color: P.muted, marginTop: 4, marginBottom: 22 }}>{children}</div>
const Card: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ background: P.card, borderRadius: 18, padding: '20px 20px', marginBottom: 14, ...style }}>{children}</div>
)
const Pill: React.FC<{ children: React.ReactNode; tone?: 'ok' | 'high' }> = ({ children, tone }) => (
  <span style={{ display: 'inline-block', fontSize: 28, padding: '2px 14px', borderRadius: 99, background: tone === 'high' ? P.dangerBg : P.line, color: tone === 'high' ? P.danger : tone === 'ok' ? P.accent : P.text, marginRight: 10 }}>{children}</span>
)
const Btn: React.FC<{ children: React.ReactNode; primary?: boolean; pressed?: number; style?: React.CSSProperties }> = ({ children, primary, pressed = 0, style }) => (
  <div
    style={{
      flex: 1, textAlign: 'center', fontSize: 30, fontWeight: primary ? 600 : 500, padding: '16px 10px', borderRadius: 14,
      background: primary ? P.accent : P.line, color: primary ? P.ink : P.text, scale: String(1 - 0.04 * pressed), filter: `brightness(${1 + 0.15 * pressed})`, ...style,
    }}
  >
    {children}
  </div>
)
const Finger: React.FC<{ at: number; x: number; y: number }> = ({ at, x, y }) => {
  const frame = useCurrentFrame()
  const l = frame - at
  if (l < -8 || l > 26) return null
  const p = ease(l, [0, 18], [0, 1])
  return (
    <div style={{ position: 'absolute', left: x - 40, top: y - 40, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.35)', border: '2px solid rgba(255,255,255,0.8)', opacity: lin(l, [-8, 0, 10, 26], [0, 1, 0.8, 0]), scale: String(0.7 + 0.5 * p) }} />
  )
}

export const ReviewScreen: React.FC<{ sendAt: number }> = ({ sendAt }) => {
  const frame = useCurrentFrame()
  const sent = frame >= sendAt + 6
  return (
    <div style={{ padding: '78px 22px 0', fontFamily: font, color: P.text }}>
      <H1>Review</H1>
      <Sub>{sent ? '2 to review' : '3 to review'}</Sub>
      <Card>
        <div style={{ marginBottom: 12 }}><Pill>Email</Pill></div>
        <div style={{ fontSize: 28, color: P.muted, marginBottom: 10 }}>Dee · to her parent</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#fff', marginBottom: 8, lineHeight: 1.2 }}>Dee hurt her ankle in class today</div>
        <div style={{ fontSize: 28, color: P.muted, lineHeight: 1.35 }}>Hi, a quick note: Dee rolled her ankle and sat out the last drill. She was…</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
          <Btn>Edit</Btn>
          <Btn primary pressed={lin(frame, [sendAt, sendAt + 3, sendAt + 8], [0, 1, 0])}>{sent ? 'Sent.' : 'Send'}</Btn>
        </div>
      </Card>
      <Card style={{ opacity: 0.55 }}>
        <div><Pill>Report card</Pill></div>
        <div style={{ fontSize: 30, fontWeight: 600, color: '#fff', marginTop: 10 }}>Priya · October</div>
      </Card>
      <Finger at={sendAt} x={300} y={548} />
    </div>
  )
}

export const AgentsIdeasScreen: React.FC<{ doAt: number }> = ({ doAt }) => {
  const frame = useCurrentFrame()
  const working = frame >= doAt + 4 && frame < doAt + 30
  const done = frame >= doAt + 30
  return (
    <div style={{ padding: '78px 22px 0', fontFamily: font, color: P.text }}>
      <H1>Today</H1>
      <Sub>Kids · Tue · 5:00 PM</Sub>
      <Card style={{ border: `1px solid ${P.line}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ fontSize: 34, fontWeight: 700, color: '#fff', flex: 1 }}>From your agents</div>
          <Pill tone="ok">2 new</Pill>
        </div>
        <div style={{ fontSize: 28, color: P.muted }}>Gus Hill</div>
        <div style={{ fontSize: 34, fontWeight: 700, color: '#fff', margin: '4px 0 6px' }}>Gus ready to test</div>
        <div style={{ fontSize: 28, color: P.muted, lineHeight: 1.3 }}>120 days at green belt · 11/12 classes</div>
        {done ? (
          <div style={{ marginTop: 18, fontSize: 30, color: P.accent, fontWeight: 600 }}>√ Done · Plan test</div>
        ) : (
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            <Btn primary pressed={lin(frame, [doAt, doAt + 3, doAt + 8], [0, 1, 0])}>{working ? 'Working…' : 'Do it'}</Btn>
            <Btn>Dismiss</Btn>
          </div>
        )}
        <div style={{ height: 1, background: P.line, margin: '20px 0 16px' }} />
        <div style={{ fontSize: 28, color: P.muted }}>Jake Miller</div>
        <div style={{ fontSize: 32, fontWeight: 700, color: '#fff', marginTop: 4 }}>Jake’s back after 3 missed</div>
      </Card>
      <Finger at={doAt} x={120} y={548} />
    </div>
  )
}

const MODES = ['Auto', 'Review', 'Off'] as const
const COPY = {
  Auto: 'Writes the email and sends it right away. No review step.',
  Review: 'Writes the email and waits for your OK in Review before anything is sent.',
}
export const AutonomyScreen: React.FC<{ pickAt: number }> = ({ pickAt }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const slide = enterAt(frame, fps, pickAt)
  const segW = (430 - 24 - 44 - 40 - 8) / 3
  const onReview = frame >= pickAt
  return (
    <div style={{ padding: '78px 22px 0', fontFamily: font, color: P.text }}>
      <H1>Agents</H1>
      <Sub>Each one does only what you allow</Sub>
      <Card>
        <div style={{ fontSize: 34, fontWeight: 700, color: '#fff', marginBottom: 6 }}>Parent email</div>
        <div style={{ fontSize: 28, color: P.muted, marginBottom: 18, lineHeight: 1.3 }}>How much should it do on its own?</div>
        <div style={{ position: 'relative', display: 'flex', background: P.line, borderRadius: 14, padding: 4 }}>
          <div style={{ position: 'absolute', top: 4, bottom: 4, left: 4 + segW * slide, width: segW, borderRadius: 11, background: P.accent }} />
          {MODES.map((m, i) => {
            const on = (onReview ? 1 : 0) === i
            return (
              <div key={m} style={{ position: 'relative', flex: 1, textAlign: 'center', fontSize: 30, fontWeight: on ? 700 : 500, padding: '14px 0', color: on ? P.ink : i === 2 ? P.muted : P.text }}>{m}</div>
            )
          })}
        </div>
        <div style={{ fontSize: 28, color: P.muted, marginTop: 18, lineHeight: 1.35, minHeight: 150 }}>{onReview ? COPY.Review : COPY.Auto}</div>
      </Card>
      <Card style={{ opacity: 0.55 }}>
        <div style={{ fontSize: 32, fontWeight: 600, color: '#fff' }}>Report cards</div>
        <div style={{ fontSize: 28, color: P.muted, marginTop: 4 }}>Review</div>
      </Card>
      <Finger at={pickAt} x={200} y={408} />
    </div>
  )
}
