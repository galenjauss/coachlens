/**
 * THE timeline. Every scene, cut, field flip, word, whip and sound effect is placed here, on the
 * music's beat grid. Scenes read their shot times from `T`; the soundtrack reads `CUES`.
 *
 * Main track (Mixkit "Minimal Techno 01"): 120 BPM, a kick on track 0.0 s and every 0.5 s after it,
 * so it plays from 0 and track time = film time: a beat is 15 frames, a bar 60. Breakdowns at
 * 24–40 s (frames 720–1200) and 96–104 s (2880–3120). The finale track (Mixkit "Pick It Up",
 * ~175 BPM, syncopated breakbeat) takes over at 124 s; its cuts snap to measured kick onsets.
 */
import type { FieldName } from './theme'
import type { SfxName } from './audio/sfx'

export const FPS = 30
export const BEAT = 15
export const BAR = 60
export const beat = (n: number): number => Math.round(n * BEAT)
export const bar = (n: number): number => n * BAR
export const sec = (s: number): number => Math.round(s * FPS)

// ── Sections ──────────────────────────────────────────────────────────────────────────────────
export type SectionId = 'hook' | 'reveal' | 'quiet' | 'sentence' | 'notes' | 'notice' | 'origin' | 'control' | 'finale' | 'close'
export const SECTIONS: Record<SectionId, { from: number; to: number }> = {
  hook: { from: bar(0), to: bar(6) },
  reveal: { from: bar(6), to: bar(12) },
  quiet: { from: bar(12), to: bar(20) },
  sentence: { from: bar(20), to: bar(30) },
  notes: { from: bar(30), to: bar(40) },
  notice: { from: bar(40), to: bar(48) },
  origin: { from: bar(48), to: bar(54) },
  control: { from: bar(54), to: bar(62) },
  finale: { from: bar(62), to: sec(146) },
  close: { from: sec(146), to: sec(150) },
}

/** Finale: track offset at the hand-off, and the film time it plays from. */
export const FINALE_AT = SECTIONS.finale.from
export const FINALE_TRACK_OFFSET = 26.055

// ── Shot times (global frames) ────────────────────────────────────────────────────────────────
export const T = {
  hook: {
    kids20: 0, kidsWord: beat(1), kidsSerif: beat(2),
    min45: bar(1), minWord: bar(1) + beat(1),
    coach: bar(2), coachSerif: bar(2) + beat(2),
    hands: bar(3),
    tasks: [bar(4), bar(4) + beat(1), bar(4) + beat(2), bar(4) + beat(3)],
    noProblem: bar(5), noSerif: bar(5) + beat(2),
  },
  reveal: {
    classStart: bar(6), lit1: bar(6) + beat(2), lit2: bar(6) + beat(5), serif: bar(7),
    ring: bar(8), irisOpen: bar(8) + beat(1), wordmark: bar(8) + beat(2), tagline: bar(8) + beat(3),
    marquee: bar(10), seven: bar(10) + beat(2), zero: bar(11), exit: bar(12) - 6,
  },
  quiet: {
    g2: bar(12), serif: bar(12) + beat(3), dolly: bar(14), glass: bar(14) + beat(2),
    tap: sec(29.33), peek: sec(30), lobby: sec(33), planning: sec(35.5), planResult: sec(37.5), diff: sec(38.4),
  },
  sentence: {
    rec: bar(20), talk: bar(20) + beat(2), typed: bar(21), card: bar(22), ticks: [sec(46.25), sec(46.5), sec(46.75), sec(47.5)],
    outcomes: [bar(24) + beat(1), bar(24) + beat(2), bar(24) + beat(3), bar(25)], summary: bar(25) + beat(1),
    urgent: bar(26), urgentLens: bar(26) + beat(1), phone: bar(28), phoneZoom: bar(28) + beat(2), send: bar(29),
  },
  notes: {
    prCard: bar(30), pr: bar(30) + beat(2), checkCard: bar(32) + beat(2), brief: bar(32) + beat(3),
    askCard: bar(35), ask: bar(35) + beat(2), answer: bar(36) + beat(1), names: [bar(36) + beat(2), bar(36) + beat(2) + 8, bar(36) + beat(3), bar(36) + beat(3) + 8],
    rollCard: bar(38), roll: bar(38) + beat(1), rollDone: bar(38) + beat(4) + 8,
  },
  notice: {
    banner: bar(40), slam: bar(40) + beat(2), serif: bar(40) + beat(3),
    phone: bar(41) + beat(2), working: bar(42) + beat(2), scroll: bar(42) + beat(2) + 2, drafted: bar(43) + beat(1), reviewTap: bar(44), review: bar(44) + beat(1),
    words: [bar(44) + beat(3), bar(45), bar(45) + beat(1)], wrapup: bar(45) + beat(3), missed: bar(46) + beat(2), tap: bar(47), nextClass: bar(47) + beat(1),
  },
  origin: {
    count: bar(48), serif: bar(48) + beat(2), built: bar(50), zero: bar(52), shakeEnd: bar(52) + 12, untilNow: bar(53),
  },
  control: {
    autonomy: bar(54), tapReview: bar(55) + beat(1), card: bar(56), agents: bar(56) + beat(1), kidCard: bar(58),
    priya: bar(58) + beat(1), priya3: bar(59) + beat(1), montage: [bar(60), bar(60) + beat(1), bar(60) + beat(2), bar(60) + beat(3)], teach: bar(61),
  },
  close: { iris: sec(146), lines: sec(146) + 8 },
} as const

// ── Finale flash-bys: 16 coach types, accelerating, snapped to the finale track's kick onsets ──
/** Strong low-band onsets of the finale track (track seconds, 26–52 s), from scripts/audio-check.mjs. */
const FINALE_ONSETS = [
  26.055, 26.34, 26.8, 26.93, 27.475, 27.635, 27.845, 28.38, 28.79, 29.515, 30.08, 30.645, 30.93, 31.36, 31.79, 31.95,
  32.205, 32.5, 32.66, 32.925, 33.285, 33.93, 34.23, 35.215, 35.935, 36.795, 37.8, 37.955, 38.285, 38.93, 39.075, 39.4,
  39.645, 40.09, 40.53, 40.65, 41.22, 41.385, 42.375, 43.515, 43.665, 43.84, 43.95, 44.66, 45.325, 45.805, 45.95,
]
const onsetFrame = (trackSec: number): number => FINALE_AT + Math.round((trackSec - FINALE_TRACK_OFFSET) * FPS)
const snapToOnset = (f: number): number => {
  const cands = FINALE_ONSETS.map(onsetFrame).filter(o => Math.abs(o - f) <= 6)
  return cands.length ? cands.reduce((a, b) => (Math.abs(b - f) < Math.abs(a - f) ? b : a)) : f
}
export const USE_CASES: readonly { role: string; line: string; field: FieldName }[] = [
  { role: 'Football coach', line: '#12 late off the snap · 3rd time', field: 'orange' },
  { role: 'Math tutor', line: 'Sam: distribute the negative', field: 'cobalt' },
  { role: 'Martial arts', line: 'Priya · guard (3rd time)', field: 'paper' },
  { role: 'Classroom teacher', line: "Row 3 hasn't spoken today", field: 'green' },
  { role: 'Personal trainer', line: 'Maria · deadlift PR +10', field: 'black' },
  { role: 'Swim coach', line: 'Lane 4 · 50m split -0.8s', field: 'cobalt' },
  { role: 'Piano teacher', line: 'Ava · left-hand tempo', field: 'orange' },
  { role: 'Dance instructor', line: 'Leo · late on the 5-6-7-8', field: 'paper' },
  { role: 'Climbing coach', line: 'Nina · flag the left foot', field: 'black' },
  { role: 'Debate coach', line: 'Theo · rebuttal ran 40s long', field: 'green' },
  { role: 'Soccer coach', line: 'Back line · step up together', field: 'cobalt' },
  { role: 'Yoga instructor', line: 'Kim · knee past toes', field: 'orange' },
  { role: 'Tennis coach', line: 'Max · split-step late', field: 'paper' },
  { role: 'Chess coach', line: 'Ari · hung a piece twice', field: 'cobalt' },
  { role: 'Driving instructor', line: 'Check blind spot · 2nd time', field: 'orange' },
  { role: 'Your class', line: '> Tap to start class', field: 'black' },
]
const FLASH_DURATIONS = [2.2, 2.0, 1.9, 1.7, 1.6, 1.4, 1.3, 1.1, 1.0, 0.9, 0.75, 0.6, 0.5, 0.4, 0.35]
export const FLASH_STARTS: readonly number[] = FLASH_DURATIONS.reduce<number[]>(
  (acc, d) => [...acc, snapToOnset((acc[acc.length - 1] ?? FINALE_AT) + sec(d))],
  [FINALE_AT],
)

// ── Colour fields (the global background), flipped on downbeats ──────────────────────────────
export type FieldCut = { at: number; field: FieldName; wipe?: 'left' | 'up' | 'iris' }
export const FIELDS: readonly FieldCut[] = [
  { at: T.hook.kids20, field: 'orange' },
  { at: T.hook.min45, field: 'cobalt', wipe: 'left' },
  { at: T.hook.coach, field: 'paper', wipe: 'up' },
  { at: T.hook.hands, field: 'black' },
  { at: T.hook.tasks[0], field: 'cobalt' },
  { at: T.hook.tasks[1], field: 'orange' },
  { at: T.hook.tasks[2], field: 'paper' },
  { at: T.hook.tasks[3], field: 'black' },
  { at: T.hook.noProblem, field: 'green', wipe: 'iris' },
  { at: T.reveal.classStart, field: 'black' },
  { at: T.reveal.marquee, field: 'cobalt', wipe: 'left' },
  { at: T.quiet.g2, field: 'black' },
  { at: T.sentence.rec, field: 'cobalt' },
  { at: T.sentence.typed, field: 'black' },
  { at: T.sentence.outcomes[0], field: 'cobalt' },
  { at: T.sentence.outcomes[1], field: 'black' },
  { at: T.sentence.outcomes[2], field: 'green' },
  { at: T.sentence.outcomes[3], field: 'paper' },
  { at: T.sentence.summary, field: 'cobalt' },
  { at: T.sentence.urgent, field: 'orange' },
  { at: T.sentence.phone, field: 'black' },
  { at: T.notes.prCard, field: 'orange' },
  { at: T.notes.pr, field: 'black' },
  { at: T.notes.checkCard, field: 'paper' },
  { at: T.notes.brief, field: 'black' },
  { at: T.notes.askCard, field: 'cobalt' },
  { at: T.notes.ask, field: 'black' },
  { at: T.notes.rollCard, field: 'green' },
  { at: T.notes.roll, field: 'black' },
  { at: T.notice.banner, field: 'orange' },
  { at: T.notice.phone, field: 'black' },
  { at: T.notice.words[0], field: 'cobalt' },
  { at: T.notice.words[1], field: 'orange' },
  { at: T.notice.words[2], field: 'paper' },
  { at: T.notice.wrapup, field: 'black' },
  { at: T.origin.built, field: 'paper', wipe: 'up' },
  { at: T.origin.zero, field: 'orange' },
  { at: T.origin.untilNow, field: 'black' },
  { at: T.control.autonomy, field: 'cobalt' },
  { at: T.control.card, field: 'orange' },
  { at: T.control.agents, field: 'black' },
  { at: T.control.kidCard, field: 'paper' },
  { at: T.control.priya, field: 'cobalt' },
  { at: T.control.montage[0], field: 'black' },
  { at: T.control.teach, field: 'green', wipe: 'iris' },
  ...USE_CASES.map((u, i) => ({ at: FLASH_STARTS[i] ?? FINALE_AT, field: u.field })),
  { at: T.close.iris, field: 'black', wipe: 'iris' },
]

export const fieldAt = (frame: number): FieldCut => {
  let cur: FieldCut = FIELDS[0] ?? { at: 0, field: 'black' }
  for (const f of FIELDS) if (f.at <= frame) cur = f
  return cur
}
export const prevField = (cut: FieldCut): FieldCut => {
  const i = FIELDS.indexOf(cut)
  return FIELDS[Math.max(0, i - 1)] ?? cut
}

// ── HUD section labels ────────────────────────────────────────────────────────────────────────
export const LABELS: readonly { at: number; scene: number; label: string }[] = [
  { at: 0, scene: 1, label: 'HOOK / KINETIC TYPE' },
  { at: SECTIONS.reveal.from, scene: 1, label: 'HOOK / THE CLASS' },
  { at: T.reveal.ring, scene: 1, label: 'MEET / COACHLENS' },
  { at: SECTIONS.quiet.from, scene: 2, label: 'LENS / QUIET BY DESIGN' },
  { at: SECTIONS.sentence.from, scene: 3, label: 'AGENTS / ONE SENTENCE IN' },
  { at: SECTIONS.notes.from, scene: 4, label: 'NOTES / REAL CLASS' },
  { at: SECTIONS.notice.from, scene: 5, label: 'INSIGHTS / OPPORTUNISTIC' },
  { at: SECTIONS.origin.from, scene: 6, label: `ORIGINALITY / 0 OF 220+` },
  { at: SECTIONS.control.from, scene: 6, label: 'CONTROL / YOUR CALL' },
  { at: SECTIONS.finale.from, scene: 7, label: 'EVERY COACH / FLASH' },
  { at: SECTIONS.close.from, scene: 7, label: 'COACHLENS / EVEN G2' },
]

// ── Whips: frames where the whole picture is rendered with camera motion blur ─────────────────
/** Each whip is centred on a cut: 3 frames out, 3 frames in. */
export const WHIP_LEN = 6
export const WHIPS: readonly number[] = [
  T.hook.min45, T.hook.coach, T.reveal.marquee, T.sentence.typed, T.sentence.urgent, T.sentence.phone,
  T.notes.pr, T.notes.brief, T.notes.ask, T.notes.roll, T.notice.phone, T.notice.wrapup,
  T.control.autonomy, T.control.agents, T.control.priya, ...T.control.montage,
]
export const inWhip = (f: number): boolean => WHIPS.some(w => f >= w - WHIP_LEN / 2 && f < w + WHIP_LEN / 2)

// ── Footage slots (SHOTLIST.md) ───────────────────────────────────────────────────────────────
export const SLOTS = {
  A: { from: T.quiet.lobby, to: SECTIONS.quiet.to, shot: 'Through the lens: lobby, double-tap, plan the class out loud, the plan diff lands (7 s).' },
  B: { from: T.notes.pr, to: T.notes.askCard, shot: 'Through the lens in class: the PR card, then the "How\'s Priya doing?" brief (9.5 s).' },
  C: { from: T.control.autonomy, to: T.control.teach, shot: 'Phone: Agents → Parent emails → Auto·Review·Off set to Review, the Agents tiles, a student profile (14 s).' },
} as const

// ── Typewriter lines (their keystrokes are sound cues too) ────────────────────────────────────
export type TypeLine = { id: string; text: string; at: number; cps: number }
export const TYPED: readonly TypeLine[] = [
  { id: 'priya', text: '“Priya keeps dropping her guard on the jab.”', at: T.sentence.typed + 4, cps: 34 },
  { id: 'ask', text: '“Who is forgetting to keep their guard up?”', at: T.notes.ask + 2, cps: 40 },
  { id: 'built', text: 'Built for coaches & teachers:', at: T.origin.built + 6, cps: 22 },
]
export const typedChars = (line: TypeLine, frame: number): number =>
  Math.max(0, Math.min(line.text.length, Math.floor(((frame - line.at) / FPS) * line.cps)))
export const typedLine = (id: string): TypeLine => {
  const l = TYPED.find(t => t.id === id)
  if (!l) throw new Error(`No typed line ${id}`)
  return l
}

// ── Sound cues ────────────────────────────────────────────────────────────────────────────────
/** `f` is the frame the sound's hit lands on. `len` (seconds) only for risers: the tail of the build. */
export type Cue = { f: number; s: SfxName; v?: number; rate?: number; len?: number }

const typingCues = (): Cue[] =>
  TYPED.flatMap(line => {
    const out: Cue[] = []
    for (let c = 1; c <= line.text.length; c += 2) {
      const f = line.at + Math.round((c / line.cps) * FPS)
      if (line.text[c - 1] === ' ') continue
      out.push({ f, s: 'typing-laptop', v: 0.7 + ((c * 37) % 5) * 0.08, rate: 0.9 + ((c * 13) % 7) * 0.04 })
    }
    return out
  })

const FLASH_SFX: readonly SfxName[] = [
  'whoosh-air', 'swoosh-fast', 'whoosh-pop-light', 'sweep-fast-small', 'whoosh-cinematic-fast', 'swoosh-fast', 'select-tech',
  'sweep-fast-small', 'click-check', 'swoosh-fast', 'select-tech', 'confirm-scifi', 'click-device', 'select-tech', 'confirm-scifi',
]

const RAW_CUES: Cue[] = [
  // Hook
  { f: T.hook.kids20, s: 'impact-heartbeat-deep' },
  { f: T.hook.kidsWord, s: 'swoosh-fast' },
  { f: T.hook.min45, s: 'whoosh-air' },
  { f: T.hook.minWord, s: 'sweep-fast-small' },
  { f: T.hook.coach, s: 'whoosh-cinematic-fast' },
  { f: T.hook.hands, s: 'glitch-text-intro' },
  { f: T.hook.tasks[0], s: 'swoosh-fast', v: 0.8 },
  { f: T.hook.tasks[1], s: 'select-tech' },
  { f: T.hook.tasks[2], s: 'sweep-fast-small', v: 0.8 },
  { f: T.hook.tasks[3], s: 'click-check' },
  { f: T.hook.noProblem, s: 'impact-tech-break' },
  // Reveal
  { f: T.reveal.classStart, s: 'whoosh-pop-light' },
  { f: T.reveal.lit1, s: 'bleep-notify' },
  { f: T.reveal.lit2, s: 'notify-positive' },
  { f: T.reveal.serif, s: 'tone-quick', v: 0.8 },
  { f: T.reveal.irisOpen, s: 'zoom-in' },
  { f: T.reveal.wordmark, s: 'impact-whoosh-deep' },
  { f: T.reveal.marquee, s: 'whoosh-fast' },
  { f: T.reveal.seven, s: 'select-option' },
  { f: T.reveal.zero, s: 'confirm-scifi' },
  // Quiet by design (breakdown: sparse and soft)
  { f: T.quiet.dolly + 24, s: 'zoom-in-long', v: 0.7 },
  { f: T.quiet.tap, s: 'click-device' },
  { f: T.quiet.peek, s: 'ui-start' },
  { f: T.quiet.lobby, s: 'slide-tech', v: 0.8 },
  { f: T.quiet.planning, s: 'select-tech', v: 0.7 },
  { f: T.quiet.diff, s: 'bleep-notify' },
  { f: SECTIONS.sentence.from, s: 'riser-synth', len: 4 },
  // One sentence in (drop)
  { f: T.sentence.rec, s: 'impact-tech-break' },
  { f: T.sentence.talk, s: 'swoosh-fast' },
  { f: T.sentence.typed, s: 'whoosh-air' },
  { f: T.sentence.card, s: 'zoom-move' },
  { f: T.sentence.ticks[0], s: 'bleep-notify' },
  { f: T.sentence.ticks[1], s: 'select-tech' },
  { f: T.sentence.ticks[2], s: 'bleep-confirm' },
  { f: T.sentence.card + 94, s: 'click-check', v: 0.7 },
  { f: T.sentence.ticks[3], s: 'notify-positive' },
  { f: T.sentence.outcomes[0], s: 'sweep-fast-small' },
  { f: T.sentence.outcomes[1], s: 'swoosh-fast' },
  { f: T.sentence.outcomes[2], s: 'whoosh-pop-light' },
  { f: T.sentence.outcomes[3], s: 'sweep-fast-small' },
  { f: T.sentence.summary, s: 'confirm-scifi' },
  { f: T.sentence.urgent, s: 'glitch-quick' },
  { f: T.sentence.urgentLens + 21, s: 'pop-notify' },
  { f: T.sentence.urgentLens + 60, s: 'bleep-confirm' },
  { f: T.sentence.phone, s: 'whoosh-cinematic-fast' },
  { f: T.sentence.phoneZoom, s: 'zoom-in' },
  // Real notes (drop)
  { f: T.notes.prCard, s: 'whoosh-air' },
  { f: T.notes.pr, s: 'swoosh-fast' },
  { f: T.notes.pr + 27, s: 'bleep-notify' },
  { f: T.notes.pr + 54, s: 'notify-positive' },
  { f: T.notes.checkCard, s: 'sweep-fast-small' },
  { f: T.notes.brief, s: 'whoosh-pop-light' },
  { f: T.notes.brief + 27, s: 'pop-notify' },
  { f: T.notes.askCard, s: 'whoosh-air' },
  { f: T.notes.ask, s: 'swoosh-fast' },
  { f: T.notes.names[0], s: 'bleep-notify' },
  { f: T.notes.names[1], s: 'select-tech' },
  { f: T.notes.names[2], s: 'bleep-confirm' },
  { f: T.notes.names[3], s: 'confirm-scifi' },
  { f: T.notes.rollCard, s: 'whoosh-cinematic-fast' },
  { f: T.notes.roll, s: 'swoosh-fast' },
  { f: T.notes.rollDone, s: 'notify-positive' },
  // Agents that notice
  { f: T.notice.banner, s: 'whoosh-fast' },
  { f: T.notice.slam, s: 'impact-zoom-quick' },
  { f: T.notice.phone, s: 'whoosh-air' },
  { f: T.notice.scroll, s: 'swoosh-fast' },
  { f: T.notice.working, s: 'click-device' },
  { f: T.notice.drafted, s: 'notify-positive' },
  { f: T.notice.reviewTap, s: 'click-check' },
  { f: T.notice.review, s: 'sweep-fast-small' },
  { f: T.notice.words[0], s: 'whoosh-pop-light' },
  { f: T.notice.words[1], s: 'swoosh-fast' },
  { f: T.notice.words[2], s: 'sweep-fast-small' },
  { f: T.notice.wrapup, s: 'whoosh-cinematic-fast' },
  { f: T.notice.missed, s: 'slide-tech', v: 0.9 },
  { f: T.notice.tap, s: 'click-device' },
  { f: T.notice.nextClass, s: 'bleep-confirm' },
  // Originality (breakdown, then the drop on the 0)
  { f: T.origin.count, s: 'tone-quick', v: 0.7 },
  { f: T.origin.serif, s: 'whoosh-pop-light', v: 0.5 },
  { f: T.origin.zero, s: 'riser-stutter-short', len: 3.6 },
  { f: T.origin.zero, s: 'impact-logo' },
  { f: T.origin.untilNow, s: 'whoosh-air' },
  // Control (drop)
  { f: T.control.autonomy, s: 'whoosh-cinematic-fast' },
  { f: T.control.tapReview, s: 'click-device' },
  { f: T.control.tapReview + 3, s: 'select-option' },
  { f: T.control.card, s: 'glitch-small' },
  { f: T.control.agents, s: 'whoosh-pop-light' },
  { f: T.control.agents + 45, s: 'bleep-confirm' },
  { f: T.control.kidCard, s: 'sweep-fast-small' },
  { f: T.control.priya, s: 'swoosh-fast' },
  { f: T.control.priya3, s: 'zoom-move' },
  { f: T.control.montage[0], s: 'whoosh-air' },
  { f: T.control.montage[1], s: 'swoosh-fast' },
  { f: T.control.montage[2], s: 'sweep-fast-small' },
  { f: T.control.montage[3], s: 'click-check' },
  { f: T.control.teach, s: 'whoosh-stutter', v: 0.9 },
  { f: SECTIONS.finale.from, s: 'sweep-scifi-fast', len: 2 },
  // Finale: one sound per flash-by, rotating, getting smaller as the cuts speed up
  { f: SECTIONS.finale.from, s: 'impact-whoosh-deep' },
  ...FLASH_STARTS.slice(1).map((f, i): Cue => ({ f, s: FLASH_SFX[i] ?? 'select-tech', v: i < 6 ? 0.85 : 0.65 })),
  { f: (FLASH_STARTS[15] ?? 0) + 40, s: 'click-device' },
  { f: (FLASH_STARTS[15] ?? 0) + 82, s: 'select-tech' },
  // Close
  { f: T.close.iris, s: 'impact-logo' },
  { f: T.close.lines + 30, s: 'power-up', v: 0.6 },
  ...typingCues(),
]
export const CUES: readonly Cue[] = [...RAW_CUES].sort((a, b) => a.f - b.f)
