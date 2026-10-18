# Installed-Beta acceptance procedure (physical G2)

**Gate status: OPEN.** No installed-Beta run on physical G2 has been completed and recorded. The owner did test earlier QR/sideload builds on a real G2 during development. That was development testing, not this gate: a QR build is served from a dev URL and does not go through Even's installed-package lifecycle (lock screen, system exit, permissions). The gate closes only when every step below has been run on the **installed Beta** with evidence attached. Until then, no document should say that the installed Beta has been verified on hardware.

Audit reference: finding F05 (`docs/audit-2026-10-18/report.md`). Platform reference: [Even Beta testing guide](https://hub.evenrealities.com/docs/test/beta-testing).

## How to record a run

- Fill in one copy of this file per run (or paste the tables into a dated note). Put evidence in `docs/beta-evidence/<YYYY-MM-DD>/` (create it when you have files to put there) and name each file after its step, for example `03-core-loop.mp4`.
- **Evidence** means a photo or video. For lens content, film through the lens or with a second phone pointed at the lens. For phone state, use the iOS screen recorder. A step with no evidence counts as not run.
- Mark each step `[x] pass` or `[x] fail`. A failed step keeps the gate open. Write what you saw in the notes, even on a pass.
- Run the steps in order on a single session where the procedure says so. Do not restart the glasses unless a step tells you to.

## Run header

| Field | Value |
|---|---|
| Date and time (PT) | |
| Tester | |
| Glasses (G2 serial / firmware) | |
| R1 ring used? (serial / firmware) | |
| Phone model / iOS version | |
| Even Realities app version | |
| Network (Wi-Fi name or cellular) | |
| API target | `https://coachlens-api.vercel.app` (production) or other: |
| Production commit deployed at the time (from Vercel) | |
| Data set | Synthetic demo seed only (never real students) |

## Step 0 · Install from Beta and check the build identity

1. In the Even Hub portal, open **CoachLens** (`com.coachlens.app`) → the build assigned to the Beta group. Record its version and upload time.
2. On the iPhone: Even Realities app → **Me → Beta tester → CoachLens → Install** (or Update). Do not use a QR code or a dev URL for any step in this file.
3. Confirm that the version shown in Beta tester matches the portal build.
4. Confirm that the uploaded package is the one you think it is. Compute `shasum -a 256 app/coachlens.ehpk` on the file you uploaded, and record the hash and the git commit it was built from (`git rev-parse HEAD` at pack time).
5. Record whether this build includes the remediation (multi-instructor isolation, Unpair, Quiet mode, complete Undo, idempotent retries). The v0.1.0 build submitted on Oct 17 does **not** include it.

| Check | Value | Result | Evidence (photo/video file) |
|---|---|---|---|
| Portal build version and upload time | | [ ] pass [ ] fail | |
| Beta tester shows the same version | | [ ] pass [ ] fail | |
| `.ehpk` SHA-256 and source commit | | [ ] pass [ ] fail | |
| Includes remediation? (yes/no) | | n/a | |

## Step 1 · Pairing

1. Launch CoachLens from the glasses home before pairing. Expected: the lens shows a pairing message ("Pair on your phone…"), never a black screen.
2. Open CoachLens on the phone and enter the pairing code (given in person; never write it in this file).
3. Expected: the phone shows the class list and the lens moves to the home/class list.
4. Enter a wrong code once first. Expected: a clear error and no access.

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Unpaired first launch shows a message on the lens | [ ] pass [ ] fail | | |
| Wrong code is rejected with a clear message | [ ] pass [ ] fail | | |
| Correct code pairs; the lens reaches the class list | [ ] pass [ ] fail | | |

## Step 2 · Core interaction: tap, speak, card, undo

In the martial-arts demo class (*Kids · Tue*):

1. Tap the class, then tap to start.
2. Tap and say: "Priya needs to keep her hands up, guard keeps dropping." Tap to stop.
3. Expected: the transcript appears on the lens, then the agent card with the result for Priya.
4. Double-tap to undo while the card is up. Expected: the card reports what was undone. On the phone, check that the note is gone from Priya's profile.
5. Record the wall-clock time from the stop tap to the card (stopwatch on video). This is the first real measurement; keep it.

| Check | Result | Evidence | Notes (include the measured time) |
|---|---|---|---|
| Transcript shown on the lens | [ ] pass [ ] fail | | |
| Card names the right student and action | [ ] pass [ ] fail | | |
| Undo removes the note (checked on phone) | [ ] pass [ ] fail | | |
| Stop-tap → card time (seconds) | n/a | | |

## Step 3 · Five-minute phone lock, then capture

1. With a class running, lock the iPhone and put it away (pocket or bag).
2. Wait **5 full minutes** (film a clock or keep the video running).
3. Without touching the phone, tap and say: "Leo did a great job on his kicks." Tap to stop.
4. Expected: the card appears on the lens with the phone still locked. The drill timer kept running during the lock.

| Check | Result | Evidence | Notes |
|---|---|---|---|
| App alive and responsive after 5 min locked | [ ] pass [ ] fail | | |
| Capture completes with the phone locked | [ ] pass [ ] fail | | |
| Timer kept counting during the lock | [ ] pass [ ] fail | | |

## Step 4 · Permission denial (each declared permission)

The manifest declares five permissions. For each, deny it (in the Even app's permission prompt, or revoke it in Even app / iOS Settings), relaunch CoachLens, and exercise the feature. Expected in every case: a clear message, no crash, no black screen, and the rest of the app still works. Restore the permission after each check.

| Permission | How to exercise it | Expected | Result | Evidence |
|---|---|---|---|---|
| `g2-microphone` | Tap to record a note | Falls back to the phone mic, or shows "Mic unavailable · check permission" | [ ] pass [ ] fail | |
| `phone-microphone` | Deny it together with `g2-microphone`, then record | "Mic unavailable · check permission"; nothing queued that is empty | [ ] pass [ ] fail | |
| `network` | Deny or turn on airplane mode, then record | Note is queued locally (`↑ 1 queued`), no false success | [ ] pass [ ] fail | |
| `camera` | Setup → photo → camera | Clear message; typed/pasted setup still works | [ ] pass [ ] fail | |
| `album` | Setup → photo → choose from library | Clear message; typed/pasted setup still works | [ ] pass [ ] fail | |

## Step 5 · Root double-tap exit closes the WebView

1. Go to the glasses home/class list (the root page).
2. Double-tap. Expected: Even's system exit dialog appears.
3. Confirm exit. Expected: CoachLens closes and its WebView is gone (on the phone, CoachLens is no longer running in the Even app).

| Check | Result | Evidence |
|---|---|---|
| Root double-tap shows the system exit dialog | [ ] pass [ ] fail | |
| Confirming closes CoachLens and its WebView | [ ] pass [ ] fail | |

## Step 6 · Relaunch Conversate without restarting the glasses

1. Straight after Step 5, without restarting or re-seating the glasses, open Even's **Conversate** from the glasses.
2. Expected: Conversate starts and works normally; nothing from CoachLens remains on the display or holds the mic.
3. Then relaunch CoachLens. Expected: it opens to the class list without re-pairing.

| Check | Result | Evidence |
|---|---|---|
| Conversate launches and works after CoachLens exit | [ ] pass [ ] fail | |
| CoachLens relaunches without re-pairing | [ ] pass [ ] fail | |

## Step 7 · Roll call in ordinary note mode

Skip the dedicated roll-call screen (or finish it), so the class is in the ordinary in-class note mode.

1. Tap and say: "Everyone except Jake and Mia." Tap to stop.
2. Expected: attendance is updated (everyone present except Jake and Mia), and the card says so. An empty card or no change is a **fail**.
3. Check the attendance count on the phone.

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Card confirms the roll call | [ ] pass [ ] fail | | |
| Phone shows the matching attendance | [ ] pass [ ] fail | | |

## Step 8 · Offline, then reconnect

1. Turn on airplane mode on the phone (keep Bluetooth on so the glasses stay connected).
2. Record two notes: "Maya worked hard today." and "Ben needs to slow down on his forms."
3. Expected: the lens shows the queue (`↑ 2 queued`); no false "done".
4. Turn airplane mode off. Expected: the queue drains, each note shows up **exactly once** on the phone, and nothing is silently dropped.

| Check | Result | Evidence | Notes |
|---|---|---|---|
| Notes queue while offline | [ ] pass [ ] fail | | |
| Queue drains on reconnect | [ ] pass [ ] fail | | |
| Each note appears exactly once | [ ] pass [ ] fail | | |

## Sign-off

| Field | Value |
|---|---|
| All steps passed? | [ ] yes [ ] no |
| Failed steps and follow-up | |
| Evidence folder | `docs/beta-evidence/<date>/` |
| Signed (owner) | |

Only after a signed, all-pass run with evidence may the README, Devpost or store copy say "verified on the installed Beta on G2", and that claim must name the build version and date.
