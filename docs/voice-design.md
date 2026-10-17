# MatSide voice and interaction design

Designed by Galen (instructor) on 2026-10-17, following Even's guidance: show as little as possible, triggered by something real; keep interaction simple.

## Principles
1. **The lens is dark until triggered.** These triggers each show something for about 5 s, then the lens goes dark again:
   - **tap**: starts listening, and the listening screen also shows the current drill, time left, and the next kid to give feedback to;
   - **head tilt down** (IMU): a silent peek at the same info, with no mic;
   - **drill timer ends**: `Time · next: Kata 2`;
   - **after you speak**: the agent card showing what the agents did.
2. **One gesture to talk: tap, then just explain in plain language.** There are no code words or lead words. "Priya needs to keep her hands up, her guard keeps dropping" and "Leo's dad still owes for gear, kind of urgent" work as-is. The router agent works out what you meant and who you meant.
3. **The confirmation is the safety net, not a grammar.** Every utterance ends in a one-glance card that says what happened (`✓ Priya · guard (3rd time) → parent note drafting`). Double-tap undoes it. Names the AI isn't sure about show a two-choice pick on the lens.
4. **No always-listening wake word in the plugin.** "Hey Even" is a system-level wake word handled by Even's own app and firmware. The public Even Hub SDK gives plugins no wake-word or keyword-spotting API. A plugin only hears audio after it opens the mic, and the web view pauses in the background on Android. A custom "Hey Dojo" would mean streaming and transcribing the whole class. **To ask the Even team:** can a plugin be launched or addressed through "Hey Even" (e.g. "Hey Even, note for MatSide…")?

## Gesture map
| Gesture | Lens dark / at rest | Recording | Agent card showing |
|---|---|---|---|
| Tap | Start talking (mic on) | Stop and send | Dismiss |
| Double-tap | End class (then tap to confirm) | Cancel | Undo |
| Swipe up/down | Open the drill deck | — | Dismiss |
| Long-press | Hold to talk, release to send | — | — |
| Head tilt down | Peek (5 s) | — | — |

On the home screen, double-tap opens Even's exit dialog (a platform rule).
