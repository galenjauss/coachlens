import { FPS, sceneFrames } from './config'

/**
 * Real-footage slots (the shot list). Drop `public/footage/<id>.mp4` (or .mov) in and the slot plays
 * it, cover-fit with rounded corners and the callouts on top; otherwise its animated fallback, built
 * from the real lens UI, keeps the video complete. See SHOTLIST.md.
 */
export type FootageSlotConfig = { id: 'A' | 'B' | 'C'; from: number; durationInFrames: number; shot: string }

const slot = (id: FootageSlotConfig['id'], scene: Parameters<typeof sceneFrames>[0], shot: string): FootageSlotConfig => {
  const f = sceneFrames(scene)
  return { id, from: f.from, durationInFrames: f.duration, shot }
}

export const FOOTAGE: readonly FootageSlotConfig[] = [
  slot('A', 'plan', 'Through the lens: lobby, double-tap, plan the class out loud, the plan diff lands (16 s).'),
  slot('B', 'notes', 'Through the lens in class: the PR card, then "How\'s Priya doing?" brief (10 s).'),
  slot('C', 'phone', 'Phone screen recording: Review (Dee email draft), From your agents → Do it, Agents → Auto·Review·Off on Review (14 s).'),
]

export const footageSeconds = (id: FootageSlotConfig['id']) => (FOOTAGE.find(f => f.id === id)?.durationInFrames ?? 0) / FPS
