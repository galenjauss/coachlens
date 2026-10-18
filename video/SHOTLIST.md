# CoachLens video: shot list for real footage

Three slots in the video take real footage. Until a clip is there, each slot plays an animated fallback built from the app's real lens code, so the video is always complete. To use a clip, export it and drop it in as `video/public/footage/<slot>.mp4` (or `.mov`). It is cover-fit into a rounded frame with the section tag and captions on top. Then re-render (`npm run render`). Slot timing lives in `src/footage.ts` and `src/config.ts`.

Use the seeded demo data and the beats in `docs/demo-script.md`. **Reseed the same day** (see that file's checklist).

| Slot | In the video | Length | Source | What to film |
|---|---|---|---|---|
| **A** | 0:22–0:38 · `01 · Plan out loud` | **16 s** | Through the lens (G2 lens capture, or the Even Hub simulator at 576×288 if the lens is too dim) | Lobby for *Kids · Tue* (class, start time, first 3 drills, `tap start · 2× plan · swipe back`). Double-tap. `● Planning · 0:1x` while the coach says "Let's cut kata 2, a shorter warm-up, and add partner sparring." Tap. `Thinking · updating the plan…`, then the diff `+ Partner sparring 6m` / `- Kata 2` / `~ Warm-up 10→5m`. Hold the diff 3 s or more. (Demo script 0:20–0:36.) |
| **B** | 0:58–1:08 · "Real G2. Real class." | **10 s** | Through the lens | Two quick beats, ~5 s each. 1) *PT · Mon 6:00*: tap, "Maria hit 225 on deadlift.", the card `√ Maria · deadlift 225 lb (PR +10)`. 2) Back in *Kids · Tue*: tap, "How's Priya doing?", the brief card. (Demo script 0:52–1:18, last two beats.) |
| **C** | 1:48–2:02 · `05 · After class, on your phone` | **14 s** | iPhone screen recording (portrait; it is cover-fit, so frame the content centrally) | 1) **Review**: Dee's parent-email draft, tap **Send** (~5 s). 2) **Today → From your agents**: *Gus ready to test*, tap **Do it**, outcome inline (~5 s). 3) **Agents → Parent email**: the **Auto · Review · Off** control, set to **Review** (~4 s). (Demo script 1:50–2:15.) |

## Tips

- Shoot at least 2 s of handle before and after each beat; trim to the exact length before dropping in.
- Through-the-lens: lock exposure on the lens, dark background, no reflections of the phone screen.
- Phone: Do Not Disturb on, battery and time not visible if you can crop them.
- The captions in the video stay on-screen, so the footage needs no burned-in text.
- When slot B has real footage, its caption switches automatically from the fallback line to **"Real G2. Real class."**
