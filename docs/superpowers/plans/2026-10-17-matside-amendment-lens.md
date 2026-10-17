# Amendment A: dark-by-default lens, tap to talk, sparse updates (applies to Tasks 14, 15, 16, 17)

**Source:**
- the Even Realities team's guidance: show as little as possible, triggered by something real; send updates to the glasses sparingly or you'll overload Bluetooth;
- Galen's design decisions in [docs/voice-design.md](../../voice-design.md).

**This amendment overrides the plan text wherever they conflict.**

## Behavior changes

1. **The rest state is `dark`, not `drill`.**
   - During class the lens shows nothing: one empty text container that captures input.
   - The old `drill` screen is renamed `peek`. It appears only temporarily, then returns to `dark` after `PEEK_MS = 5000`.
2. **Tap in `dark` starts talking.**
   - Tap → `recording`. There is no lead word; the speech is natural language.
   - The recording screen shows the context the old drill card had: header `DRILL NAME · 3m left`, the line `● Listening… tap to send`, and `> Next feedback: Priya (guard)`.
3. **Peek triggers.** Each one shows `peek` for 5 s, then returns to `dark`:
   - `headTilt` (IMU, new event), showing the drill, time left, next kid and coverage;
   - `timerEnded` (new event, fired by the controller when the active drill's minutes elapse), with status `Time · next: <next drill name>`;
   - starting a drill (from attendanceDone or the deck).
4. **After a result the card shows for `CARD_MS = 4000`, then returns to `dark`, not drill.** `utteranceQueued`, `utteranceEmpty` and `micFailed` show a 1-line `peek` with the status, then `dark`.
5. **Gestures in `dark` and `peek`:**
   - tap = talk;
   - swipe up/down = deck;
   - double-tap = confirmEnd;
   - long-press = hold-to-talk.
   - Everything else on the other screens is unchanged.
6. **Sparse Bluetooth updates:**
   - **No per-second repaint.** Time is shown in whole minutes (`3m left`, `<1m left`, `+2m over`).
   - The controller repaints on state changes, plus at most once per `TICK_MS = 30000` while `peek` or `recording` is visible. Never repaint while `dark`.
   - `Glasses.show` already skips unchanged containers, so a tick that changes nothing sends nothing.
7. **IMU head tilt.**
   - Start `bridge.imuControl(true, ImuReportPace.P500)` when a session starts, and stop it on wrap-up.
   - `HeadTiltDetector` (pure, unit-tested) watches the axis values from `sysEvent.imuData`. It fires `headTilt` when the pitch value crosses `TILT_THRESHOLD` and stays past it for `TILT_HOLD_MS = 300`, with a `TILT_COOLDOWN_MS = 4000` refractory period.
   - The axis and sign aren't documented. The detector takes `{ axis: 'x' | 'y' | 'z'; threshold: number }`, defaulting to `{ axis: 'y', threshold: 0.5 }`. Task 20's hardware pass calibrates it: log a few samples with the head level vs tilted down, then set the values in `config.ts`.
   - If IMU data never arrives, nothing breaks: tap still works.

## Task 14 delta (core)
- `outbox.ts`: **429 is retryable.** Treat `ApiError` with status 429 like a 5xx: keep the item, increment attempts, stop the flush. Add the test "keeps items on 429".
- `outbox.ts`: **401 is not dropped.** Keep the item and stop the flush; the device needs re-pairing. Add the test "keeps items on 401".

## Task 15 delta (reducer)
- `Screen` adds `'dark' | 'peek'` and removes `'drill'`.
- `LensEvent` adds `{ type: 'headTilt' }`, `{ type: 'timerEnded' }` and `{ type: 'hide' }`.
- `Effect` adds `{ type: 'scheduleHide'; ms: number }`.
- Export `PEEK_MS = 5000` and `CARD_MS = 4000`.
- Mapping from the plan's behavior:
  - `startDrill(...)` → screen `peek` + effect `scheduleHide(PEEK_MS)`.
  - `sessionStarted` resumed → `startDrill` (so `peek`).
  - `record(..., returnTo)`: `returnTo` defaults to `'dark'`.
  - `back(s, status)` → if `status` → `peek` with that status + `scheduleHide(PEEK_MS)`, else `dark`.
  - The `cardTimeout`, `card` dismiss and disambiguation-done paths go to `dark`.
  - `hide` → if the screen is `peek`, go to `dark` and clear `status`; otherwise no-op.
  - `headTilt` in `dark` → `peek` + `scheduleHide`.
  - `timerEnded` when a session is active → `peek` with status `Time · next: <name of drill after active, or "wrap up">` + `scheduleHide`.
  - In `dark`/`peek`: tap → record note (returnTo `dark`); longPress → record (viaLongPress); swipe → `deck`; doubleTap → `confirmEnd`.
  - `confirmEnd` non-tap → `dark`. `deck` doubleTap → `dark`.
- **Tests:** update the plan's reducer tests so that every expectation of `'drill'` as the rest screen becomes `'dark'`, except right after starting a drill, where it is `'peek'`. Add tests for:
  - tap in dark → recording;
  - headTilt in dark → peek with a scheduleHide effect;
  - hide → dark;
  - timerEnded → peek with the status `Time · next: Holds`;
  - card timeout → dark.

## Task 16 delta (render + controller)
- **`render.ts`:**
  - `dark` → `{ key: 'dark', list: null, texts: [t(1, 'dark', 0, 0, 576, 288, '', { capture: true })] }`.
  - `peek` uses the plan's layout A (header row, boxed drill, next line), with no gesture-hint row (the first-run screen teaches the gestures). The box shows `NAME  3m left`, the bar, and the cue.
  - `recording` uses the panel layout: header = drill + time left, body `● Listening… tap to send`, footer = next feedback line.
  - `timerText` → `minutesLeft(minutes, startedAt, now)`, returning `'3m left' | '<1m left' | '+2m over'`.
  - Update the render tests to match: `peek` instead of `drill`, minute text, and the dark page with exactly one capture container and empty content.
- **New pure module `lens/tilt.ts`** with `class HeadTiltDetector { constructor(cfg, now = Date.now); push(sample: {x, y, z}): boolean }` (true = fire), plus unit tests for threshold, hold, cooldown and a single noisy spike.
- **`events.ts`:** IMU samples (`sysEvent.eventType === IMU_DATA_REPORT` with `imuData`) are not mapped to a `LensEvent` directly. The controller feeds them to the detector.
- **`controller.ts`:**
  - Remove the 1 s `setInterval`. Add a 30 s interval that repaints only when the screen is `peek` or `recording`.
  - `scheduleHide` → `setTimeout(dispatch hide)`, clearing any earlier timer.
  - On every state change, if `state.active` changes, (re)arm a `setTimeout` at `startedAt + minutes*60000` that dispatches `timerEnded`.
  - On `sessionStarted`, call `imuControl(true, ImuReportPace.P500)`. On `wrapupLoaded` and `exit`, call `imuControl(false)`.
  - Feed IMU samples to `HeadTiltDetector`, and dispatch `headTilt` when it fires.

## Task 17 delta (phone)
None, except the copy: the Today screen's "Start on glasses" hint reads "Tap your temple to talk anytime".
