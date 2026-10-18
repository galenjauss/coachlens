# CoachLens

**Even Hub app name: CoachLens.** An Even Realities G2 app for instructors, built at LA Hacks 2026 (Even Realities track).

CoachLens is for the solo instructor in the middle of a class: martial arts, personal training or tutoring. Your hands are on pads or a whiteboard and your eyes are on 20 kids, so a phone is the wrong tool. Tap the temple and say what you saw in plain language. A team of AI agents turns that sentence into outcomes for that one student: a logged note, a parent email draft, a change to the next plan, a PR, an attendance mark. The lens shows one glance of confirmation, then goes quiet.

> "Technology should feel natural. Intelligence should be quiet. Attention should be respected." (Even Realities judging doc)
>
> **Natural:** one tap, then plain speech; no commands to learn. **Quiet:** the lens stays dark until something real triggers it, and agents surface insights at the lobby and the end of class, not mid-drill. **Respected:** the coach's attention stays on the students; outward-facing actions wait for the coach.

## Who is this for?

Solo instructors who teach on their feet: a martial-arts coach with 20 kids on the mat, a personal trainer between sets, a tutor at a whiteboard. They give dozens of corrections per class and remember two by the time they get home.

## What moment is it designed for?

The live class. The coach notices something ("Priya's guard keeps dropping", "Dee rolled her ankle") and has two seconds and no free hands. CoachLens captures that moment without breaking the class, and handles the follow-up after it: the parent email, the report card, the next plan.

## Why does it belong on G2?

- Hands are busy and eyes must stay on the students. A phone on the mat is unsafe and breaks flow.
- A temple tap, a short sentence and a two-second glance are exactly the interaction budget a live class allows.
- The G2 sits in the line of sight, so a 💡 insight ("Jake's back after 3 missed") or the next kid who needs feedback can land without looking away from the room.
- The glasses keep working while the phone is locked in a bag, which is where it lives during class.

## Can the judge try it right now?

Yes. See [Install and run on G2](#install-and-run-on-g2). The team pairs the loaner G2 at judging; put it on, tap, and talk.

## Not a note-taker

The challenge page notes that judges "see a lot of teleprompters, translators, and note-takers". CoachLens is not one. A note is an input, not the output: each spoken note triggers autonomous agents for that student, with outcomes you can see.

- An urgent note ("Dee rolled her ankle and sat out the last drill") becomes a parent email draft.
- A recurring issue (same skill tag 3+ times in 30 days) goes into the monthly report card and the next class plan.
- A metric ("Maria hit 225 on deadlift") becomes a PR on her profile.
- A question ("how's Priya doing?") returns a profile brief on the lens.
- A class question ("who is forgetting to keep their guard up?") returns an ANSWER card built from the class's notes, for example `Guard: Priya (3), Leo (2)`. See [Class questions](#class-questions).
- A roll call ("everyone except Jake and Mia") marks attendance, which feeds the insights agent.

## The lens flow

| Screen | Tap | Double-tap | Swipe | Other |
|---|---|---|---|---|
| **Home** (class list) | Enter that class's lobby | Even's exit dialog | Cycle classes | Nod: lens dark/on |
| **Lobby** (plan, top insight) | Start class | Planning listen | Back to home | Nod: lens dark/on |
| **Planning listen** | Stop and apply | Cancel | | 3 min cap |
| **Plan result** (diff summary) | OK | Undo | Back to lobby | |
| **In class** | Talk in plain language | End class | Drill deck | Long-press: hold to talk; nod: lens dark/on |

- **Planning listen.** In the lobby, double-tap and talk the plan through with your assistant instructor. The planner agent reshapes the drills and the lens shows a diff summary (`+ Partner sparring 6m`, `− Kata 2`, `~ Warm-up 10→5m`). Double-tap undoes it.
- **Agent card.** After you speak, the card shows what you said and live agent progress, for example `✓ Maria · deadlift 225 lb (PR +10)`. For a question, it shows the student's brief instead: rank and time in rank, attendance dots (`●●○●●●`), last notes, latest metric.
- **Voice roll call.** "Everyone except Jake and Mia" or "Present: Priya, Leo, Maya".
- **End-of-class summary.** Minutes, drills, feedback coverage and who got none, agent actions, items to review, and the top insight. Tap puts the missed kids first in the next class.

## Class questions

Tap and ask the lens about the whole class, not one student. The answer lands as an ANSWER card:

- "Who is forgetting to keep their guard up?" shows `Guard: Priya (3), Leo (2)`.
- "Who hasn't gotten feedback today?" lists the students with no notes yet.
- "How many are here?" answers instantly from attendance, with no AI call.
- "What should I focus on next drill?" uses the fast model, grounded only in this class's data. When the notes are thin it says "Not enough notes yet" instead of guessing.

## Opportunistic insights agent

Agents also act without being asked. Deterministic detectors (no LLM) run on session end, on attendance changes and nightly. After roll call an immediate insight check runs, so a returning-student banner appears about 2 s later:

| Detector | Fires when | One-tap action |
|---|---|---|
| Attendance decline | Absent in 2 of the last 3 sessions, or attendance halved | Draft email |
| Returning student | Present today after 2+ consecutive absences | Shown mid-class: `💡 Jake's back after 3 missed` |
| No feedback | Present 3 sessions running with no notes | Put first next class |
| Ready to test | Martial arts: 90+ days in rank, no open issues | Draft email |
| New PR | Personal training: a PR in the last 7 days | Draft praise email |
| Grade drop | Tutoring: latest test 10+ points below the previous one | Draft email |
| Issue resolved | No new notes on an open issue for 21 days | Mark resolved, positive note |
| Repeated billing | 2+ open billing flags for one student | Draft email |

**Quiet by design:** insights appear in the lobby and the end-of-class summary. Mid-class, only high-urgency items (a returning student, a kid still without feedback late in class) show, as a 💡 banner in the style of Even's Conversate AI insights. A banner never interrupts recording or the agent card.

## Agents and autonomy

- **Router** (Claude Haiku 5.5): turns a transcript into typed intents and resolves names, including learned aliases ("Mya" resolves to Maya).
- **Progress**: notes with skill tags; spots recurring issues.
- **Parent / client email** (Claude Sonnet 5.5): drafted for urgent notes, explicit requests and accepted insights.
- **Report cards** (Sonnet): monthly, grounded in quoted coach notes.
- **Planner** (Sonnet): nightly drafts, voice plan edits, note-driven adjustments.
- **Attendance**, **billing flags** (notes only, no payments), **metrics and briefs** (deterministic), **insights** (deterministic).

Every agent has an **Auto / Review / Off** setting on the phone. Emails default to Review: nothing outward-facing is sent without the coach unless they choose Auto. Each run is logged on the Agents tab, and a "Tell this agent..." box steers it ("warmer, shorter").

**Plans with or without AI.** Repeat the last class, copy another class's plan, start blank, let the AI draft, or edit by hand (add, rename, minutes, reorder, cues).

**Custom vocabulary.** "Words CoachLens should know" (technique names, drill names) are sent to speech-to-text with the roster names.

## Speed and offline

- **Transcript first:** what you said appears on the lens before the agents finish.
- **Dual-mic start:** glasses and phone mics open together; the glasses audio is used when it has sound, otherwise the phone's.
- **Keep-warm:** the API is pinged during a session so there are no cold starts mid-class.
- **Offline queue:** notes are saved locally first and sync later. The lens shows `⟳ 2 queued`, and the phone offers Retry now.

## Three modes and onboarding

| Mode | People | Plan | Metrics | Messages go to |
|---|---|---|---|---|
| Martial arts | students | drill deck | rank, time in rank | parent |
| Personal training | clients | session plan | lift PRs | the client |
| Tutoring | students | lesson plan | test grades | parent |

Personal-training output never contains medical, injury or nutrition advice; tutoring never guarantees grades. Setup is an AI onboarding quiz that reads pasted text, CSV or photos of rosters, schedules and curriculum into editable tables you confirm.

## Install and run on G2

**On the judges' loaner:** the team pairs it at judging. Put it on, launch CoachLens from the glasses home, tap a class, tap to start, and talk.

**On your own G2 (Beta):**

1. Send the team your Even account email so we can add you to the CoachLens Beta group.
2. In the Even Realities app on your iPhone: **Me → Beta tester → CoachLens → Install**.
3. Open CoachLens on the phone and enter the pairing code the team gives you in person.
4. Launch CoachLens from the glasses home and tap.

Testers need no API keys. iPhone is the supported device; on Android the WebView may pause when the phone locks.

**Dev test URL:** https://coachlens-phone.vercel.app. With Even developer mode on, scan its QR code from the Even app.

### Self-hosting

Requires Node 20+ and a Postgres database (Neon recommended).

```bash
npm install
cp api/.env.example api/.env.local   # fill in values; never commit this file
```

Required variables (see `api/.env.example` for the full list; values are never committed):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `DATABASE_URL`, `PAIRING_CODE`, `CRON_SECRET`, `DEMO_EMAIL_OVERRIDE`.

```bash
npm run dev -w api                                        # API
npm run dev -w app                                        # Even Hub app on :5173
cd app && npx evenhub-simulator http://localhost:5173     # G2 simulator
npm test                                                  # all workspaces
npm run seed -w api                                       # demo data; WIPES all data first (needs DATABASE_URL, SEED_GUARDIAN_EMAILS)
```

On real glasses over the LAN: `cd app && npx evenhub qr --url http://<your-lan-ip>:5173`. To package for the Even Hub portal: `cd app && npm run build && npx evenhub pack app.json dist -o coachlens.ehpk`. Set `VITE_API_URL` and the `network` whitelist in `app/app.json` to your API origin.

## Architecture

```
G2 glasses <-> BLE <-> Even app (iPhone) -- WebView: CoachLens (lens + phone UI)
                                              | HTTPS (whitelisted origin, bearer token)
                                              v
                              api/ (Hono on Vercel Fluid Compute)
              +----------------+----------------+-----------------+
         Neon Postgres     OpenAI STT      Anthropic Claude     Resend
         (Drizzle)     (gpt-4o-transcribe) (Haiku 5.5 router,   (email)
                                            Sonnet 5.5 writers)
            Vercel Cron: nightly planner + insights, monthly report cards
```

- **Lens:** Even Hub SDK 0.0.16 text containers, IMU (nod), `audioControl` (glasses mic). A pure reducer drives every screen; the per-second timer uses partial container updates.
- **Phone:** React and Vite inside the Even app WebView.
- **API:** Hono on Vercel Fluid Compute, Neon Postgres via Drizzle, Claude via the AI SDK, a daily AI budget cap (`AI_DAILY_CAP`) that fails soft.

| Path | What |
|---|---|
| `shared/` | Zod contracts, mode definitions, name matching |
| `api/` | Hono API, agents, insights detectors, Drizzle schema and migrations, evals |
| `app/` | Even Hub app: `lens/` (reducer + G2 renderers), `phone/` (React), `core/` (API client, outbox, audio) |

Internal package names keep the original `@matside/*` prefix. Design docs: [`docs/voice-design.md`](docs/voice-design.md), [`docs/originality.md`](docs/originality.md), and the amendments under `docs/superpowers/plans/`.

## Judging criteria

### Made for G2
*"Does the experience make thoughtful use of G2 and its place in the wearer's line of sight?"*
Every screen fits about three glanceable rows within the SDK's container limits. Gestures map to the coach's real needs: tap to talk, swipe for the drill deck, double-tap to end, nod to go dark. The IMU, the glasses mic and partial text updates are all in use. The line of sight carries only what helps right now: the drill, the clock, the next kid to coach, a 💡 returning student, or the answer to a question about the class (`Guard: Priya (3), Leo (2)`).

### Quiet by Design
*"Does the technology appear when it is useful and stay out of the way when it isn't?"*
The lens is dark until triggered. One gesture to talk. Insights wait for the lobby and the end-of-class summary; mid-class only high-urgency items show, and they never cover recording or the card. Emails default to Review.

### Originality
*"Does the idea open up a new moment or use case for Even Hub?"*
We scanned about 220 community apps plus Even's built-in features ([`docs/originality.md`](docs/originality.md)). None is for instructors. To our knowledge, CoachLens is the first Even Hub app for coaches and teachers. The partial overlaps (Even's QuickNote and Conversate, the Cue memory app, workout trackers) capture or coach the wearer; CoachLens turns a sentence about one student into agent actions for that student.

### Experience & Polish
*"Is it clear, natural, and easy to use?"*
Plain speech, no syntax. The transcript shows first, the agent card confirms, and double-tap undoes. Ask the class a question ("who is forgetting to keep their guard up?") and get an ANSWER card, with instant answers for counts. Lens text is clipped at word boundaries. Notes survive offline. Setup is a quiz that reads a photo of your roster.

### Execution
*"Can a judge put on G2 and experience the core idea right now?"*
Yes: the loaner is paired at the table, and the core loop (tap, speak, card) runs on real G2 hardware. 668 automated tests (shared, api, app) plus live router evals: 43/44 cases pass on the live model across the three modes.

## Policy and security

- **Billing is flags only.** No payments, no financial advice.
- **Outward emails respect per-agent autonomy** (default Review). Demo emails go to one owned inbox (`DEMO_EMAIL_OVERRIDE`), and all students are seeded fakes.
- **Injuries are logged as observations**, never diagnosed.
- **CORS is `*` on purpose.** The Even WebView sends a custom-scheme or null origin. Every `/v1/*` call needs a bearer token from pairing and no cookies are used.
- Secrets live only in Vercel environment variables. The app bundle holds no keys.

## Tests

668 automated tests, all passing with `npm test` at the repo root: 13 in shared, 279 in api, 376 in app.

## Research

Evidence and gaps are in [`docs/research.md`](docs/research.md). High-information feedback d=0.99 versus praise d=0.24 (Wisniewski, Zierer and Hattie 2020); weekly personalized teacher-to-parent messages cut course failure from 15.8% to 9.3% (Kraft and Rogers 2015); Lumilo (CMU, 2018) teacher glasses showing who needs attention improved learning.

## Credits

Built by Galen Jauss (who teaches kids martial arts) with Claude Code, for LA Hacks 2026. Thanks to the Even Realities team for platform guidance.
