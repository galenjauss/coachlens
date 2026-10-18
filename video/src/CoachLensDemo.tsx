import { AbsoluteFill, Sequence } from 'remotion'
import { SoundLayer } from './audio/SoundLayer'
import { Grain, Vignette } from './components/Atmosphere'
import { sceneFrames } from './config'
import { S01Hook } from './scenes/S01Hook'
import { S02Problem } from './scenes/S02Problem'
import { S03Meet } from './scenes/S03Meet'
import { S04Plan } from './scenes/S04Plan'
import { S05Agents } from './scenes/S05Agents'
import { S06Notes } from './scenes/S06Notes'
import { S07Ask } from './scenes/S07Ask'
import { S08Notice } from './scenes/S08Notice'
import { S09Wrapup } from './scenes/S09Wrapup'
import { S10Phone } from './scenes/S10Phone'
import { S11Originality } from './scenes/S11Originality'
import { S12Mosaic } from './scenes/S12Mosaic'
import { S13Close } from './scenes/S13Close'
import { C } from './theme'

/** The 2:30 CoachLens Devpost video. Scene timing lives in config.ts (SCENES). */
export const CoachLensDemo: React.FC = () => (
  <AbsoluteFill style={{ background: C.bg }}>
    <Sequence name="01 Hook" from={sceneFrames('hook').from} durationInFrames={sceneFrames('hook').duration}><S01Hook /></Sequence>
    <Sequence name="02 Problem" from={sceneFrames('problem').from} durationInFrames={sceneFrames('problem').duration}><S02Problem /></Sequence>
    <Sequence name="03 Meet" from={sceneFrames('meet').from} durationInFrames={sceneFrames('meet').duration}><S03Meet /></Sequence>
    <Sequence name="04 Plan (slot A)" from={sceneFrames('plan').from} durationInFrames={sceneFrames('plan').duration}><S04Plan /></Sequence>
    <Sequence name="05 Tap. Talk. Agents." from={sceneFrames('agents').from} durationInFrames={sceneFrames('agents').duration}><S05Agents /></Sequence>
    <Sequence name="06 Notes (slot B)" from={sceneFrames('notes').from} durationInFrames={sceneFrames('notes').duration}><S06Notes /></Sequence>
    <Sequence name="07 Ask the class" from={sceneFrames('ask').from} durationInFrames={sceneFrames('ask').duration}><S07Ask /></Sequence>
    <Sequence name="08 Agents that notice" from={sceneFrames('notice').from} durationInFrames={sceneFrames('notice').duration}><S08Notice /></Sequence>
    <Sequence name="09 End of class" from={sceneFrames('wrapup').from} durationInFrames={sceneFrames('wrapup').duration}><S09Wrapup /></Sequence>
    <Sequence name="10 Phone (slot C)" from={sceneFrames('phone').from} durationInFrames={sceneFrames('phone').duration}><S10Phone /></Sequence>
    <Sequence name="11 Originality" from={sceneFrames('originality').from} durationInFrames={sceneFrames('originality').duration}><S11Originality /></Sequence>
    <Sequence name="12 Every coach" from={sceneFrames('mosaic').from} durationInFrames={sceneFrames('mosaic').duration}><S12Mosaic /></Sequence>
    <Sequence name="13 Close" from={sceneFrames('close').from} durationInFrames={sceneFrames('close').duration}><S13Close /></Sequence>
    <Vignette />
    <Grain />
    <SoundLayer />
  </AbsoluteFill>
)
