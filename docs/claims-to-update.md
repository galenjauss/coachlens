# Public claims to update (owner to paste)

Prepared Oct 18, 2026 from the audit remediation (batch 4). Nothing here has been posted. Devpost, YouTube and the Even Hub portal were not touched. Each item gives the place, the current text (as written in `docs/devpost.md` before this change, which the checklist says was pasted as-is), and the exact replacement. Where you cannot edit something (for example, a submitted store build), leave it and use the next build.

Ground rules for any new copy:
- Store: "submitted to the Even Hub store" / "in Even Hub review". Never "on the store", "available" or "live" until Even approves it.
- Hardware: "development builds ran on a real G2". Never "verified on the installed Beta" until [`beta-acceptance.md`](beta-acceptance.md) is signed with evidence.
- Interaction: "eyes-up, phone-free". Never "hands-free", "two seconds" or "instant".
- Remediation: "fixed in source, verified locally, not yet deployed" until production is redeployed and re-checked.
- Insights: "review for next rank", not "ready to test". An issue is resolved only on the coach's explicit accept. Urgent notes get a short factual email.
- Budget: "the daily cap counts Anthropic model calls only".

## 1. Devpost project page (https://devpost.com/software/coachlens)

The simplest, safest option is to replace the whole story with the new [`docs/devpost.md`](devpost.md), from "Status, in one paragraph" through "About the demo video". If you only change individual sections, use these.

**Tagline**
- Current: `Hands-free notes and AI agents for coaches and teachers`
- Replace with: `Eyes-up notes and AI follow-up for coaches and teachers`

**Add at the top of the story (new section)**
> **Status.** CoachLens v0.1.0 was submitted to the Even Hub store on Oct 17 and is in review; it has not been approved. The Beta build runs on our loaner G2. We tested development builds on a real G2 during the hackathon, but the installed-Beta acceptance checks (5-minute lock, permission denial, system exit) are still open. The live service is a single-coach demo with synthetic students. After an independent audit on Oct 18 we fixed the problems it found in source and verified them locally; production has not been redeployed yet.

**Inspiration, last paragraph**
- Current: `CoachLens takes one tap and one sentence, then keeps the lens dark and the agents working in the background.`
- Replace with: `CoachLens is built for eyes-up, phone-free capture: a tap, one sentence, a short confirmation, and the follow-up happens later.`

**Inspiration, after the two citations (add)**
> These studies motivate the problem. They are not measurements of CoachLens, which has not been piloted yet.

**What it does, "Class questions" bullet**
- Current: `"how many are here?" (instant, no AI call)`
- Replace with: `"how many are here?" (answered from attendance)`

**What it does, "Opportunistic insights" bullet**
- Current: `students ready to test` … `or mark the issue resolved`
- Replace with: `students due a rank review` … `or check an issue next class (an issue is marked resolved only when you accept it)`

**How we built it, API bullet**
- Current: `A daily AI budget cap fails soft.`
- Replace with: `A daily cap counts Anthropic model calls only (not tokens, speech-to-text, email or hosting) and fails soft into a degraded mode where notes are still kept.`

**How we built it, Process bullet**
- Current: `… live router evals, and 668 automated tests (shared, api, app).`
- Replace with: `… live router evals, and an automated test suite (687 tests at audit time, 725 with the remediation merged so far).`

**Challenges, "Mic contention and latency"**
- Current: `Sequential mic fallback cost a second; opening both mics and picking the one with sound fixed it.`
- Replace with: `Mic contention. Trying one mic and then the other wasted time; opening both and keeping the one that delivers audio was faster.`

**Accomplishments**
- Current: `A voice-to-agents loop that runs end to end on real G2 hardware.`
- Replace with: `A voice-to-follow-up loop that ran on a real G2 in development builds, from a temple tap to a student-specific card.`
- Current: `Quiet by default: the lens shows almost nothing until something real happens.`
- Replace with: `A Quiet display mode (in source, not yet deployed): the idle display hides after 8 s and cards dismiss after 6 s.`

**What's next**
- Current: `Public release: v0.1.0 is submitted to the Even Hub store and in review.`
- Replace with: `Deploy the audit fixes, complete the installed-Beta acceptance run on physical G2, and run an observed pilot with 2–3 independent instructors. Public release once Even approves a build.`

**Judging: What moment is it designed for?**
- Current: `The live class: the two seconds after the coach notices something about one student, with no free hands.`
- Replace with: `The live class: the moment the coach notices something about one student while their attention belongs on the room.`

**Judging: Why does it belong on G2?**
- Current: `… and the G2 puts the answer in the coach's line of sight without using their hands.`
- Replace with: `… and the G2 puts the result in the coach's line of sight without them picking up a phone. It is eyes-up and phone-free, not hands-free: starting and stopping a note takes a tap.`

**Judging: Quiet by Design**
- Current: `The lens is dark until triggered. One gesture to talk.`
- Replace with: `The deployed build keeps the drill and timer visible during class, and cards stay until dismissed. Our new Quiet mode (in source, not yet deployed) hides the idle display after 8 s and dismisses cards after 6 s.`

**Judging: Originality**
- Current: `We checked about 220 community apps plus Even's built-in features. None is built for instructors. To our knowledge, CoachLens is the first Even Hub app for coaches and teachers.`
- Replace with: `We do not claim to have invented teacher glasses: Lumilo (CMU, 2018) showed teachers per-student status in mixed-reality glasses, and Even's QuickNote and Conversate already cover spoken capture and in-lens context. We claim the combination: observations that the teacher speaks during a live class on G2, each linked to a student, driving the instructor's follow-up. In our non-exhaustive survey of about 220 community G2 projects we found none built for instructors that does this; the official store could not be enumerated.`

**Judging: Experience & Polish**
- Current: `(instant answers for counts like "how many are here?")` … `double-tap undoes.`
- Replace with: `(counts like "how many are here?" come from attendance)` … `double-tap undoes (complete in source; the deployed version removes only the note and billing flags).`

**Judging: Execution**
- Current: `Yes, on the loaner, paired at the table. Hardware-tested on a real G2: the tap-speak-card loop, the per-second timer, the nod, the phone-mic fallback. 668 automated tests (shared, api, app) plus live router evals across all three modes: 43/44 cases pass on the live model.`
- Replace with: `Yes, on the loaner, paired at the table. Development builds ran on a real G2 during the hackathon (tap-speak-card loop, timer, nod, phone-mic fallback); the installed-Beta acceptance run is still open. 687 automated tests passed at audit time, 725 with the remediation merged so far. In an earlier run, 43 of 44 router eval cases passed on the live model.`

**Add near the video**
> The film sequences real simulator renders of CoachLens at authored timings. It is not a latency measurement and not an uncut recording from the glasses.

## 2. Demo video (YouTube, v3.3)

- Closing card: currently `Now on the Even Hub store`. The source now reads `Submitted to the Even Hub store` (`video/src/config.ts`, `STORE_LINE`). The controller re-renders the film; then replace the upload or upload the new cut and update the Devpost link.
- Voiceover in v3.3, if it says "hands free", "two seconds later" or "the first Even Hub app for coaches and teachers": these remain in the uploaded audio until the next render. The corrected lines are in [`demo-script.md`](demo-script.md).
- YouTube description (add as the first lines):
  > CoachLens, an Even Realities G2 app for instructors (LA Hacks 2026). Submitted to the Even Hub store; in review. The film sequences real simulator renders at authored timings; it is not a latency measurement. Demo students are synthetic.

## 3. Even Hub listing (portal)

The submitted v0.1.0 listing cannot be edited while it is in review. With the next build:
- Tagline: `Eyes-up notes and AI follow-up for coaches and teachers.`
- Description: replace `someone ready to test` with `someone due a rank review`, and `Agents take it from there:` with `Agents handle the follow-up:` (see [`store/listing.md`](store/listing.md)).
- Reviewer notes: add `The service is a single-coach demonstration deployment with synthetic students; reviewers share the demo instructor.`
- Privacy policy URL is unchanged (`https://coachlens-phone.vercel.app/privacy.html`). The corrected policy goes live when the phone app (`coachlens-phone.vercel.app`) is next deployed; until then the hosted page still shows the old text ("Audio is not stored", "one-time code", GitHub issues for deletion).

## 4. Anything else said in person or in chat

At the table, say:
> The store build is submitted and in review. The installed-Beta checks are still open. The live service is a single-coach demo with synthetic students. After an independent audit we fixed praise-versus-problem counting, Undo, retries and the display policy in source, but haven't redeployed yet.
