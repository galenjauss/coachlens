# MatSide voice and interaction design

Designed by Galen (instructor) on 2026-10-17, following Even's guidance: show as little as possible, triggered by something real; keep interaction simple.

## Principles
1. **The lens is dark until triggered.** These triggers each show something for about 5 s, then the lens goes dark again:
   - **tap**: starts listening, and the listening screen also shows the current drill, time left, and the next kid to give feedback to;
   - **head tilt down** (IMU): a silent peek at the same info, with no mic;
   - **drill timer ends**: `Time · next: Kata 2`;
   - **after you speak**: the agent card showing what the agents did.
2. **One gesture to talk: tap, then just explain in plain language.** There are no code words or lead words. "Priya needs to keep her hands up, her guard keeps dropping" and "Leo's dad still owes for gear, kind of urgent" work as-is. The router agent works out what you meant and who you meant.
3. **The confirmation is the safety net, not a grammar.** Every utterance ends in a one-glance card that says what happened (`√ Priya · guard (3rd time) → parent note drafting`). Double-tap undoes it. Names the AI isn't sure about show a two-choice pick on the lens.
4. **No always-listening wake word in the plugin.** "Hey Even" is a system-level wake word handled by Even's own app and firmware. The public Even Hub SDK gives plugins no wake-word or keyword-spotting API. A plugin only hears audio after it opens the mic, and the web view pauses in the background on Android. A custom "Hey Dojo" would mean streaming and transcribing the whole class. **Confirmed with the Even team (2026-10-17):** "Hey Even" cannot interact with third-party apps, so tap is the trigger.

## Gesture map

### Home (class selection)
| Gesture | Action |
|---|---|
| Swipe up/down | Cycle through your classes |
| Tap | Open that class's lobby |
| Double-tap | Even's exit dialog (platform rule for the root screen) |
| Nod | Lens off/on |

### Lobby (one class, before it starts)
Shows the class name, start time and plan length, the first 3 plan items, and the top insight when there is one. Footer: `tap start · 2× plan · swipe back` (the long form, `tap start · 2×tap plan by voice · swipe back`, is over the 39-char line).

| Gesture | Action |
|---|---|
| Tap | Start class (roll call, then the first drill) |
| Double-tap | Start planning listen |
| Swipe up/down | Back to home |
| Nod | Lens off/on |

The phone's Start button starts the class from home or the lobby directly.

### Planning listen (talking the plan through, e.g. with an assistant instructor)
Shows `● Planning · m:ss` and the last ~60 characters heard. Every 20 s the audio so far is cut and transcribed in the background (each request stays small); a failed chunk is retried once. Hard cap 3 min, then it stops and applies on its own.

| Gesture | Action |
|---|---|
| Tap | Stop and apply: the remainder is transcribed, the chunks are joined in order, and the plan is edited (`Thinking · updating the plan…` while waiting) |
| Double-tap | Cancel (nothing is applied; the mic closes) |

### Plan result
Shows up to 4 summary lines of what changed.

| Gesture | Action |
|---|---|
| Tap | OK, back to the lobby (plan refreshed) |
| Double-tap | Undo the change (`Plan change undone`, or the server's reason, e.g. `plan changed since`), back to the lobby |
| Swipe up/down | Back to the lobby |

### In class (unchanged)
| Gesture | Lens dark / at rest | Recording | Agent card showing |
|---|---|---|---|
| Tap | Start talking (mic on) | Stop and send | Dismiss |
| Double-tap | End class (then tap to confirm) | Cancel | Undo |
| Swipe up/down | Open the drill deck | — | Page the transcript |
| Long-press | Hold to talk, release to send | — | — |
| Nod | Lens off/on | — | — |
