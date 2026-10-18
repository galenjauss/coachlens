/** Single source of truth for copy that must stay honest, and for the timeline. */

/** The store line on the close card. Change it here and only here. */
export const STORE_LINE = 'Now on the Even Hub store'

/** Optional music bed: drop `public/music.mp3` in and it is mixed at −18 dB with the pad ducked. */
export const MUSIC_SRC = 'music.mp3'

/** Originality numbers. Keep exactly as checked. */
export const APPS_CHECKED = 220
export const APPS_FOR_COACHES = 0
export const ORIGINALITY_FOOTNOTE = 'Community G2 app directory + Even built-ins, Oct 2026.'

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080
/** Title-safe margin (px at 1080p). */
export const SAFE = 96

export type SceneId =
  | 'hook' | 'problem' | 'meet' | 'plan' | 'agents' | 'notes' | 'ask'
  | 'notice' | 'wrapup' | 'phone' | 'originality' | 'mosaic' | 'close'

/** [id, start second, end second]: the brief's timeline, 2:30 total. */
export const SCENES: readonly { id: SceneId; from: number; to: number }[] = [
  { id: 'hook', from: 0, to: 7 },
  { id: 'problem', from: 7, to: 15 },
  { id: 'meet', from: 15, to: 22 },
  { id: 'plan', from: 22, to: 38 },
  { id: 'agents', from: 38, to: 58 },
  { id: 'notes', from: 58, to: 68 },
  { id: 'ask', from: 68, to: 82 },
  { id: 'notice', from: 82, to: 98 },
  { id: 'wrapup', from: 98, to: 108 },
  { id: 'phone', from: 108, to: 122 },
  { id: 'originality', from: 122, to: 134 },
  { id: 'mosaic', from: 134, to: 146 },
  { id: 'close', from: 146, to: 150 },
]

export const DURATION = 150 * FPS

export const sceneFrames = (id: SceneId): { from: number; duration: number } => {
  const s = SCENES.find(x => x.id === id)
  if (!s) throw new Error(`Unknown scene ${id}`)
  return { from: s.from * FPS, duration: (s.to - s.from) * FPS }
}
