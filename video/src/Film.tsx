import { CameraMotionBlur } from '@remotion/motion-blur'
import type React from 'react'
import { AbsoluteFill, useCurrentFrame } from 'remotion'
import { Soundtrack } from './audio/Soundtrack'
import { FieldLayer } from './components/FieldLayer'
import { Grain } from './components/Grain'
import { Hud } from './components/Hud'
import { Shot } from './components/Shot'
import { Control } from './scenes/Control'
import { Close, Finale } from './scenes/Finale'
import { Hook } from './scenes/Hook'
import { Notes } from './scenes/Notes'
import { Notice } from './scenes/Notice'
import { Origin } from './scenes/Origin'
import { Quiet } from './scenes/Quiet'
import { Reveal } from './scenes/Reveal'
import { Sentence } from './scenes/Sentence'
import { SECTIONS, inWhip } from './timeline'

function Picture() {
  return (
    <AbsoluteFill>
      <FieldLayer />
      <Hook />
      <Reveal />
      <Quiet />
      <Sentence />
      <Notes />
      <Notice />
      <Origin />
      <Control />
      <Finale />
      <Shot from={SECTIONS.close.from} to={SECTIONS.close.to}>
        <Close />
      </Shot>
    </AbsoluteFill>
  )
}

/** Whip frames get real camera motion blur (sub-frame samples); everything else renders once. */
function Blurred({ children }: { children: React.ReactNode }) {
  const f = useCurrentFrame()
  if (!inWhip(f)) return <>{children}</>
  return (
    <CameraMotionBlur samples={8} shutterAngle={300}>
      {children}
    </CameraMotionBlur>
  )
}

/** CoachLens launch film v2: picture (field + scenes, motion-blurred on whips), HUD, grain, sound. */
export function Film() {
  return (
    <AbsoluteFill style={{ background: '#07090A' }}>
      <Blurred>
        <Picture />
      </Blurred>
      <Hud />
      <Grain />
      <Soundtrack />
    </AbsoluteFill>
  )
}
