import { FPS, SLOTS } from './timeline'

/**
 * Real-footage slots (the shot list). Drop `public/footage/<id>.mp4` (or .mov) in and the slot plays
 * it inside a tilted 3D frame; otherwise its fallback, built only from the real captures, plays.
 * Slot timing lives in timeline.ts (SLOTS). See SHOTLIST.md.
 */
export type SlotId = keyof typeof SLOTS

export const footageSeconds = (id: SlotId): number => (SLOTS[id].to - SLOTS[id].from) / FPS
