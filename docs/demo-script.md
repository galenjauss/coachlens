# CoachLens demo script

Even Hub app name: **CoachLens**. Lens text in `code` is the exact string the app shows; names and numbers in *italics* come from the seed.

## Honesty rules

- **Store status:** v0.1.0 was **submitted to the Even Hub store on Oct 17 and is in review**. Say "submitted", never "on the store" or "available".
- **What judges see:** the current build, loaded in developer mode from `coachlens-phone.vercel.app`. The audit fixes were deployed on Oct 18. The build in review predates them.
- **Not hands-free:** say "eyes-up, phone-free". A tap starts a note.
- **Speed:** never claim a speed ("two seconds", "instant"). Nothing has been timed end to end on hardware.
- **Testing:** the installed-Beta checks on G2 are still open ([`beta-acceptance.md`](beta-acceptance.md)).
- **Data:** all students are synthetic. Every email goes to one demo inbox.

## Setup

### Load the app with the QR code, not the Beta

The portal Beta installs v0.1.0, which packages the client code from before the fixes. Scan [`screens/demo-qr-0.1.1.png`](screens/demo-qr-0.1.1.png) in the Even app's developer mode instead. It opens `https://coachlens-phone.vercel.app/?v=0.1.1`, the live build. The phone must be online. Pair with the usual code; the code is never written down.

### Before judging

- [ ] **Pair once** to confirm the code works. Pairing uses up nothing.
- [ ] **Don't rehearse on production data.** These moments fire once, and Undo doesn't bring back an insight that already fired:
  - Jake's return banner;
  - Priya's third guard note becoming a recurring issue;
  - Gus's rank review.

  Practice in the simulator, or **reseed about 15 minutes before judging**. Reseeding wipes the data: back up first (see the README), then run `npm run seed -w api` with the production env and synthetic `SEED_GUARDIAN_EMAILS`.
- [ ] **Agents tab:** Parent email and Insights set to **Review** (the seeded default).
- [ ] **Warm the API:** open `https://coachlens-api.vercel.app/health` once.
- [ ] Charge the phone and glasses, turn on Do Not Disturb, and have the phone's hotspot ready as a backup network.
- [ ] **Display mode:** Quiet (the default) darkens the lens 8 s after the last change. If judges need the drill and timer on screen, use phone Settings → Display → Standard.

### What the seed sets up

- **Jake:** missed 3 in a row.
- **Priya:** two earlier guard notes, so the live one is her 3rd.
- **Dee:** for the urgent note.
- **Gus:** due a rank review.
- **Maria Gomez (PT):** squat PR 185, three days ago.
- **Eli:** no notes yet.
- **Noah:** grade drop from 84% to 72%.
- **Leo:** repeated billing flags.

### On the laptop

- **Judge guide:** open [`demo-judges.html`](demo-judges.html) full screen (double-click it, then press Ctrl+Cmd+F in the browser). It shows the gestures and lines to say, in big type, so judges can wear the glasses and explore on their own. Hand them the phone for the Review, Today and Agents tabs.
- **Film:** `video/out/coachlens-launch-v3.4.mp4`, ready full screen, to use as an opener or a fallback.
- **Demo inbox** (the `DEMO_EMAIL_OVERRIDE` address), to show the parent email arriving.
- **Optional tabs:** the Devpost page, [`audit-2026-10-18/remediation-ledger.md`](audit-2026-10-18/remediation-ledger.md) and [`audit-2026-10-18/e2e/RESULTS.md`](audit-2026-10-18/e2e/RESULTS.md).

## Live demo (about 3 minutes)

Gestures in class:
- tap: wake and start a note (also on a dark lens or a banner);
- swipe: drill deck, or open a banner;
- double-tap: end class (with a confirm), or undo on a result card.

| # | Do | Lens shows | Say |
|---|---|---|---|
| 1 | Swipe to the kids' martial-arts class, tap. *Optional:* double-tap and say "Cut Kata 2, shorter warm-up, add partner sparring." Tap to stop. | Lobby: class, start time, first drills, footer `tap start · 2× plan · swipe back`. With the optional plan: `● Planning`, then the diff, e.g. `+ Partner sparring 6m` / `- Kata 2` | "My glasses show tonight's class. I can plan it by talking." |
| 2 | Tap to start. Tap, say **"Everyone except Mia."** | Attendance card. Shortly after: `★ Jake's back after 3 missed` | "Roll call is one sentence, with no AI call. Jake missed three in a row; a returning kid is urgent, so it shows now. Everything else waits." |
| 3 | Tap, say **"Priya keeps dropping her guard."** | What you said first, then the agents' progress | "Her third guard note, so it's a recurring issue: it goes on her report card and into next class's plan." |
| 4 | Tap, say **"Priya kept her guard up that time."** | Card reads it as praise | "It knows praise from a problem. No new issue, no plan change." |
| 5 | Double-tap the card | `Undoing…`, then `UNDONE` with each reversed item | "Undo reverses everything a note did. If an email already went out, it says it can't unsend it." |
| 6 | Tap, say **"Dee rolled her ankle and sat out the last drill."** | Urgent card, parent email drafting | "An injury drafts a parent email, and urgent emails always wait for me." |
| 7 | Tap, ask **"Who keeps dropping their guard?"** | ANSWER card listing names with counts | "I can ask the class a question; the answer comes from its notes." |
| 8 | Double-tap, tap to confirm | `40 min · 6 drills · 9/12 with a note` / `Missed: …` / `N agent actions · N to review` / `tap: put … first next class` | "When class ends I see who I haven't noted. One tap puts them first next class." |
| 9 | On the phone (hand it over): **Review** → Dee's email (URGENT, first) → Send, then show the inbox. **Today** → `Gus: review for next rank`. **Agents** → Auto · Review · Off | Nothing (the lens goes dark) | "The agents did the follow-up. The email waited for me. Gus is flagged for a rank review with the evidence; the call is mine. Every agent has Auto, Review or Off." |

To let a judge try it, hand over the glasses after step 2 and have them say one note and one question.

**Optional PT beat** (switch class): in the *PT · Mon 6:00* session, "Maria hit 225 on deadlift." The card shows `√ Maria · deadlift 225 lb (PR +10)`.

## If something goes wrong

| Problem | Do |
|---|---|
| Lens is dark | Tap. That's Quiet mode, not a crash. |
| `Couldn't hear you` | Speak up and move the mic closer. If the glasses mic is too quiet, the app switches to the phone mic. The loudness cutoff isn't tuned on hardware yet. |
| Note stuck `↑ queued` | The network is down. The note is safe on the phone and sends when back online; retrying can't create a duplicate. Switch to the hotspot. |
| Glasses won't connect | Play the film, and show the phone tabs on the laptop. |
| Phone asks to pair again | Enter the code again. Tokens last 90 days, so this shouldn't happen mid-demo. |

## Q&A

| Question | Answer |
|---|---|
| Is it on the store? | Submitted Oct 17 and in review, not approved. This is the current build in developer mode. |
| Hands-free? | Eyes-up and phone-free. A tap starts a note. |
| How fast is it? | Not measured end to end on hardware yet. Notes save on the phone first, so a slow network never loses one. |
| What if the AI is wrong? | Undo reverses everything a note did. Each agent has Auto, Review or Off. Emails default to Review, and urgent ones always need the coach. |
| How is it different from Conversate or QuickNote? | Notes are the input, not the product. Agents act on them: attendance, parent emails, plan changes, report cards and insights, built for the middle of a class. |
| Privacy? | Audio goes to speech-to-text and is held only temporarily on the phone; the server never keeps it. Each coach's data is separate. Phone logins expire after 90 days, and a coach can unpair or sign out other phones. The demo uses synthetic students. |
| What does the AI cost? | A daily cap on AI calls. Roll call, head counts and "who hasn't been noted" use no AI. |
| Have real coaches used it? | Not yet. I teach martial arts myself, and there is a pilot plan ([`research.md`](research.md)). No user validation so far. |
| How do you know it works? | 902 automated tests, 13 end-to-end scenarios in the simulator, and an independent audit whose fixes are now deployed. Testing on the G2 itself is next. |
| Stack? | Even Hub SDK, React and Vite (phone), Hono on Vercel, Neon Postgres, Claude Haiku (routing) and Sonnet (writing), OpenAI speech-to-text, Resend. |

## Recorded film

`video/out/coachlens-launch-v3.4.mp4` (2:21, web copy `-web.mp4`) was rendered locally on Oct 18 and is not uploaded.
- It is a sequence of real simulator renders at authored timings. It is not an uncut hardware recording and not a latency measurement.
- It has music and on-screen text, no voiceover.
- Its on-screen claims match this script: "eyes-up AI follow-up", "0 found in our survey", "Submitted to the Even Hub store".
- The published v3.3 still has the older lines; see [`claims-to-update.md`](claims-to-update.md).
