/**
 * THE timeline. Every scene, cut, field flip, word, whip and sound effect is placed here, on the
 * music's beat grid. Scenes read their shot times from `T`; the soundtrack reads `CUES`.
 *
 * One track only (Mixkit "Minimal Techno 01"): 120 BPM, a kick on track 0.0 s and every 0.5 s after,
 * so it plays from 0 and track time = film time: a beat is 15 frames, a bar 60, an 8-bar phrase 16 s.
 * Breakdowns at 24–40 s (frames 720–1200) and 96–104 s (2880–3120). The track goes soft after
 * ~136 s, so at film 124 s (a bar line) the music cuts back to track 104 s, the start of its drop
 * phrase, and plays 104→130 s for film 124→150 s: same tempo, same grid, same texture.
 *
 * Readability rule (v3): every text card holds at least max(1.2 s, 0.4 s + 0.25 s × words) from fully
 * landed to cut. Only the end-of-finale flicker is exempt.
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

/** Where the music jumps back into the track's drop phrase (film frame → track second). */
export const MUSIC_JUMP_AT = bar(62)
export const MUSIC_JUMP_TO_SEC = 104
export const FINALE_AT = SECTIONS.finale.from

// ── Shot times (global frames) ────────────────────────────────────────────────────────────────
export const T = {
  hook: {
    kids20: 0, kidsWord: beat(1), kidsSerif: beat(2),
    min45: bar(1), minWord: bar(1) + beat(1),
    coach: bar(2), coachSerif: bar(2) + beat(2),
    hands: bar(3),
    /** The task list lands on eighth notes and holds as one card. */
    tasks: [beat(15), beat(15.5), beat(16), beat(16.5)],
    noProblem: bar(5), noSerif: bar(5) + beat(2),
  },
  reveal: {
    classStart: bar(6), lit1: bar(6) + beat(2), lit2: bar(6) + beat(5), serif: bar(7),
    ring: bar(8), irisOpen: bar(8) + beat(1), wordmark: bar(8) + beat(2), tagline: bar(8) + beat(3),
    marquee: bar(10), seven: bar(10) + beat(1), zero: bar(11),
  },
  quiet: {
    g2: bar(12), serif: bar(12) + beat(3), tap: bar(14), dolly: bar(14) + 6, glass: sec(30),
    peek: sec(30), lobby: sec(33), planning: sec(35.5), planResult: sec(37.5), diff: sec(38.4),
  },
  sentence: {
    rec: bar(20), talk: bar(20) + beat(1), typed: bar(21), card: beat(91),
    summary: beat(99), urgent: beat(106), urgentLens: beat(107), phone: beat(113), phoneZoom: beat(115),
  },
  notes: {
    prCard: bar(30), pr: beat(123), checkCard: beat(130), brief: beat(134),
    askCard: beat(141), ask: bar(36), answer: bar(37), names: [beat(148.5), beat(149), beat(149.5), beat(150)],
    rollCard: beat(153), roll: bar(39), rollDone: bar(39) + 22,
  },
  notice: {
    banner: bar(40), slam: bar(40) + beat(2), serif: bar(40) + beat(3),
    phone: beat(166), working: beat(169), scroll: beat(169) + 2, drafted: beat(171.5), reviewTap: beat(173.5), review: beat(174),
    words: [beat(178), beat(178.5), beat(179)], wrapup: bar(46), missed: beat(187), tap: beat(187.5), nextClass: beat(187.5) + 2,
  },
  origin: {
    count: bar(48), serif: bar(48) + beat(2), built: bar(50), zero: bar(52), shakeEnd: bar(52) + 12, untilNow: bar(53),
  },
  control: {
    autonomy: bar(54), tapReview: bar(55) + beat(1), card: bar(56), agents: beat(227), kidCard: beat(234),
    priya: beat(237), priya3: beat(239), montage: [bar(60), bar(60) + beat(1.5), bar(60) + beat(3), bar(60) + beat(4.5)], teach: beat(246),
  },
  close: { iris: sec(146), lines: sec(146) + 8 },
} as const

// ── Finale: an exponentially accelerating stream of coaches ───────────────────────────────────
export const USE_CASES: readonly { role: string; line: string }[] = [
  { role: 'Football coach', line: '#12 late off the snap · 3rd time' },
  { role: 'Math tutor', line: 'Sam: distribute the negative' },
  { role: 'Martial arts', line: 'Priya · guard (3rd time)' },
  { role: 'Classroom teacher', line: "Row 3 hasn't spoken today" },
  { role: 'Personal trainer', line: 'Maria · deadlift PR +10' },
  { role: 'Swim coach', line: 'Lane 4 · 50m split -0.8s' },
  { role: 'Basketball coach', line: 'Jay · elbow out on the jumper' },
  { role: 'Piano teacher', line: 'Ava · left-hand tempo' },
  { role: 'Choir director', line: 'Altos · flat on the high G' },
  { role: 'ESL tutor', line: 'Lin · past tense, 4 of 5' },
  { role: 'Dance instructor', line: 'Leo · late on the 5-6-7-8' },
  { role: 'Robotics mentor', line: 'Team 2 · gearbox slipping' },
  { role: 'Climbing coach', line: 'Nina · flag the left foot' },
  { role: 'Lifeguard instructor', line: 'Omar · rescue tow 0:41' },
  { role: 'Gymnastics coach', line: 'Zoe · bent knees on the kip' },
  { role: 'Boxing coach', line: 'Rico · dropping the right' },
  { role: 'Debate coach', line: 'Theo · rebuttal ran 40s long' },
  { role: 'Rowing coach', line: 'Seat 3 · rushing the slide' },
  { role: 'Golf pro', line: 'Dan · open face at impact' },
  { role: 'Art teacher', line: 'Mia · shading, 2nd week' },
  { role: 'Chemistry lab TA', line: 'Bench 4 · goggles off' },
  { role: 'Soccer coach', line: 'Back line · step up together' },
  { role: 'Orchestra conductor', line: 'Cellos · rushing bar 32' },
  { role: 'CPR instructor', line: 'Pat · compressions too shallow' },
  { role: 'Ski instructor', line: 'Ella · weight on the back seat' },
  { role: 'Yoga instructor', line: 'Kim · knee past toes' },
  { role: 'Surf coach', line: 'Ben · popping up too late' },
  { role: 'Flight instructor', line: 'Flare high · 3rd landing' },
  { role: 'Esports coach', line: 'Mid · rotate 10s earlier' },
  { role: 'Speech coach', line: 'Ana · filler words: 14' },
  { role: 'Tennis coach', line: 'Max · split-step late' },
  { role: 'Cheer coach', line: 'Base 2 · late on the lift' },
  { role: 'Track coach', line: 'Kai · 200m split 27.4' },
  { role: 'Volleyball coach', line: 'Sky · platform too high' },
  { role: 'Baseball coach', line: 'Cole · dropping the back elbow' },
  { role: 'Chess coach', line: 'Ari · hung a piece twice' },
  { role: 'Hockey coach', line: 'Line 2 · slow off the bench' },
  { role: 'Wrestling coach', line: 'Gus · head down on the shot' },
  { role: 'Fencing coach', line: 'Ivy · lunge too early' },
  { role: 'Pilates instructor', line: 'Row 2 · ribs flaring' },
  { role: 'Cycling coach', line: 'Zone 4 · cadence 82' },
  { role: 'SAT tutor', line: 'Noor · reading pace +2 min' },
  { role: 'Coding bootcamp', line: 'Team B · tests still red' },
  { role: 'Kindergarten teacher', line: 'Sunflowers · 3 need help' },
  { role: 'Special-ed teacher', line: 'Eli · break at 10:15' },
  { role: 'Riding instructor', line: 'Rosa · heels down' },
  { role: 'Music theory teacher', line: 'Quiz · 6/9 on cadences' },
  { role: 'Language teacher', line: 'Hugo · subjunctive again' },
  { role: 'Sign-language teacher', line: 'Row 1 · handshape for "work"' },
  { role: 'Driving instructor', line: 'Check blind spot · 2nd time' },
]
const FIELD_CYCLE: readonly FieldName[] = ['orange', 'cobalt', 'paper', 'green', 'black', 'cobalt', 'orange', 'paper', 'black', 'green']
/** "Your class." lands on this beat (141.0 s) with an impact and holds to the close. */
export const YOUR_CLASS_AT = beat(282)

/**
 * Card durations: two readable holds (1.2 s each), then ×0.68 per card down to a 2–3-frame flicker
 * (about card 9), then a long dense stream on the 1/24-note grid (2.5 frames: sextuplet sixteenths of
 * 120 BPM) until "Your class." lands. Cut times are quantised to that 2.5-frame grid.
 */
const FLICKER = BEAT / 6
const buildFlash = (): number[] => {
  const d: number[] = [36, 36]
  let x = 36
  while (x * 0.68 >= FLICKER) {
    x *= 0.68
    d.push(x)
  }
  const total = YOUR_CLASS_AT - FINALE_AT
  let used = d.reduce((a, b) => a + b, 0)
  while (used + FLICKER <= total + 0.01) {
    d.push(FLICKER)
    used += FLICKER
  }
  const starts: number[] = []
  let t = 0
  for (const dur of d) {
    const f = FINALE_AT + Math.round(Math.round(t / FLICKER) * FLICKER)
    if (f < YOUR_CLASS_AT && f !== starts[starts.length - 1]) starts.push(f)
    t += dur
  }
  return starts
}
/** Start frame of every flash-by card (the "Your class." card starts at YOUR_CLASS_AT). */
export const FLASH_STARTS: readonly number[] = buildFlash()
/** Frames each flash-by card is on screen. */
export const flashLen = (i: number): number => (FLASH_STARTS[i + 1] ?? YOUR_CLASS_AT) - (FLASH_STARTS[i] ?? FINALE_AT)
/**
 * Photosensitivity guard: in the 2–3-frame stream only the type changes per card; the full-screen
 * colour field changes once per beat (2 Hz), under the 3-flashes-per-second guideline.
 */
const flashField = (i: number): FieldName => {
  if (flashLen(i) >= 8) return FIELD_CYCLE[i % FIELD_CYCLE.length] ?? 'black'
  const b = Math.floor(((FLASH_STARTS[i] ?? FINALE_AT) - FINALE_AT) / BEAT)
  return FIELD_CYCLE[b % FIELD_CYCLE.length] ?? 'black'
}
export const flashCard = (i: number): { role: string; line: string; field: FieldName; index: number } => {
  const u = USE_CASES[i % USE_CASES.length] ?? USE_CASES[0] ?? { role: '', line: '' }
  return { ...u, field: flashField(i), index: (i % USE_CASES.length) + 1 }
}

// ── Colour fields (the global background), flipped on downbeats ──────────────────────────────
export type FieldCut = { at: number; field: FieldName; wipe?: 'left' | 'up' | 'iris' }
export const FIELDS: readonly FieldCut[] = [
  { at: T.hook.kids20, field: 'orange' },
  { at: T.hook.min45, field: 'cobalt', wipe: 'left' },
  { at: T.hook.coach, field: 'paper', wipe: 'up' },
  { at: T.hook.hands, field: 'black' },
  { at: T.hook.tasks[0], field: 'cobalt', wipe: 'left' },
  { at: T.hook.noProblem, field: 'green', wipe: 'iris' },
  { at: T.reveal.classStart, field: 'black' },
  { at: T.reveal.marquee, field: 'cobalt', wipe: 'left' },
  { at: T.quiet.g2, field: 'black' },
  { at: T.sentence.rec, field: 'cobalt' },
  { at: T.sentence.typed, field: 'black' },
  { at: T.sentence.summary, field: 'cobalt', wipe: 'left' },
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
  { at: T.notice.words[0], field: 'cobalt', wipe: 'up' },
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
  ...FLASH_STARTS.map((at, i) => ({ at, field: flashCard(i).field })).filter((c, i, all) => i === 0 || c.field !== all[i - 1]?.field),
  { at: YOUR_CLASS_AT, field: 'black' },
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
  { at: SECTIONS.origin.from, scene: 6, label: 'ORIGINALITY / 0 OF 220+' },
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
  B: { from: T.notes.pr, to: T.notes.askCard, shot: 'Through the lens in class: the PR card, then the "How\'s Priya doing?" brief (9 s).' },
  C: { from: T.control.autonomy, to: T.control.teach, shot: 'Phone: Agents → Parent emails → Auto·Review·Off set to Review, the Agents tiles, a student profile (14 s).' },
} as const

// ── Typewriter lines (their keystrokes are sound cues too) ────────────────────────────────────
export type TypeLine = { id: string; text: string; at: number; cps: number }
export const TYPED: readonly TypeLine[] = [
  { id: 'priya', text: '“Priya keeps dropping her guard on the jab.”', at: T.sentence.typed + 3, cps: 52 },
  { id: 'ask', text: '“Who is forgetting to keep their guard up?”', at: T.notes.ask + 2, cps: 44 },
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

/** One sound per readable flash-by; the stream itself rides the riser. */
const FLASH_SFX: readonly SfxName[] = ['whoosh-air', 'swoosh-fast', 'whoosh-pop-light', 'sweep-fast-small', 'whoosh-cinematic-fast', 'swoosh-fast', 'select-tech', 'sweep-fast-small', 'click-check', 'swoosh-fast', 'select-tech']
const flashCues = (): Cue[] => {
  const out: Cue[] = []
  for (let i = 1; i < FLASH_STARTS.length; i++) {
    const f = FLASH_STARTS[i] ?? 0
    const len = (FLASH_STARTS[i + 1] ?? YOUR_CLASS_AT) - f
    if (len >= 10 && out.length < FLASH_SFX.length) out.push({ f, s: FLASH_SFX[out.length] ?? 'select-tech', v: len > 30 ? 0.85 : 0.6 })
  }
  return out
}

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
  { f: T.hook.tasks[2], s: 'click-check' },
  { f: T.hook.tasks[3], s: 'confirm-scifi' },
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
  { f: T.quiet.g2 + 20, s: 'slide-tech', v: 0.6 },
  { f: T.quiet.tap, s: 'click-device' },
  { f: T.quiet.tap + 4, s: 'ui-start' },
  { f: T.quiet.glass - 4, s: 'zoom-in-long', v: 0.7 },
  { f: T.quiet.lobby, s: 'whoosh-pop-light', v: 0.6 },
  { f: T.quiet.planning, s: 'select-tech', v: 0.7 },
  { f: T.quiet.diff, s: 'bleep-notify' },
  { f: SECTIONS.sentence.from, s: 'sweep-scifi-fast', len: 2, v: 0.6 },
  // One sentence in (drop)
  { f: T.sentence.rec, s: 'impact-tech-break' },
  { f: T.sentence.talk, s: 'swoosh-fast' },
  { f: T.sentence.typed, s: 'whoosh-air' },
  { f: T.sentence.card, s: 'zoom-move' },
  { f: T.sentence.card + 48, s: 'bleep-notify' },
  { f: T.sentence.card + 54, s: 'select-tech' },
  { f: T.sentence.card + 60, s: 'bleep-confirm' },
  { f: T.sentence.card + 68, s: 'click-check', v: 0.7 },
  { f: T.sentence.card + 76, s: 'notify-positive' },
  { f: T.sentence.summary, s: 'sweep-fast-small' },
  { f: T.sentence.summary + 11, s: 'select-tech' },
  { f: T.sentence.summary + 26, s: 'confirm-scifi' },
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
  { f: T.notice.working, s: 'click-device' },
  { f: T.notice.scroll, s: 'swoosh-fast' },
  { f: T.notice.drafted, s: 'notify-positive' },
  { f: T.notice.reviewTap, s: 'click-check' },
  { f: T.notice.review, s: 'sweep-fast-small' },
  { f: T.notice.words[0], s: 'whoosh-pop-light' },
  { f: T.notice.words[1], s: 'select-tech' },
  { f: T.notice.words[2], s: 'bleep-confirm' },
  { f: T.notice.wrapup, s: 'whoosh-cinematic-fast' },
  { f: T.notice.missed, s: 'slide-tech', v: 0.9 },
  { f: T.notice.tap, s: 'click-device' },
  { f: T.notice.nextClass + 2, s: 'notify-positive' },
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
  // Finale: an impact on the jump, a sound per readable card, a long riser under the acceleration
  { f: SECTIONS.finale.from, s: 'impact-whoosh-deep' },
  ...flashCues(),
  { f: YOUR_CLASS_AT, s: 'whoosh-stutter', v: 0.7 },
  { f: YOUR_CLASS_AT, s: 'impact-tech-break' },
  { f: YOUR_CLASS_AT + 40, s: 'click-device' },
  { f: YOUR_CLASS_AT + 82, s: 'select-tech' },
  // Close
  { f: T.close.iris, s: 'impact-logo' },
  { f: T.close.lines + 30, s: 'power-up', v: 0.6 },
  ...typingCues(),
]
export const CUES: readonly Cue[] = [...RAW_CUES].sort((a, b) => a.f - b.f)
