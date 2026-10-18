# CoachLens video: shot list for real footage (v3)

Three slots in the v3 film take real footage. Until a clip is there, each slot plays a fallback built only from the real captures in `public/captures/` (simulator lens renders and real phone screenshots), so the film is always complete. To use a clip, export it and drop it in as `video/public/footage/<slot>.mp4` (or `.mov`). It plays in a tilted 3D frame with a slow push-in, on the music. Then re-render. Slot timing lives in `src/timeline.ts` (`SLOTS`), on the 120 BPM beat grid.

Use the seeded demo data and the beats in `docs/demo-script.md`. **Reseed the same day** (see that file's checklist).

| Slot | In the film | Length | Source | What to film |
|---|---|---|---|---|
| **A** | 0:33.0–0:40.0 · `LENS / QUIET BY DESIGN` (the breakdown) | **7 s** | Through the lens (G2 lens capture, or the Even Hub simulator at 576×288 if the lens is too dim). Landscape. | Lobby for *Kids · Tue* (class, start time, first drills, `★ Gus ready to test`). Double-tap. `● Planning · 0:1x` while the coach says "Let's cut kata 2 today, do a shorter warm-up, and add partner sparring." Tap. `Thinking`, then the diff `+ Partner sparring 6m` / `- Kata 2` / `~ Warm-up`. Hold the diff at least 1.5 s. Slow, calm: this is the quiet section. |
| **B** | 1:01.5–1:10.5 · `NOTES / REAL CLASS` (drop) | **9 s** | Through the lens. Landscape. | Two quick beats. 1) *PT · Mon 6:00*: tap, "Maria hit 225 on deadlift.", the card `√ Maria · deadlift 225 lb (PR +10)` (~4 s). 2) Back in *Kids · Tue*: tap, "How's Priya doing?", the five-line brief (~5 s). The film's "CHECK ON A KID" type card sits inside this slot and is replaced too. |
| **C** | 1:48.0–2:02.0 · `CONTROL / YOUR CALL` (drop) | **14 s** | iPhone screen recording, portrait (it is shown in a phone-shaped frame, so frame the content centrally). | 1) **Agents → Parent emails**: the **Auto · Review · Off** control, tap **Review** (~4 s). 2) **Agents** tiles (red / amber / green) (~3.5 s). 3) **Students → Priya**: the profile card, scroll to her notes (~3.5 s). 4) A one-second burst of four more screens: Insights, the deck "Start from…" sheet, the drill deck, a draft in Review. |

## Changes in v3

- Slot B moved by half a second to 1:01.5–1:10.5 (the type cards before it now hold longer); A and C are unchanged.

## Changes from v1

- Slot A moved from 0:22–0:38 (16 s) to 0:33–0:40 (7 s); slot B from 0:58–1:08 (10 s) to 1:01–1:10 (9 s); slot C from 1:48–2:02 to the same window but with new content order (autonomy control first).
- Captions are no longer burned into the footage frame; the film's own kinetic type and HUD carry the copy.

## Tips

- Shoot at least 2 s of handle before and after each beat; trim to the exact length before dropping in.
- Through-the-lens: lock exposure on the lens, dark background, no reflections of the phone screen.
- Phone: Do Not Disturb on, battery and time not visible if you can crop them.
