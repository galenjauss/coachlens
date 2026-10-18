# CoachLens: Devpost write-up

**Even Hub app name:** CoachLens
**Challenge:** Even Realities
**Tagline:** Teach the class. CoachLens runs the follow-up.

## Status, in one paragraph

CoachLens v0.1.0 was **submitted to the Even Hub store on Oct 17 and is in review**; it has not been approved. The Beta build runs on the team's loaner G2. We tested development builds on a real G2 during the hackathon, but the installed-Beta acceptance checks (5-minute lock, permission denial, system exit) are still open; our procedure is in the repo (`docs/beta-acceptance.md`). The live service is a single-coach demo with synthetic students. After an independent audit on Oct 18 we fixed the problems it found **in source and verified them locally**. We have **not redeployed production**, so the live demo still runs the version described as "deployed" below.

## Inspiration

I teach kids martial arts. In a 45-minute class with 20 kids I want to give each one specific feedback, and I can't write anything down because my hands are holding pads. By the time I get home I remember two kids, not twenty. Parents want updates, billing needs chasing, and the next class plan lives in my head. Studio software is an after-class dashboard; nothing works while I'm standing on the mat.

Research on feedback and parent communication is why this matters to me. In a meta-analysis of 435 studies, high-information feedback showed an average effect size of d = 0.99, compared with d = 0.24 for simple reinforcement or punishment [1]. In a randomized field experiment, weekly one-sentence individualized teacher-to-parent messages cut the share of students who failed to earn course credit from 15.8% to 9.3% [2]. These studies motivate the problem. They are not measurements of CoachLens, which has not been piloted yet.

[1] Wisniewski, B., Zierer, K., & Hattie, J. (2020). The power of feedback revisited: A meta-analysis of educational feedback research. *Frontiers in Psychology, 10*, 3087. https://doi.org/10.3389/fpsyg.2019.03087

[2] Kraft, M. A., & Rogers, T. (2015). The underutilized potential of teacher-to-parent communication: Evidence from a field experiment. *Economics of Education Review, 47*, 49–63. https://www.hks.harvard.edu/publications/underutilized-potential-teacher-parent-communication-evidence-field-experiment

Even's judging doc puts it plainly: "Technology should feel natural. Intelligence should be quiet. Attention should be respected." A coach's attention belongs on the students. CoachLens is built for **eyes-up, phone-free capture**: a tap, one sentence, a short confirmation, and the follow-up happens later.

## What it does

CoachLens turns the G2 into an instructor's assistant during class.

- **Home and lobby.** Swipe through your classes and tap one to open its lobby, which shows the plan and the top insight. Tap starts class. Double-tap starts a **planning listen**: you talk the plan through with your assistant, the AI reshapes the drills, and the lens shows a diff (`+ Partner sparring 6m`, `- Kata 2`) that you can undo.
- **In class.** Tap, talk in plain language, and tap to stop. Swipe opens the drill deck, double-tap ends class, long-press is hold-to-talk, and a nod turns the lens dark or on. Roll call is one sentence: "everyone except Jake and Mia".
- **Agent card.** What you said appears first, then the result. "Dee rolled her ankle and sat out the last drill" is urgent, so a parent email draft is created and held for your review. "Maria hit 225 on deadlift" logs a PR (`√ Maria · deadlift 225 lb (PR +10)`). "How's Priya doing?" shows her brief: rank and time in rank, attendance dots (`●●○●●●`), last notes and metrics. Recurring concerns roll into the report card and the next plan.
- **Class questions.** Tap and ask "who is forgetting to keep their guard up?" and the lens shows an ANSWER card such as `Guard: Priya (3), Sam (3), Ava (1), Ben (1)`. You can also ask "who hasn't been noted yet?", "how many are here?" or "what should I focus on next drill?" (fast model, grounded only in class data; it says "Not enough notes yet" when there is too little).
- **Opportunistic insights.** Deterministic detectors look for attendance decline, returning students, kids with no notes, students due a rank review, new PRs, grade drops and repeated billing flags. A returning student shows mid-class as `★ Jake's back after 3 missed`, the way Even's Conversate shows AI insights; everything else waits for the lobby or the end of class.
- **End-of-class summary.** Minutes, drills, note coverage (who has no note yet), agent actions, items to review and the top insight. A tap puts the students without notes first next class.
- **Phone companion** (in the Even app). A Review queue for drafts, Insights with Do it / Dismiss, an Agents tab with per-agent **Auto / Review / Off**, student profiles with metrics, a plan editor that works with or without AI, custom vocabulary for speech-to-text, and an AI onboarding quiz that reads pasted text, CSV or photos of rosters, schedules and curriculum.

Three modes run on one engine: martial arts, personal training and tutoring. Every student in the demo is synthetic.

**More than a note-taker.** Even's QuickNote already captures spoken notes, and Conversate already brings context into the lens. CoachLens adds the part instructors need: each note is tied to a student on a roster, and it drives follow-up the coach can see and review: an email draft, a PR, a plan change, an attendance mark, an insight.

## How we built it

- **Lens:** Even Hub SDK 0.0.16. A pure state-machine reducer drives text containers on the 576x288 canvas (at most 8 text containers, about three glanceable rows). The per-second timer uses partial container updates. Gestures come from SDK events, the nod uses the IMU, and the glasses mic comes through `audioControl`.
- **Phone:** React and Vite inside the Even app WebView, with an offline outbox. Notes, including their audio, are held on the phone until they are delivered, and the lens shows `↑ queued`.
- **API:** Hono on Vercel Fluid Compute and Neon Postgres via Drizzle. OpenAI gpt-4o-transcribe gets roster names and custom vocabulary as hints. A Claude Haiku 5.5 router turns the transcript into typed intents, and Claude Sonnet 5.5 writes emails, report cards and plans through the AI SDK. Insights, briefs, metrics and the summary are deterministic code, and several of the "agents" are plain rules. Resend sends email.
- **Budget:** a daily cap counts **Anthropic model calls only**, including failed ones. It does not cap tokens, speech-to-text, email or hosting, so it is not a complete spending cap. Past the cap, the service runs in degraded mode: model agents fail soft, unsorted notes are kept for review, and deterministic features keep working.
- **Safety:** per-agent autonomy (emails default to Review), billing is flags only, injuries are recorded as observations, and demo email goes to one owned inbox.
- **Process:** subagent-driven development in Claude Code, with an independent review per task and live router evals.

## Challenges

- **BLE update discipline.** Full-screen redraws every second dropped audio, so the timer became a small container with partial updates.
- **Mic contention.** Trying one mic and then the other wasted time; opening both and keeping the one that delivers audio was faster.
- **Long conversations, small requests.** Planning listen cuts audio into 20-second chunks that are transcribed in the background, so every request stays under the body limit.
- **Text on a 576x288 canvas.** Every string is clipped at word boundaries against per-container budgets.
- **Agent restraint.** Early versions emailed parents for every recurring issue. Now only urgent notes, explicit requests and accepted insights produce drafts.
- **Being audited.** An independent audit on Oct 18 found real trust problems: praise could be counted as a recurring problem, Undo did not reverse everything it promised, a lost network response could save a note twice, a queued note could be dropped after repeated failures, and the live service is single-coach. It scored us 55/100. We took that seriously (see below).

## What we fixed after the audit (in source, verified locally, not yet deployed)

- **Praise stays praise:** notes keep whether they are a concern, praise or improvement, and only current concerns count toward a recurring issue.
- **Complete Undo:** reverses attendance, rank, metrics, issues, drills and plan changes as well as the note, and cancels pending email drafts. Sent email cannot be recalled, and the card says so.
- **Idempotent retries** and **failed-note retention**, so flaky networks neither duplicate nor lose notes.
- **Roll call anywhere**, with a clear "Nothing changed" when a sentence does nothing. Roll call, counts and "who hasn't been noted yet" make zero model calls.
- **Insights as review prompts:** "review for next rank" shows the evidence present and what is not tracked, instead of a "ready to test" email; an issue is marked resolved only on an explicit accept; urgent notes get a short factual email.
- **Multi-instructor isolation**, per-instructor pairing codes, 90-day tokens and **Unpair**.
- **Quiet display mode** (the default): the idle display hides after 8 s, cards dismiss after 6 s, and a tap always records during class.

The live demo will keep running the earlier version until we redeploy and re-run our checks.

## Accomplishments

- A voice-to-follow-up loop that ran on a real G2 in development builds, from a temple tap to a student-specific card.
- Submitted to the Even Hub store (v0.1.0, in review), with a full listing, privacy policy and simulator screenshots.
- Agents that act on their own initiative, with an honest Auto / Review / Off control per agent.
- Three teaching modes from one engine, with onboarding from a photo of a roster.
- A clear owner procedure for the installed-Beta gate, and documentation that says what is deployed, what is only in source, and what is still unmeasured.

## What we learned

- On a glanceable display, restraint is the feature, and we have not fully earned it yet: the audit showed that our lens kept more on screen than our pitch said. Quiet mode is our answer.
- The confirmation card is the safety net, so Undo has to be complete. A partial Undo is worse than none.
- Deterministic detectors beat an LLM for insights: fast, free and testable. They still need careful wording, because "no recent note" is not "improved".
- Real hardware disagrees with simulators about timing, fonts and audio.

## What we haven't measured yet

Capture completion, wrong-student rate, praise or problem mistakes, successful corrections, attention time per capture, end-to-end time on physical G2, speech accuracy in a loud gym, and review workload. Learning or retention outcomes are hypotheses until a real study.

## What's next

- Deploy the remediation and complete the installed-Beta acceptance run on physical G2.
- An observed pilot with 2–3 independent instructors, measuring the list above.
- Roster and class maintenance on the phone (add, edit and remove students and guardians).
- Android background hardening.
- Public release once Even's review of v0.1.0 (or a later build) is approved.

## Judging criteria

### Who is this for?
Solo instructors who teach on their feet: martial-arts coaches, personal trainers, tutors.

### What moment is it designed for?
The live class: the moment the coach notices something about one student while their attention belongs on the room. Then comes the follow-up that usually gets lost: the parent email, the next plan, the kid with no note.

### Why does it belong on G2?
The coach's eyes must stay on the room, and a phone on the mat is unsafe. A tap, a sentence and a glance at a confirmation are the whole interaction, and the G2 puts the result in the coach's line of sight without them picking up a phone. It is eyes-up and phone-free, not hands-free: starting and stopping a note takes a tap.

### Can the judge try it right now?
Yes, on the loaner G2, which the team pairs at the table. Tap a class, tap to start, say "everyone except Jake" in the roll-call step, then "Priya needs to keep her hands up", and watch the card. Beta install: Even Realities app → Me → Beta tester → CoachLens → Install. The installed-Beta acceptance checks are still open.

### Made for G2
*"Does the experience make thoughtful use of G2 and its place in the wearer's line of sight?"*
Every screen fits about three rows within the SDK's container limits, including the ANSWER card for class questions. CoachLens uses the IMU (nod to go dark), the glasses mic, partial text updates for the timer, and a gesture map designed around a coach's hands: tap to start and stop a note, swipe for the deck, double-tap to end, long-press for hold-to-talk.

### Quiet by Design
*"Does the technology appear when it is useful and stay out of the way when it isn't?"*
Insights appear in the lobby and the end-of-class summary; mid-class, only high urgency (a returning student) shows as a ★ banner. Emails default to Review. The deployed build keeps the drill and timer visible during class, and cards stay until dismissed. Our new Quiet mode, in source and not yet deployed, hides the idle display after 8 s and dismisses cards after 6 s.

### Originality
*"Does the idea open up a new moment or use case for Even Hub?"*
We do not claim to have invented teacher glasses: Lumilo (CMU, 2018) showed teachers per-student status in mixed-reality glasses, and Even's QuickNote and Conversate already cover spoken capture and in-lens context. What we claim is the combination: observations that the teacher speaks during a live class on G2, each linked to a student, driving the instructor's follow-up. In our non-exhaustive survey of about 220 community G2 projects, we found none built for instructors that does this. The official store could not be enumerated.

### Experience & Polish
*"Is it clear, natural, and easy to use?"*
No syntax: "Dee rolled her ankle and sat out the last drill" works, and so does asking the class "who is forgetting to keep their guard up?". The transcript appears first, the card confirms, and double-tap undoes. Undo is complete in source; the deployed version removes only the note and billing flags. Plans work with or without AI, and notes wait on the phone when the network drops.

### Execution
*"Can a judge put on G2 and experience the core idea right now?"*
Yes, on the loaner, paired at the table. We ran development builds on a real G2 during the hackathon; the installed-Beta acceptance run is still open. The test suite passed 687 tests at audit time and 725 with the remediation merged so far. In an earlier run, 43 of 44 router eval cases passed on the live model.

## About the demo video

The film sequences real simulator renders of CoachLens at authored timings. It is **not a latency measurement** and not an uncut recording from the glasses. The v3.3 cut's closing card says "Now on the Even Hub store", which is not accurate: v0.1.0 is submitted and in review, not approved. The source now reads "Submitted to the Even Hub store" for the next render.

## Built with

Even Hub SDK, Even Realities G2, TypeScript, React, Vite, Hono, Vercel Fluid Compute and Cron, Neon Postgres, Drizzle ORM, Vercel AI SDK, Anthropic Claude (Haiku 5.5, Sonnet 5.5), OpenAI gpt-4o-transcribe, Resend, Zod, Vitest, Claude Code.

## Links

- Code: https://github.com/galenjauss/coachlens
- Demo video: `<video URL>`
- Try it: Even Hub app **CoachLens** (Beta); see the README section "Install and run". The pairing code is given in person.
