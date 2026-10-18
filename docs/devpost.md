# CoachLens: Devpost write-up

**Even Hub app name:** CoachLens
**Challenge:** Even Realities
**Tagline:** Prep Notes for the dojo. Teach the class; CoachLens runs the business.

## What it does

CoachLens turns the Even G2 into an instructor's second brain mid-class. Tap the temple, say what you just saw ("Priya, guard drops on the jab again, great energy though"), and AI agents take over: they log progress against the student, mark attendance, flag billing, adjust the next lesson plan, and draft a parent or client email only when it is urgent (injury, behavior, safety) or you ask for one. Routine and recurring issues roll into monthly report cards instead of spamming parents. While you talk, the lens shows `● LISTENING 0:04`, then `heard > SENDING > thinking···`, then a card that stays until you tap it away: the full transcript on the left (swipe to page) and a compact agent progress line on the right. A persistent peek view stays on during class with the drill, a per-second countdown and the next student who has not had feedback yet; a nod toggles it dark or visible, and a tap wakes it. At the end, the wrap-up lists who you missed (`Tap = coach them first next class`).

It works for martial arts, personal training and tutoring. Each mode has its own skill tags, vocabulary and guardrails over one shared engine. A phone companion (inside the Even app) has a review queue for outgoing emails, an Agents tab (topic tiles, then color-coded runs, then a detail with "Tell this agent..." steering such as "make that email warmer"), student timelines with monthly AI report cards, a drill-deck editor, and a six-step AI onboarding quiz that reads pasted text, a file or a photo of a schedule or sign-in sheet into editable tables you confirm.

## Inspiration

I teach kids martial arts. In a 45-minute class with twelve kids, I want to give each one specific feedback, and I can't write anything down because my hands are holding pads. By the time I get home I remember two kids, not twelve. Parents want updates, billing needs chasing, and the next class plan lives in my head. Existing studio software is an after-class dashboard. Nothing works while I am standing on the mat.

The evidence says this matters. High-information feedback has an effect size of d=0.99 versus d=0.24 for praise. Weekly personalized teacher-to-parent messages cut course failure by 41% in a randomized trial. About 1 in 5 new gym members quit within 90 days. A glance-and-voice device fits the one place those problems start.

## Why G2

- Hands are busy and eyes need to stay on the kids. A phone on the mat is unsafe and breaks flow.
- Two-second glances, temple taps and voice capture are the exact interaction budget a live class allows.
- The glasses keep working with the phone locked, which is where the phone lives during class.
- The lens shows almost nothing, only what is real and triggered: the drill, the timer, the next kid, and what the agents just did.

## How we built it

- **Lens:** a pure state-machine reducer drives text and list containers on the 576x288 display. The per-second timer uses partial `textContainerUpgrade` updates so nothing flickers, and gestures (tap, swipe, double-tap, long-press) are routed from SDK events. An experimental nod detector reads the IMU.
- **Phone:** React inside the Even WebView, with an offline outbox so notes taken while the phone is locked sync afterwards.
- **API:** Hono on Vercel Functions with Neon Postgres and Drizzle. OpenAI transcribes audio with a roster-name hint. A Claude Haiku router turns a transcript into typed intents, and code agents plus Claude Sonnet writers act on them. Fuzzy name matching resolves "Mya" to Maya, or asks for a two-choice pick on the lens, and reassigning a note teaches a name alias so the same mishearing resolves next time. The planner accepts lenient model output with word-boundary length limits, and if the AI is down it falls back to a visibly flagged starter plan that self-heals on the next load.
- **Safety:** parent and client emails always wait for approval; billing is flags only; emails go out only for urgent notes or explicit requests; a daily AI call cap makes the budget fail soft.
- **Process:** built with subagent-driven development in Claude Code. A controller dispatched an implementer subagent per task, every task got an independent review with fix rounds, and live evals checked the router against real model output (martial arts 15/15, personal training 5/5, tutoring 5/5). The suite has 400 automated tests (shared 12, api 140, app 248).

## Challenges

- **BLE update discipline.** Every repaint competes for the glasses link. Per-second full-screen redraws caused dropped audio, so the timer became a tiny dedicated container with partial updates and the bar refreshes only every 5 seconds.
- **Partial-update discovery.** Making `textContainerUpgrade` offsets behave on real hardware took trial on the glasses, not the simulator.
- **Mic contention.** When the glasses send no audio we fall back to the phone mic (`● LISTENING (phone)`), and had to close one source before opening the other so they never mix.
- **Text on a 576x288 lens.** Long drill and lesson names broke the layout, so every lens string is wrapped and clipped at word boundaries against per-container character budgets, and the deck opens a drill detail with the full name and cues.
- **WebView scroll.** A body height lock made every phone screen unscrollable on iOS until we found it.
- **Agent restraint.** Early versions drafted an email for every recurring issue. We now email only for urgent notes or explicit requests; recurring issues roll into the monthly report card, so parents get fewer, better messages.

## Accomplishments

- A complete voice-to-agents loop that works on real G2 hardware, end to end, in about three seconds.
- Three teaching modes from one engine.
- An approval-first autonomy model: internal actions run automatically, outward-facing ones wait for a tap.
- Honest evidence: we state the gaps (no data on the share of solo instructors, no martial-arts proof that report cards improve retention).

## What we learned

- On a glanceable display, restraint is the feature. Showing less, triggered by something real, beat showing more.
- The confirmation card is the safety net, not a command grammar. Letting people speak naturally and then showing what happened is faster than teaching them a syntax.
- Real hardware disagrees with simulators about timing, fonts and audio.

## What's next

- Test the x-axis nod gesture with more people and firmware.
- Idempotency keys so a dropped network response can never duplicate a note.
- Android background hardening.
- A parent-facing view and payment-provider integrations, once policy allows.
- Public Even Hub release after review.

## Built with

Even Hub SDK, Even Realities G2, TypeScript, React, Vite, Hono, Vercel Functions and Cron, Neon Postgres, Drizzle ORM, Anthropic Claude (Haiku and Sonnet), OpenAI speech-to-text, Resend, Zod, Vitest, Claude Code.

## Links

- Code: `<GitHub repo URL, add after publishing>`
- Demo video: `<video URL>`
- Try it: join the Beta (see README, "Install and run on the G2"); pairing code given at the table.
