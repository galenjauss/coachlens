# CoachLens launch film v2: brief (replaces BRIEF.md where they conflict)

**The user's verdict on v1:** "really bad". Repetitive noises, barely any interesting motion or transitions, product screens that look completely fake and unlike the actual CoachLens, the same tempo everywhere, and the use-case grid should have been individual flash-bys. They want it **upbeat, fast-paced, dynamic and interesting to watch**, on CoachLens themes.

**References the user supplied** (frames are in the scratchpad; the summary below is what matters):
1. **"Claude motion reel 2026" (two pieces).**
   - **Beat lock:** every cut and move is locked to a 128 BPM beat, and a full-bleed color field changes every 1–2 bars (orange-red, cobalt blue, yellow, near-black).
   - **HUD chrome on every frame:** corner brackets, top-left "CLAUDE — MOTION REEL 2026", top-right "BAR 5/8 · 128 BPM" or "SCENE 05 / 07", bottom-left section label "GENERATIVE / PARTICLES", bottom-right timecode.
   - **Kinetic type:** giant words sliding in with motion blur, a serif italic accent line ("motion design"), marquee rows of words with dot separators, text on a curved path.
   - **Generative motifs:** particle rings and phyllotaxis, a wireframe 3D cube, a snake line that draws across, liquid superformula blobs. A product UI card appears with a toast ("900 frames rendered").
   - **Pacing:** something changes every 1–2 seconds.
2. **"Tables" product film.**
   - The REAL product UI, shown in 3D-perspective tilted windows on soft gradient backgrounds.
   - **Camera moves:** dolly and push into the UI; whip-pan blur transitions; rack focus (blur to sharp) on rows.
   - A cursor moves and clicks, and values fill in (progress bars to "9/10").
   - Agent step lists tick on ("Checked…", "Looked up…", "Searched…"), and a big plain headline card shows the feature ("Reveal them right inside LinkedIn") with a highlight sweep.

## Non-negotiables

- **Real product only.** Lens imagery comes ONLY from `video/public/captures/lens/**`, which are true simulator captures of the real app (576×288 RGBA; green lit pixels on transparent).
  - Upscale them with `image-rendering: pixelated` or crisp scaling. Add phosphor glow (stacked drop-shadows in lens green) and the lens/glass framing around them.
  - NEVER redraw lens UI with fonts.
- **Phone imagery** comes ONLY from `video/public/captures/phone/**` (real app screenshots with real seeded data), shown in an iPhone-style frame with a 3D tilt.
  - Animate between real frames (crossfade, slide, or a cursor tap with a ripple and a "click-device" SFX).
  - Never recreate phone UI.
- `video/public/captures/manifest.json` describes every flow and frame; use it.
- **Real audio only, from `video/public/audio/`** (Mixkit, licensed). See `SOURCES.md`.
  - **Music:** `music/main-minimal-techno-120bpm.mp3` is 120 BPM. Its first beat is at 0.488 s, so start the audio at 0.488 s to put beat 1 on frame 0; a beat is 15 frames and a bar 60 frames at 30 fps.
    - Its energy map: full energy 0–24 s → **breakdown 24–40 s** → drop 40–96 s → **breakdown 96–104 s** → 104–136 s → softer from 136 s.
    - Build the edit ON this structure: breakdowns are the slow, deliberate, "quiet by design" moments; drops are the fast-cut demo.
  - **Finale:** at about 2:04, hand off over a riser (`sfx/riser-stutter-short` or `riser-synth`) and a cut into `music/finale-pick-it-up-175bpm.mp3` (175 BPM; a beat is about 10.3 frames). Start it at a high-energy section (try about 20 s in, and check `energyChangesSec` near 73 s). This is the tempo change the user asked for.
  - **SFX:** never use the same sound twice in a row; rotate variants.
    - Whooshes (9 kinds) on transitions.
    - `typing-laptop` under typewriter text.
    - `click-*` / `select-*` on taps.
    - `bleep-*` / `pop-notify` / `notify-positive` when cards and agent results appear.
    - `glitch-*` on color-field flips (sparingly).
    - `impact-*` on big words and the "0".
    - `zoom-*` on camera push-ins.
    - `riser-*` before drops.
    - Mix SFX about 6–10 dB under music, except for impacts. Fade the music out cleanly at the end. No clipping: check the peak.
- **Tempo variety:**
  - Drops cut every 1–2 beats.
  - Breakdowns hold 2–4 s with slow, smooth camera moves.
  - The finale flash-bys cut on every 175 BPM beat (about 0.34 s) or every 2 beats, accelerating.
- **Readability:** each lens or phone frame that carries a key message holds at least about 1.2 s. Captions are short, big and burned in.

## Visual language (CoachLens edition of the references)

- **Palette:**
  - `#07090A` black, with lens green `#3DFF7A` (the brand / lens color);
  - full-bleed field colors for flips:
    - signal orange `#FF5B1F` (urgent, insight);
    - cobalt `#2B46FF` (agents, data);
    - lens green (for "the lens");
    - off-white `#ECEFEA` (for type-on-paper moments).
  - Black type on bright fields and off-white type on dark ones.
- **HUD chrome on every frame:** corner brackets; top-left `COACHLENS — LAUNCH FILM 2026`; top-right a live `BAR n/8 · 120 BPM` (the finale switches to `175 BPM`) or `SCENE 0n / 07`; bottom-left a section label (`HOOK / KINETIC TYPE`, `LENS / QUIET BY DESIGN`, `AGENTS / ONE SENTENCE IN`, `INSIGHTS / OPPORTUNISTIC`, `ORIGINALITY / 0 OF 220+`, `EVERY COACH / FLASH`); bottom-right a timecode `00:00:12:08`. JetBrains Mono, small and spaced.
- **Type:**
  - Inter Tight 800 for giant kinetic words. Slide in with motion blur (CSS blur on the motion axis during fast springs), with occasional mask reveals and per-letter staggers.
  - An italic serif accent ("Instrument Serif" italic) for lines like *coaching, heads-up* or *agents that notice*.
- **Motifs tied to CoachLens:**
  - **A class of 20:** a particle ring, phyllotaxis or grid of dots; dots light up as kids get feedback.
  - **Agents:** connector lines that draw from a card to outcomes.
  - **Marquee rows:** `FEEDBACK • ATTENDANCE • PARENT EMAILS • REPORT CARDS • LESSON PLANS • INSIGHTS • PRs • QUESTIONS`. One straight row, plus one on a curved path.
  - **The lens ring:** the app icon ring and focus dot as a recurring transition wipe (a circle iris in or out).
  - **A wireframe G2:** a simple 3D-ish wireframe of the glasses or lens that rotates (built from SVG lines with a perspective transform), used in the reveal.
- **Real UI moments, done like "Tables":**
  - Real lens captures and phone captures float in 3D: `perspective(1600px) rotateY(-18deg) rotateX(8deg)`, with a soft gradient (green to black, or cobalt to black) behind them.
  - The camera dollies in (scale 1 → 1.35 over a phrase), with whip-blur transitions between shots and a rack focus.
  - A cursor taps phone buttons, with a ripple and a click SFX.
  - Agent progress ticks from the real captured frames.

## Timeline (150 s at 30 fps = 4500 frames; edit to the music)

| Time | Music | Section | What happens |
|---|---|---|---|
| 0:00–0:12 | full | **Hook** | Beat-cut kinetic type on flipping fields. "20 kids." on orange, then "45 minutes." on cobalt, then "Hands full?" (a glitch) on black, then "**No problem.**" on lens green, landing on a bar downbeat with an impact. A class dot-ring spins behind the words. |
| 0:12–0:24 | full | **Problem → reveal** | 20 dots; the class timer runs; only 2 light. Serif line *"by dinner, I remember two."* Iris wipe through the lens ring into the wordmark "CoachLens", with the tagline *hands-free AI agents for coaches, on Even G2*. Marquee rows of agent actions sweep across. |
| 0:24–0:40 | **breakdown** | **Quiet by design** | Slow. The wireframe G2 rotates in. The lens is dark (real `dark` capture: pure black in the glass). HUD label `LENS / QUIET BY DESIGN`. A soft tap ripple, then the real `peek` capture fades up with phosphor glow and the timer frames animate (real captures). Serif caption *"dark until it matters."* Then lobby → planning (real captures with growing heard text) → planResult, each held about 2.5 s, with slow dolly-ins. |
| 0:40–1:00 | **drop** | **One sentence in, outcomes out** | Hard cut on the drop. The real recording capture (mic pulse frames), then the typewriter line "Priya keeps dropping her guard on the jab" with typing SFX, then the real card frames (provisional, then final with agent ticks). Connector lines shoot out to big kinetic outcome words on cobalt: PROGRESS · REPORT CARD · NEXT PLAN · COVERAGE, cut on beats. Whip to the urgent Dee card (orange field flash), then a phone capture of the Review email draft tilting in 3D. |
| 1:00–1:20 | drop | **Real notes, rapid** | Footage slot B (real footage if present; fallback = real captures): PR card, brief card, answer card ("who is forgetting to keep their guard up?" with the ANSWER card; the names pop in with bleeps). Cut every 1–2 beats, alternating full-bleed type cards ("ASK THE CLASS", "LOG A PR", "CHECK ON A KID") with the real lens captures. |
| 1:20–1:36 | drop | **Agents that notice** | Orange field. "★ Jake's back after 3 missed": the real banner capture slams in. Then the phone "From your agents" capture in 3D; the cursor taps **Do it**, through the real "Working…" and outcome frames. Insight words fly by: GUS READY TO TEST · NOAH GRADE DROP · ELI NO FEEDBACK. Then the real wrapup capture with a highlight sweep on "Missed:"; tap; "first next class". |
| 1:36–1:44 | **breakdown** | **Originality** | Near silence. A counter rolls "220+" (*G2 apps we checked*). Hold. "Built for coaches & teachers:" |
| 1:44–2:04 | **drop** | **0 → until now → control** | On the drop: a giant "0" with `impact-logo` and a screen shake. Then *"until now."* Then phone captures: the autonomy control (Auto · Review · Off) with a cursor setting Review; Agents tiles; Priya's profile. Fast push-ins. Footage slots A and C if present (A = lobby/planning, C = phone), otherwise the real-capture fallbacks. |
| 2:04–2:26 | **finale track 175 BPM** | **Every coach (flash-bys)** | Riser into a hard cut. One FULL-SCREEN card per coach type, each on its own color field with a giant role name in Inter Tight 800, a tiny HUD tag `USE CASE 03/16`, and a real-style lens line in green on a black lens strip. Cut on every beat or every 2 beats, accelerating toward the end. The 16 roles (role · lens line): football coach · `#12 late off the snap · 3rd time`; math tutor · `Sam: distribute the negative`; martial arts · `Priya · guard (3rd time)`; classroom teacher · `Row 3 hasn't spoken today`; personal trainer · `Maria · deadlift PR +10`; swim coach · `Lane 4 · 50m split -0.8s`; piano teacher · `Ava · left-hand tempo`; dance instructor · `Leo · late on the 5-6-7-8`; climbing coach · `Nina · flag the left foot`; debate coach · `Theo · rebuttal ran 40s long`; soccer coach · `Back line · step up together`; yoga instructor · `Kim · knee past toes`; tennis coach · `Max · split-step late`; chess coach · `Ari · hung a piece twice`; driving instructor · `Check blind spot · 2nd time`; your class · `> Tap to start class`. (The lens strip is the one allowed exception to "never redraw the lens": these are hypothetical use cases, so render the line in a pixel-crisp font that matches the captures, and keep it small.) Under it all, the curved marquee "ANY ROOM • ANY COACH •". |
| 2:26–2:30 | finale end | **Close** | An iris through the lens ring to black: the "CoachLens" wordmark with `STORE_LINE` ("Now on the Even Hub store", from `src/config.ts`), and the serif line *teach the class. CoachLens runs the follow-up.* Final impact; the music ends on the downbeat or fades. |

## Footage slots

Keep the `FootageSlot` mechanism and `SHOTLIST.md`. Fallbacks must use the real captures, never drawings. Update `SHOTLIST.md` if the slot timings change.

## Process

1. Read `captures/manifest.json` and look at a sample of the captures (Read tool) before designing shots.
2. Rebuild `src/` for v2. Reuse what's solid from v1 (config, FootageSlot, the fonts loader), but delete the fake lens and phone drawings.
3. Build a beat-grid helper (`beat(n)`, `bar(n)`) and place every cut, word and SFX on it.
4. Render stills at about 20 key frames and Read them. Critique against the references: is something always moving, is it bold, does it look like a premium launch film, is it legible? Fix. Do two critique rounds minimum.
5. Render a 6-fps low-res preview of the whole thing to sanity-check pacing (frame strips), then the final 1080p master (the grain can be lighter than v1 to keep the file size sane) and a web copy under 50 MB.
6. Check the audio: peak ≤ −1 dBFS, music audible, SFX varied. Log what plays where in `REPORT.md`.
