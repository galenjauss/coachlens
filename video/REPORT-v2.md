# CoachLens launch film v2: report

- **Outputs** (not committed):
  - `out/coachlens-launch-v2.mp4`: 1920×1080, 30 fps, 150 s, 39 MB.
  - `out/coachlens-launch-v2-web.mp4`: 28 MB.
- **Source:** `src/timeline.ts` holds the single beat grid: scenes, cuts, field flips, HUD labels, footage slots, typewriter lines and all 117 SFX cues. `scripts/check-timeline.mjs` checks that no SFX file plays twice in a row.
- **Product imagery:**
  - Lens shots are real simulator captures (`public/captures/lens`).
  - Phone shots are real app screenshots with the seeded data (`public/captures/phone`).
  - The only exception is the use-case flash-by lens strips, which are hypothetical.
- **Audio:**
  - Music and SFX are licensed from Mixkit (`public/audio/SOURCES.md`).
  - Peak is −2.0 dBFS.
  - The main track sits at 0.46 and the finale at 0.74. Music ducks about 3 dB under impacts. SFX have a global 0.8 trim.

## Scene list
| Time | Music | Scene | What plays |
|---|---|---|---|
| 0:00–0:12 | full | Hook | "20 kids", "45 minutes", "One coach", "Hands full?" (glitch), four one-beat task flashes, then "No problem." on the bar-5 downbeat |
| 0:12–0:24 | full | The class / meet | 2 of 20 dots lit; *by dinner, I remember two.*; lens-ring iris into the wordmark; agent marquees; "Seven agents. / One sentence." |
| 0:24–0:40 | breakdown | Lens / quiet by design | Wireframe G2, *dark until it matters.*, dark glass and a tap, then real peek, lobby, planning and plan-result captures on one continuous dolly; riser into the drop |
| 0:40–1:00 | drop | One sentence in | Real recording capture, typed line, real note card frames, connectors to PROGRESS, REPORT CARD, NEXT PLAN, COVERAGE; urgent Dee card; phone Review with Send |
| 1:00–1:20 | drop | Real notes | Type cards alternating with the real PR, brief, answer and roll-call captures |
| 1:20–1:36 | drop | Agents that notice | Real banner slam; phone Today → Do it (Working… → outcome); insight flashes; real wrap-up with the highlight sweep |
| 1:36–1:48 | breakdown, drop at 1:44 | Originality | 220+ counter, "Built for coaches & teachers:", giant "0" with shake and impact, *until now.* |
| 1:48–2:04 | drop | Control | Real autonomy Auto→Review tap, Agents tiles, Priya profile, four-phone montage, onboarding |
| 2:04–2:26 | finale track | Every coach | 16 full-screen flash-bys snapped to kick onsets, accelerating from 70 to 11 frames each; the last one, "Your class.", uses the real home → lobby → roll-call captures |
| 2:26–2:30 | finale, fading | Close | Iris to the wordmark, serif line, `STORE_LINE` pill, music fade |

## Known compromises
1. No capture shows Gus's "Do it" before the tap. The cursor taps on `today/03`, then the view scrolls to the real "Working…" frame.
2. Slot A (lobby and planning) sits in the 0:24–0:40 breakdown.
3. Finale cuts follow measured kick onsets rather than a fixed 175 BPM grid.
4. Faint motion-blur sample steps remain on the fastest whips.
5. Fonts load from Google Fonts at render time.

## Next improvements
- More blur samples on the whips.
- Before and after phone captures for the taps.
- Real slot B footage, for a human shot.
- An ear-level SFX pass.
