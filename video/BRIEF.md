# CoachLens Devpost video: creative brief

**Output:** `video/out/coachlens-demo.mp4`, 1920×1080, 30 fps, 2:30 (4500 frames), H.264. Also render `video/out/stills/` for review: one PNG per scene at its most important frame.
**Tool:** Remotion (latest stable 4.x) with the official Remotion Agent Skills installed. A standalone package in `video/` with its own package.json; NOT part of the root npm workspaces.
**Audience:** Even Realities judges and the Devpost gallery. Their exact criteria: Made for G2 · Quiet by Design · Originality · Experience & Polish · Execution. Their questions: Who is this for? What moment is it designed for? Why does it belong on G2? Can the judge try it right now?
**The bar:** the best product video at the hackathon. Apple-keynote restraint, plus the energy of a modern launch video. No template look, no stock footage, nothing generic.

## Design system

- **Palette:**
  - near-black `#07090A` background; deep panel `#0E1210`;
  - lens green `#3DFF7A`, used on the lens and as the single accent;
  - dim green `#1F7A45` (alpha 0.35) for glows and secondary lines;
  - off-white `#ECEFEA` for headline type; muted `#8A938C`.
  - Green means "the lens". Never use it for decoration away from the lens and accent moments.
- **Type:**
  - Headlines: **Inter Tight** (700/800, tight tracking −0.03em) via `@remotion/google-fonts`.
  - Lens text: a thin, rounded, technical sans close to the G2 font. Try **"Rajdhani"** or **"Saira"** 400, and pick whichever matches `docs/store/screenshots/*.png` best.
  - Mono labels: **JetBrains Mono** 500, uppercase, letter-spaced 0.2em, small. Use it for section tags like `01 · PLAN` and `QUIET BY DESIGN`.
- **The lens frame (hero element):**
  - A stylized G2 lens: a rounded-rect window with an inner 576×288 display area scaled ×2–×3, a subtle glass reflection gradient, and a faint scanline/phosphor texture.
  - The display draws REAL lens UI (see Fidelity). The lit text glows (two stacked text-shadows in lens green at low alpha).
  - Lens-off state: the display is black; a 1 px rim stays visible.
- **Texture:** fine film grain over everything (SVG noise or a canvas noise frame, ~3–4% opacity) and a soft vignette. No heavy blur.
- **Motion principles:**
  - Springs (damping ~200, mass 0.8) for entrances; nothing linear except tickers.
  - Stagger children 3–4 frames.
  - Typewriter for spoken lines at about 28 chars/s with a caret.
  - Agent fan-out uses drawn SVG connector paths (`evolvePath`) from the card to outcome chips.
  - Cuts land on beats. Hold important frames 1.5 s or more so judges can read them.
  - Respect the lens: it lights up only when triggered (Quiet by Design is a visual rule, not just a slogan).

## Fidelity: real UI, not mockups

- Import the app's real lens code: `../app/src/lens/render.ts` (`render(state, now) → PageSpec` with text containers x/y/w/h/content/border) and `../app/src/lens/fixtures.ts` (`fixtureState(name, now)` for home, lobby, planning, planResult, peek, banner, card, answer, brief, wrapup).
- Build a `<LensDisplay spec={PageSpec}>` component. It draws each text container at its exact 576×288 coordinates (scaled), with 2 px green borders where `border` is set and padding 6, text in the lens font, and line breaks preserved.
- For moments without a fixture (roll-call card, urgent Dee card, PR card, plan diff variants), construct a LensState the same way `fixtures.ts` does and call `render()`. If importing app code into the Remotion bundle is painful (aliases for `@matside/shared`), add webpack aliases in `remotion.config.ts`. Don't fork the render code.
- Cross-check against `docs/store/screenshots/*.png`, which are true simulator captures.
- Phone UI: draw a clean iPhone frame (no Apple logos) holding recreated phone screens in the app's style (`app/src/phone/theme.css` tokens). Or, better, use real screenshots of the phone UI if you can capture them by running the app (`app` vite dev with `?fixture` or a mock), via a headless browser at 390×844.

## Real-footage slots (must exist)

The judges require the G2 experience in the video. Each slot is a component `<FootageSlot id="A" src="footage/A.mp4" fallback={<…animated lens sequence…/>} label="…" />`:
- If `public/footage/<id>.mp4` (or .mov) exists, play it, cover-fit with rounded corners, plus our callout overlays.
- Otherwise render the fallback: an animated sequence built from the real lens UI, so the video is complete today.
- A config file `video/src/footage.ts` lists each slot: id, duration, start frame and a one-line shot description (the shot list).
- Write `video/SHOTLIST.md` for Galen, covering each slot: what to film, how long, through-the-lens or phone screen recording, which demo-data beat (from `docs/demo-script.md`).

## Timeline (2:30 = 150 s)

| # | Time | Scene | Content |
|---|---|---|---|
| 1 | 0:00–0:07 | **Hook** | Kinetic type on black: "20 kids." → "45 minutes." → "Hands full?" Beat. "**No problem.**" The lens rim fades in behind the last line. |
| 2 | 0:07–0:15 | **The problem, felt** | A grid of 20 small dots (kids). As the "class" ticks (timer 45:00→0:00 fast), only 2–3 light up as "got feedback". Line: "By dinner, I remember two." A mono tag `THE MOMENT: MID-CLASS, HANDS ON PADS`. |
| 3 | 0:15–0:22 | **Meet CoachLens** | The wordmark builds (the lens-ring icon draws on with evolvePath, then "CoachLens" types). Sub: "Hands-free AI agents for coaches, on Even G2." |
| 4 | 0:22–0:38 | **Footage slot A: lobby + planning** | Fallback: the lens shows the lobby (fixture), a double-tap ripple, planning (`● Planning · 0:14`) with live words "cut kata 2… shorter warm-up… add partner sparring", then the planResult diff, with lines animating in green and red/strike. Tag `01 · PLAN OUT LOUD`. Caption: "Talk the plan through with your assistant. It reshapes itself." |
| 5 | 0:38–0:58 | **Tap. Talk. Agents.** | Lens peek, then a tap ripple; the spoken line types: "Priya keeps dropping her guard on the jab." The real card renders. Then the agent fan-out: SVG paths draw from the card to 4 outcome chips: `Progress · 3rd time → recurring`, `Report card · added`, `Next class · guard drill`, `Coverage · 7/12`. Then the second line: "Dee rolled her ankle and sat out the last drill" with an urgent `!` card and the chip `Parent email · draft for your review`. Tag `02 · ONE SENTENCE IN, OUTCOMES OUT`. |
| 6 | 0:58–1:08 | **Footage slot B: real notes** | Fallback: a fast montage of the real cards: PR card `√ Maria · deadlift 225 lb (PR +10)`, brief card "How's Priya doing?". Caption: "Real G2. Real class." |
| 7 | 1:08–1:22 | **Ask the class** | Spoken line types "Who is forgetting to keep their guard up?" The ANSWER card renders; names highlight one by one. Small mono note: `instant · grounded in your notes`. Tag `03 · ASK ANYTHING`. |
| 8 | 1:22–1:38 | **Agents that notice** | Lens dark. Mono `QUIET BY DESIGN`. Then the ★ banner slides in: "★ Jake's back after 3 missed / Welcome him back". Then three more insight cards stack in the side space (not on the lens): "Gus ready to test · 120 days at rank", "Noah · grade 84% → 72%", "Eli · no feedback in 3 classes", each with its one-tap action. Line: "Agents that notice what you didn't ask about, and speak up only when it matters." |
| 9 | 1:38–1:48 | **End of class** | The wrap-up fixture on the lens. Highlight "9/12 got feedback" and "Missed: Eli, Mia, Leo", then a tap: "put them first next class" with a chip that flies into a mini next-class plan. |
| 10 | 1:48–2:02 | **Footage slot C: phone, agents at work** | Fallback: the phone frame with the Review draft (Dee email), "From your agents" with **Do it**, and the Agents autonomy control **Auto · Review · Off** sliding to Review. Caption: "You choose how much they do on their own." |
| 11 | 2:02–2:14 | **Originality, hammered** | A big counter rolls up "220+" with the label "G2 apps we checked." Hard cut: "Built for coaches & teachers:" then a big **0** that lands with weight. Then "Until now." with the lens rim pulsing once. Small footnote (mono, muted): "Community G2 app directory + Even built-ins, Oct 2026." |
| 12 | 2:14–2:26 | **For every kind of coach** | An animated mosaic (5×3 or so, staggered), each tile with a title plus a tiny real-style lens line in green showing what CoachLens would say: Football coach `#12 late off the snap · 3rd time` · Math tutor `Sam: distribute the negative` · Martial arts `Priya · guard (3rd time)` · Classroom teacher `Row 3 hasn't spoken today` · Personal trainer `Maria · deadlift PR +10` · Swim coach `Lane 4 · 50m split -0.8s` · Piano teacher `Ava · left-hand tempo` · Dance instructor `Leo · late on the 5-6-7-8` · Climbing coach `Nina · flag the left foot` · Debate coach `Theo · rebuttal ran 40s long` · Soccer coach `Back line · step up together` · Yoga instructor `Kim · knee past toes` · Tennis coach `Max · split-step late` · Chess coach `Ari · hung a piece twice` · Driving instructor `Check blind spot · 2nd time`. The camera slowly pushes in, then pulls back to reveal all. Line: "Any room. Any coach." |
| 13 | 2:26–2:30 | **Close** | "CoachLens" wordmark + "**Now on the Even Hub store**" (from `STORE_LINE` in `video/src/config.ts`; must be one constant) + small "Teach the class. CoachLens runs the follow-up." |

## Audio

- No copyrighted music. Generate a subtle sound-design layer with a Node script (`video/scripts/sfx.mjs`) that writes WAVs:
  - a soft tap tick;
  - a lens-on shimmer (filtered noise + sine sweep);
  - a whoosh for transitions;
  - a low "thump" for the 0;
  - a gentle pulsing pad bed (two detuned sines with slow filter movement), −24 LUFS-ish.
- Place them with `<Audio>`/`<Sequence>`.
- Add `MUSIC_SRC` in config. If `public/music.mp3` exists, mix it at −18 dB and duck the pad.
- Include optional voiceover slots: if `public/vo/<scene>.mp3` exists, play it at the scene start.
- Captions are always on-screen (burned in), so the video works muted.

## Quality bar and process

- Work in passes:
  1. Scaffold and the design system.
  2. All scenes, roughly.
  3. Render stills of every scene's key frame, look at them critically (spacing, hierarchy, contrast, legibility at 1080p and at 50% size), and fix.
  4. Motion polish (springs, stagger, timing holds).
  5. Final render.
- Every on-screen string must be legible for at least 1.2 s.
- No text smaller than 28 px at 1080p, except mono footnotes (≥20 px).
- Nothing touches the edges: title-safe margins of 96 px.
- Typecheck clean (`npx tsc --noEmit`). Rendering must not need network access at render time (fonts are loaded via `@remotion/google-fonts`; that's fine).
