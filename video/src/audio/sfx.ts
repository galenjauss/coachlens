/**
 * The licensed Mixkit SFX in public/audio/sfx, measured with scripts/audio-check.mjs:
 * `hit` = seconds from the file start to the transient that should land on the cue frame,
 * `dur` = how much of the file to play, `gain` = level trim so whooshes sit ~6–10 dB under the music.
 */
export const SFX = {
  'bleep-confirm': { hit: 0.14, dur: 0.5, gain: 0.32 },
  'bleep-notify': { hit: 0.16, dur: 0.45, gain: 0.9 },
  'click-check': { hit: 0.2, dur: 0.35, gain: 0.55 },
  'click-device': { hit: 0.01, dur: 0.2, gain: 0.6 },
  'confirm-scifi': { hit: 0.03, dur: 0.3, gain: 0.4 },
  'glitch-break': { hit: 0.8, dur: 1.5, gain: 0.42 },
  'glitch-quick': { hit: 0.01, dur: 0.55, gain: 0.4 },
  'glitch-small': { hit: 0.05, dur: 0.55, gain: 0.3 },
  'glitch-text-intro': { hit: 0.1, dur: 0.95, gain: 0.3 },
  'hit-fast': { hit: 0.13, dur: 0.3, gain: 1.0 },
  'impact-heartbeat-deep': { hit: 0.12, dur: 0.5, gain: 0.75 },
  'impact-logo': { hit: 0.01, dur: 1.5, gain: 0.72 },
  'impact-tech-break': { hit: 0.16, dur: 1.1, gain: 0.62 },
  'impact-whoosh-deep': { hit: 0.55, dur: 1.7, gain: 0.62 },
  'impact-zoom-quick': { hit: 0.8, dur: 2.4, gain: 0.55 },
  'notify-positive': { hit: 0.01, dur: 0.35, gain: 0.4 },
  'pop-notify': { hit: 0.32, dur: 0.8, gain: 0.38 },
  'power-up': { hit: 0.05, dur: 1.4, gain: 0.3 },
  'riser-stutter-short': { hit: 6.54, dur: 6.6, gain: 0.42 },
  'riser-synth': { hit: 11.08, dur: 11.2, gain: 0.38 },
  'select-option': { hit: 0.0, dur: 0.9, gain: 0.35 },
  'select-tech': { hit: 0.01, dur: 0.15, gain: 0.6 },
  'slide-tech': { hit: 1.7, dur: 2.6, gain: 0.32 },
  'sweep-fast-small': { hit: 0.3, dur: 0.64, gain: 0.4 },
  'sweep-scifi-fast': { hit: 3.76, dur: 4.04, gain: 0.32 },
  'swoosh-fast': { hit: 0.12, dur: 0.25, gain: 0.5 },
  'tone-quick': { hit: 0.06, dur: 1.2, gain: 0.3 },
  'typing-laptop': { hit: 0.0, dur: 0.05, gain: 0.5 },
  'ui-start': { hit: 0.0, dur: 0.9, gain: 0.38 },
  'whoosh-air': { hit: 0.71, dur: 1.4, gain: 0.42 },
  'whoosh-cinematic-fast': { hit: 1.08, dur: 1.23, gain: 0.42 },
  'whoosh-fast': { hit: 0.55, dur: 1.3, gain: 0.3 },
  'whoosh-pop-light': { hit: 0.44, dur: 1.1, gain: 0.55 },
  'whoosh-stutter': { hit: 2.59, dur: 3.2, gain: 0.38 },
  'zoom-in-long': { hit: 0.76, dur: 3.6, gain: 0.6 },
  'zoom-in': { hit: 0.18, dur: 0.8, gain: 0.42 },
  'zoom-move': { hit: 0.23, dur: 1.3, gain: 0.5 },
} as const

export type SfxName = keyof typeof SFX

/** Impacts are mixed hot and duck the music; everything else sits under it. */
export const IMPACTS: readonly SfxName[] = ['impact-logo', 'impact-tech-break', 'impact-whoosh-deep', 'impact-zoom-quick', 'impact-heartbeat-deep']
