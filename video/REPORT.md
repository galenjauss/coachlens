# CoachLens Devpost video: build report

**Output:** `video/out/coachlens-demo.mp4`, 1920×1080, 30 fps, 2:30 (4500 frames), H.264 CRF 18, with a generated sound-design track.
**Stills:** `video/out/stills/01-hook.png` … `13-close.png`, one per scene at its key frame (`node scripts/stills.mjs`).
**Render time:** 3 min 54 s for the full 4500 frames (`--concurrency=6`, Apple silicon). The CRF 18 master is 621 MB (the per-frame film grain costs bitrate), so a 21 MB upload copy was also made with Remotion's bundled ffmpeg: `out/coachlens-demo-web.mp4` (x264 CRF 24, faststart). Each still takes under 1 s.
**Audio:** overall RMS about −27.5 dBFS, peak −0.6 dBFS (the thump on the 0), no clipping.

## What was built

A standalone Remotion 4.0.536 package in `video/` (own `package.json`, exact pins, not in the root workspaces). The official Remotion Agent Skills were installed with `npx skills add remotion-dev/skills` (local copies live in `video/.claude/`, which is git-ignored; `skills-lock.json` is committed so `npx skills experimental_install` restores them).

**The lens is the real app.** `src/lens/appLens.ts` imports `app/src/lens/render.ts`, `fixtures.ts`, `reducer.ts` (for `remindedStatus`) and `api/src/logic/cardLines.ts` (for `buildCardLines`) straight from the repo. Every lens frame is a `PageSpec` from the app's own `render(state, now)`. States come from `fixtureState()`, or are built the same way (planning with live words, plan diff, recording with the mic ticking, the thinking stage line, Dee's urgent card, Maria's PR card, the home screen after the wrap-up tap). `webpack-override.mjs` (shared by the CLI config and the scripts) aliases `@matside/shared` to `shared/src`, stubs `@evenrealities/even_hub_sdk` (one enum used by `app/src/config.ts`), and defines Vite's `import.meta.env`. `<LensDisplay>` draws each text container at its exact 576×288 coordinates (2 px borders, padding 6, Rajdhani 400 at the G2 line pitch, phosphor glow). It was calibrated against `docs/store/screenshots` (the `Calibrate` composition shows ours next to the simulator capture).

**Design system:** near-black, one green that only means "the lens", Inter Tight headlines, Rajdhani lens text, JetBrains Mono tags, film grain and vignette, a glass lens frame with an eyewear band, scanlines and a reflection. Springs (damping 200, mass 0.8) for entrances, 28 chars/s typewriter, `evolvePath` connectors and icon draw-on. All text ≥ 28 px except the mono footnote (22 px). 96 px title-safe margins.

**Scenes** (`src/scenes/S01…S13`, timing in `src/config.ts`): hook · the problem (20 kids, the class clock, two remembered) · wordmark · slot A planning (lobby → 2× tap → live words → diff with strike) · tap/talk/agents (recording, quote typed, card, 4 outcome chips fan out, then Dee's urgent note with the parent-email chip) · slot B notes (PR card, brief) · ask the class (ANSWER card, names highlight) · agents that notice (dark lens, ★ banner, three insight cards) · end of class (wrap-up highlights, tap, chip flies into next class's plan, lens shows the app's real `ok · Eli, Mia, Leo first next class`) · slot C phone (Review → From your agents → Auto·Review·Off) · originality (220+ → 0 → "Until now." with footnote) · 16-tile "Any room. Any coach." mosaic with push-in and pull-back · close card with `STORE_LINE`.

**Honesty constants** (`src/config.ts`): `STORE_LINE` ("Now on the Even Hub store") is used once, on the close card. `APPS_CHECKED = 220`, `APPS_FOR_COACHES = 0`, and the footnote "Community G2 app directory + Even built-ins, Oct 2026." come from there too.

**Audio:** `scripts/sfx.mjs` synthesizes tap, tick, shimmer (lens on), whoosh, thump and a seamless 12 s pad loop into `public/sfx/` (816 KB, committed). Cues are exported next to the motion they belong to (`*_CUES` in each scene) and placed by `src/audio/SoundLayer.tsx`.

## Stills (critique rounds)

| # | Still | Frame |
|---|---|---|
| 1 | `01-hook.png` | 190 |
| 2 | `02-problem.png` | 410 |
| 3 | `03-meet.png` | 600 |
| 4 | `04-plan.png` | 1060 |
| 5 | `05-agents.png` | 1400 |
| 6 | `06-notes.png` | 1980 |
| 7 | `07-ask.png` | 2370 |
| 8 | `08-notice.png` | 2860 |
| 9 | `09-wrapup.png` | 3090 |
| 10 | `10-phone.png` | 3620 |
| 11 | `11-originality.png` | 3860 |
| 12 | `12-mosaic.png` | 4340 |
| 13 | `13-close.png` | 4480 |

Round 1 fixes: overlapping outcome chips (re-spaced, uniform width); insight-card text running under its action pill (detail on its own line); mosaic lens lines wrapping mid-phrase (4×4 grid, one-line lines, plus a "Your class" tile; the real use case tiles get a green-tinted edge for hierarchy); greyish blacks from screen-blended grain (now sparse speckle grain); a cheap-looking grey glass glare (subtler reflection, added an eyewear band); wrap-up tap came too early (summary now holds ~5 s); remembered dots too dim. Round 2 fixes: tap label colliding with the new voice meter; plan row opening before the flying chip lands; a stray connector dot before the fan-out.

## Left rough / judgment calls

- **Fallback B caption.** The brief's "Real G2. Real class." would be untrue over the animated fallback, so slot B shows "A PR in the gym. A check-in on the mat." until `footage/B.mp4` exists, then switches to the brief's line automatically.
- **Dee's "!" card.** The app's real card for an urgent note shows `√ Dee` on the lens (the `! urgent · parent note drafting` line is not one the card renders). The video keeps the lens faithful and carries the "!" on the amber outcome chip: `! Parent email · draft for your review`.
- **Phone screens are recreated**, not captured: the app's theme tokens and real copy (Review email card, From your agents with Do it, `AutonomyControl` copy), with type enlarged for 1080p. The email subject/body text is illustrative. Slot C footage replaces it.
- **Insight card actions** (Plan test, Draft note, Put first) and the next-class plan rows are illustrative, styled as side panels, not lens UI.
- **Fonts load from Google Fonts at render time** (via `@remotion/google-fonts`), so rendering needs network for fonts.
- Glyphs Rajdhani lacks (√ ★ ━ ─) fall back to a system font, so they look slightly heavier than on the G2.

## How to swap in footage, voiceover and music

- **Footage:** drop `public/footage/A.mp4`, `B.mp4`, `C.mp4` (or `.mov`). Lengths and content are in `SHOTLIST.md` (A 16 s, B 10 s, C 14 s). Each is detected with `getStaticFiles()`, cover-fit into a rounded frame with the tag and captions over it; nothing else to change.
- **Voiceover:** drop `public/vo/<scene>.mp3`, where `<scene>` is one of `hook problem meet plan agents notes ask notice wrapup phone originality mosaic close`. Each plays from its scene's start.
- **Music:** drop `public/music.mp3` (`MUSIC_SRC` in `src/config.ts`). It is mixed at −18 dB and the pad ducks to 35 %.
- Then: `cd video && npm run render` (web copy: `npx remotion ffmpeg -i out/coachlens-demo.mp4 -c:v libx264 -crf 24 -preset medium -c:a copy -movflags +faststart out/coachlens-demo-web.mp4`) (or `npx remotion studio` to preview). Stills: `node scripts/stills.mjs [scene numbers]`, or `FRAMES=100,200 node scripts/stills.mjs`.
- Regenerate SFX: `npm run sfx`. Typecheck: `npm run typecheck`.
