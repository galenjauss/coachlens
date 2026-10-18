# CoachLens: Devpost write-up

**Even Hub app name:** CoachLens
**Challenge:** Even Realities
**Tagline:** Teach the class. CoachLens runs the follow-up.

## Inspiration

I teach kids martial arts. In a 45-minute class with 20 kids I want to give each one specific feedback, and I can't write anything down because my hands are holding pads. By the time I get home I remember two kids, not twenty. Parents want updates, billing needs chasing, and the next class plan lives in my head. Studio software is an after-class dashboard; nothing works while I'm standing on the mat.

The evidence says the moment matters. High-information feedback has an effect size of d=0.99 versus d=0.24 for praise. Weekly personalized teacher-to-parent messages cut course failure from 15.8% to 9.3% in a randomized trial.

Even's judging doc puts it plainly: "Technology should feel natural. Intelligence should be quiet. Attention should be respected." A coach's attention belongs on the students. CoachLens takes one tap and one sentence, then keeps the lens dark and the agents working in the background.

## What it does

CoachLens turns the G2 into an instructor's assistant during class.

- **Home and lobby.** Swipe through your classes and tap one to open its lobby: the plan and the top insight. Tap starts class. Double-tap starts a **planning listen**: talk the plan through with your assistant, and the AI reshapes the drills, showing a diff on the lens (`+ Partner sparring 6m`, `− Kata 2`) with undo.
- **In class.** Tap and talk in plain language. Swipe opens the drill deck, double-tap ends class, long-press is hold-to-talk, a nod turns the lens dark or on. Roll call is one sentence: "everyone except Jake and Mia".
- **Agent card.** What you said appears first, then live agent progress. "Dee rolled her ankle and sat out the last drill" is urgent, so a parent email draft is created. Recurring issues roll into the report card and the next plan. "Maria hit 225 on deadlift" logs a PR (`✓ Maria · deadlift 225 lb (PR +10)`). "How's Priya doing?" shows her brief: rank and time in rank, attendance dots (`●●○●●●`), last notes, metrics.
- **Class questions.** Tap and ask "who is forgetting to keep their guard up?" and the lens shows an ANSWER card such as `Guard: Priya (3), Leo (2)`. Also "who hasn't gotten feedback today?", "how many are here?" (instant, no AI call) and "what should I focus on next drill?" (fast model, grounded only in class data; says "Not enough notes yet" when thin).
- **Opportunistic insights.** Deterministic detectors find attendance decline, returning students, kids with no feedback, students ready to test, new PRs, grade drops, resolved issues and repeated billing flags. Each has a one-tap action: draft an email, put the student first next class, or mark the issue resolved. A returning student shows mid-class as `💡 Jake's back after 3 missed`, the way Even's Conversate shows AI insights.
- **End-of-class summary.** Minutes, drills, feedback coverage (who got none), agent actions, items to review, top insight. Tap puts the missed kids first next class.
- **Phone companion** (in the Even app): Review queue for drafts, Insights with Do it / Dismiss, an Agents tab with per-agent **Auto / Review / Off**, student profiles with metrics, a plan editor that works with or without AI (repeat last class, copy another class, blank, AI draft, manual edits), custom vocabulary for speech-to-text, and an AI onboarding quiz that reads pasted text, CSV or photos of rosters, schedules and curriculum.

Three modes run on one engine: martial arts, personal training and tutoring.

**Why it is not a note-taker.** Judges "see a lot of teleprompters, translators, and note-takers". In CoachLens a note is an input. Each note triggers autonomous agents for that student, and the coach sees the outcome: an email draft, a PR, a plan change, an attendance mark, an insight.

## How we built it

- **Lens:** Even Hub SDK 0.0.16. A pure state-machine reducer drives text containers on the 576x288 display (at most 8 text containers, about three glanceable rows). The per-second timer uses partial container updates. Gestures come from SDK events; the nod uses the IMU; the glasses mic comes through `audioControl`.
- **Phone:** React and Vite inside the Even app WebView, with an offline outbox: notes are saved locally first, sync later, and show `⟳ queued` on the lens.
- **API:** Hono on Vercel Fluid Compute, Neon Postgres via Drizzle. OpenAI gpt-4o-transcribe with roster names and custom vocabulary as hints. A Claude Haiku 5.5 router turns the transcript into typed intents; Claude Sonnet 5.5 writes emails, report cards and plans through the AI SDK. Insights, briefs, metrics and the summary are deterministic code with no LLM. Resend sends email. A daily AI budget cap fails soft.
- **Speed:** transcript-first display, dual-mic start (glasses and phone together), keep-warm pings during a session.
- **Safety:** per-agent autonomy (emails default to Review), billing is flags only, injuries are observations, demo email goes to one owned inbox.
- **Process:** subagent-driven development in Claude Code, with an independent review per task, live router evals, and 500+ automated tests (shared, api, app).

## Challenges

- **BLE update discipline.** Full-screen redraws every second dropped audio, so the timer became a small container with partial updates.
- **Mic contention and latency.** Sequential mic fallback cost a second; opening both mics and picking the one with sound fixed it.
- **Long conversations, small requests.** Planning listen cuts audio into 20-second chunks transcribed in the background, so the end is fast and every request stays under the body limit.
- **Text on a 576x288 lens.** Every string is clipped at word boundaries against per-container budgets.
- **Agent restraint.** Early versions emailed parents for every recurring issue. Now only urgent notes, explicit requests and accepted insights produce drafts, and insights wait for quiet moments.

## Accomplishments

- A voice-to-agents loop that runs end to end on real G2 hardware.
- Agents that act on their own initiative, with an honest autonomy control per agent.
- Three teaching modes from one engine, with onboarding from a photo of a roster.
- Quiet by default: the lens shows almost nothing until something real happens.

## What we learned

- On a glanceable display, restraint is the feature. Showing less, triggered by something real, beats showing more.
- The confirmation card is the safety net, not a command grammar. Plain speech plus "here's what I did" beats teaching a syntax.
- Deterministic detectors beat an LLM for insights: fast, free, testable, and never surprising.
- Real hardware disagrees with simulators about timing, fonts and audio.

## What's next

- Pilot with instructors at my dojo and a local gym.
- A parent-facing view for report cards.
- Android background hardening.
- Public Even Hub release after review.

## Judging criteria

### Who is this for?
Solo instructors who teach on their feet: martial-arts coaches, personal trainers, tutors.

### What moment is it designed for?
The live class: the two seconds after the coach notices something about one student, with no free hands. Then the follow-up that usually gets lost: the parent email, the next plan, the kid who got no feedback.

### Why does it belong on G2?
Hands are busy and eyes must stay on the room. A tap, a sentence and a glance are the whole budget, and the G2 puts the answer in the coach's line of sight without using their hands.

### Can the judge try it right now?
Yes. The team pairs the loaner G2 at the table. Tap a class, tap to start, say "everyone except Jake", then "Priya needs to keep her hands up", and watch the card. Beta install: Even Realities app → Me → Beta tester → CoachLens → Install.

### Made for G2
*"Does the experience make thoughtful use of G2 and its place in the wearer's line of sight?"*
Every screen fits about three rows within the SDK's container limits, including the ANSWER card for class questions (`Guard: Priya (3), Leo (2)`). It uses the IMU (nod to go dark), the glasses mic, partial text updates for the timer, and a gesture map designed around a coach's hands: tap to talk, swipe for the deck, double-tap to end, long-press to hold-to-talk.

### Quiet by Design
*"Does the technology appear when it is useful and stay out of the way when it isn't?"*
The lens is dark until triggered. One gesture to talk. Insights appear in the lobby and the end-of-class summary; mid-class only high urgency (a returning student) shows as a 💡 banner, and it never covers recording or the card. Emails default to Review.

### Originality
*"Does the idea open up a new moment or use case for Even Hub?"*
We checked about 220 community apps plus Even's built-in features. None is built for instructors. To our knowledge, CoachLens is the first Even Hub app for coaches and teachers. The partial overlaps (QuickNote and Conversate, the Cue memory app, workout trackers) capture or coach the wearer. CoachLens acts for the people the wearer teaches.

### Experience & Polish
*"Is it clear, natural, and easy to use?"*
No syntax: "Dee rolled her ankle and sat out the last drill" just works, and so does asking the class "who is forgetting to keep their guard up?" (instant answers for counts like "how many are here?"). The transcript appears first, the card confirms, double-tap undoes. Plans work with or without AI. Notes survive a dead network.

### Execution
*"Can a judge put on G2 and experience the core idea right now?"*
Yes, on the loaner, paired at the table. Hardware-tested on a real G2: the tap-speak-card loop, the per-second timer, the nod, the phone-mic fallback. 500+ automated tests (shared, api, app) plus live router evals across all three modes: 43/44 cases pass on the live model.

## Built with

Even Hub SDK, Even Realities G2, TypeScript, React, Vite, Hono, Vercel Fluid Compute and Cron, Neon Postgres, Drizzle ORM, Vercel AI SDK, Anthropic Claude (Haiku 5.5, Sonnet 5.5), OpenAI gpt-4o-transcribe, Resend, Zod, Vitest, Claude Code.

## Links

- Code: `<GitHub repo URL>`
- Demo video: `<video URL>`
- Try it: Even Hub app **CoachLens** (Beta); see the README section "Install and run on G2". Pairing code given in person.
