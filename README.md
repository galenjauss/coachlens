# CoachLens

**Even Hub app name: CoachLens.** An Even Realities G2 app for instructors, built at LA Hacks 2026 (Even Realities track).

CoachLens is for the solo instructor in the middle of a class: martial arts, personal training or tutoring. Their hands are on pads or a whiteboard and their eyes are on 20 kids, so a phone is the wrong tool. The coach taps the temple and says what they saw in plain language. CoachLens ties that sentence to one student and turns it into follow-up for that student: a logged note, a parent email draft to review, a change to the next plan, a PR, an attendance mark. The lens shows a short confirmation.

It is **eyes-up, phone-free capture**, not hands-free. The coach taps the temple (or uses the R1 ring) to start and stop a note.

> "Technology should feel natural. Intelligence should be quiet. Attention should be respected." (Even Realities judging doc)

## Status (read first)

| Item | State on Oct 18, 2026 |
|---|---|
| Even Hub store | v0.1.0 was **submitted to Even Hub review** on Oct 17 at 11:57 PM PT. **No approval has been confirmed**, so it is not publicly available on the store. |
| Installed Beta on physical G2 | **The gate is still open.** We tested earlier QR/sideload builds on a real G2 during development. We have **not** completed the installed-Beta checks (5-minute lock, permission denial, system exit, Conversate relaunch). The procedure is in [`docs/beta-acceptance.md`](docs/beta-acceptance.md). |
| Live service (`coachlens-api.vercel.app`) | Runs the remediated code (all four batches; migrations 0013 to 0015 applied). It is a **demonstration deployment** that holds only **synthetic demo data** (1 instructor, 23 students, 4 classes), reseeded on Oct 18, with all outgoing mail redirected to one demo inbox. Instructors are isolated from each other, but use only synthetic or consented data. |
| Demo film | The film sequences real simulator renders at authored timings. It is not a latency measurement and not an uncut hardware recording. |
| Audit remediation | The fixes for the Oct 18 audit were verified locally and **deployed on Oct 18**: the API at `coachlens-api.vercel.app` and the phone app at `coachlens-phone.vercel.app`. The **Even Hub v0.1.0 build under review contains none of them** and still runs the old client; a v0.1.1 package (`app/coachlens-0.1.1.ehpk`) exists locally and has **not** been uploaded. A Beta install from the portal therefore still runs old client code. For developer-mode demos, the QR in `docs/screens/demo-qr-0.1.1.png` opens the remediated phone app. Nothing has been tested on G2 hardware since the fixes. |

These changes are live on the deployed API and phone app (not in the Even Hub v0.1.0 build):

- **Complete Undo.** Undo reverses notes, billing flags, attendance, metrics, rank, issues, drills and plan changes. It also cancels pending email drafts and deferred agent work. Sent email cannot be recalled, and the card says so.
- **Idempotent retries.** If a retried upload follows a lost response, the server returns the original result instead of saving the note a second time.
- **Failed-note retention.** A note that keeps failing stays on the phone with Retry and Discard controls instead of being dropped.
- **Multi-instructor isolation.** Every query is scoped to the signed-in instructor, and each instructor has their own pairing code. Codes are stored hashed (peppered with `PAIRING_PEPPER`).
- **Token expiry and Unpair.** Tokens expire after 90 days, and "Unpair this phone" revokes the token on the server. Uninstalling alone does not revoke the server token; use Unpair first. The phone also has "Sign out other phones".
- **Quiet display mode (the default).** During class, the idle display hides after 8 s, result cards dismiss after 6 s, and a tap always records.
- **Praise stays praise.** Each note keeps whether it is a concern, praise or improvement, and only current concerns count toward a recurring issue. Class questions follow the question's meaning ("who has excellent guard" lists praise).
- **Roll call anywhere.** "Everyone except Jake and Mia" works as an ordinary note too, and a sentence that changes nothing says "Nothing changed" with a hint.
- **Zero model calls for simple commands.** Roll call, "how many are here" and "who hasn't been noted yet" are handled before the model.
- **Insights are review prompts.** "Ready to test" became "review for next rank", which lists the evidence present and what is not tracked and drafts no email. A quiet issue now asks the coach to check it next class; an issue is marked resolved only after praise or improvement and an explicit accept. The mid-class "no observation yet" reminder is one class-level item instead of one per student.
- **Urgent notes get a factual email.** The subject names the observation, with no tips or progress filler, and Review lists urgent drafts first.
- **Status and degraded mode.** `GET /v1/status` reports Anthropic calls used and left today, whether speech-to-text is configured, and any degraded reasons. `OPENAI_API_KEY` is optional; without it transcription returns `503 stt_not_configured`.

## Who is this for?

Solo instructors who teach on their feet: a martial-arts coach with 20 kids on the mat, a personal trainer between sets, a tutor at a whiteboard. They give dozens of corrections per class and remember two by the time they get home.

## What moment is it designed for?

The live class. The coach notices something ("Priya's guard keeps dropping", "Dee rolled her ankle") at a moment when their attention belongs on the room. CoachLens lets them capture it without picking up a phone. It then handles the follow-up: the parent email, the report card, the next plan.

## Why does it belong on G2?

- The coach's eyes must stay on the students, and a phone on the mat is unsafe and breaks the flow.
- A temple tap, a short sentence and a glance at a confirmation fit a live class better than a phone does. We have not yet measured the end-to-end time on physical hardware; see [What we haven't measured](docs/research.md#what-we-havent-measured-yet).
- The G2 sits in the line of sight. A ★ insight ("Jake's back after 3 missed") or the next kid who needs feedback can appear without the coach looking away from the room.
- On iPhone, the Even app keeps the WebView running while the phone is locked, so the phone can stay in a bag. We have not yet verified this on the installed Beta (Step 3 of the acceptance procedure).

## Can the judge try it right now?

Yes, on the team's loaner G2, which the team pairs at the table. The installed-Beta checks are still open (see Status), so the table demo runs the current Beta build with the limits listed above. See [Install and run](#install-and-run).

## What it does with one sentence

CoachLens is more than a note-taker. Each note is tied to a student and drives follow-up that the coach can see and review.

- An urgent note ("Dee rolled her ankle and sat out the last drill") becomes a parent email draft, held for review by default.
- A recurring issue (the same skill tag 3+ times in 30 days) goes into the monthly report card and the next class plan.
- A metric ("Maria hit 225 on deadlift") becomes a PR on her profile.
- A question ("how's Priya doing?") returns a profile brief on the lens.
- A class question ("who is forgetting to keep their guard up?") returns an ANSWER card built from the class's notes, for example `Guard: Priya (3), Leo (2)`. See [Class questions](#class-questions).
- A roll call ("everyone except Jake and Mia") marks attendance, which feeds the insights agent. It also works as an ordinary note.

## The lens flow

| Screen | Tap | Double-tap | Swipe | Other |
|---|---|---|---|---|
| **Home** (class list) | Enter that class's lobby | Even's exit dialog | Cycle classes | Nod: lens dark/on |
| **Lobby** (plan, top insight) | Start class | Planning listen | Back to home | Nod: lens dark/on |
| **Planning listen** | Stop and apply | Cancel | | 3 min cap |
| **Plan result** (diff summary) | OK | Undo | Back to lobby | |
| **In class** | Start or stop a note | End class | Drill deck | Long-press: hold to talk; nod: lens dark/on |

- **Planning listen.** In the lobby, the coach double-taps and talks the plan through with their assistant instructor. The planner agent reshapes the drills, and the lens shows a diff summary (`+ Partner sparring 6m`, `- Kata 2`, `~ Warm-up 10→5m`). Double-tap undoes it.
- **Agent card.** After the coach speaks, the card shows what they said and live agent progress, for example `√ Maria · deadlift 225 lb (PR +10)`. For a question, it shows the student's brief instead: rank and time in rank, attendance dots (`●●○●●●`), last notes and latest metric.
- **Voice roll call.** "Everyone except Jake and Mia" or "Present: Priya, Leo, Maya".
- **End-of-class summary.** Minutes, drills, note coverage and who has no note yet, agent actions, items to review, and the top insight. A tap puts the students without notes first in the next class. Note coverage counts recorded notes. It is a proxy and does not prove that feedback was given.

## Class questions

The coach can tap and ask the lens about the whole class, not just one student. The answer appears as an ANSWER card:

- "Who is forgetting to keep their guard up?" shows `Guard: Priya (3), Leo (2)`. The answer follows the question's meaning: concerns for a problem question, praise for "who has excellent guard?".
- "Who hasn't been noted yet?" lists the students with no notes so far.
- "How many are here?" is answered from attendance by deterministic code. Roll call, counts and coverage questions make **zero** model calls.
- "What should I focus on next drill?" uses the fast model, grounded only in this class's data. When there are too few notes, it says "Not enough notes yet" instead of guessing.

## Opportunistic insights agent

Agents also act without being asked. Deterministic detectors (no LLM) run when a session ends, when attendance changes and nightly. An insight check runs right after roll call, so a returning-student banner can appear shortly afterwards:

| Detector | Fires when | One-tap action |
|---|---|---|
| Attendance decline | Absent in 2 of the last 3 sessions, or attendance halved | Draft email |
| Returning student | Present today after 2+ consecutive absences | Shown mid-class: `★ Jake's back after 3 missed` |
| No notes | Present 3 sessions running with no notes | Put first next class |
| Review for next rank | Martial arts: 90+ days in rank and no open issues (thresholds configurable per school) | Shows the evidence present and what is not tracked (curriculum, your assessment); no email. |
| New PR | Personal training: a PR in the last 7 days | Draft praise email |
| Grade drop | Tutoring: latest test 10+ points below the previous one | Draft email |
| Issue quiet | No new notes on an open issue for 21 days | "Check next class". No notes is not evidence of improvement, so the issue stays open. |
| Issue improving | Praise or improvement noted since the issue opened | "Mark resolved", only on the coach's explicit accept. |
| Repeated billing | 2+ open billing flags for one student | Draft email |

**Display policy.** Insights appear in the lobby and the end-of-class summary. Mid-class, only high-urgency items appear, such as a returning student or a kid who still has no note late in class. They show as a ★ banner, in the style of Even's Conversate AI insights. Quiet mode is the default: the idle display hides after 8 s, cards dismiss after 6 s, and a tap always records, even over a banner (see Status). Standard mode keeps them on screen.

## Agents and autonomy

- **Router** (Claude Haiku 5.5) turns a transcript into typed intents and resolves names, including learned aliases ("Mya" resolves to Maya).
- **Progress** records notes with skill tags and spots recurring issues.
- **Parent / client email** (Claude Sonnet 5.5) drafts emails for urgent notes, explicit requests and accepted insights.
- **Report cards** (Sonnet) are monthly and grounded in quoted coach notes.
- **Planner** (Sonnet) handles nightly drafts, voice plan edits and note-driven adjustments.
- **Attendance**, **billing flags** (notes only, no payments), **metrics and briefs** (deterministic) and **insights** (deterministic) complete the set. Several of these "agents" are rules and service functions rather than model calls.

Every agent has an **Auto / Review / Off** setting on the phone. Emails default to Review: nothing outward-facing is sent without the coach unless they choose Auto. The Agents tab logs each run, and a "Tell this agent..." box steers an agent ("warmer, shorter").

**Plans with or without AI.** The coach can repeat the last class, copy another class's plan, start blank, let the AI draft one, or edit by hand (add, rename, set minutes, reorder, add cues).

**Custom vocabulary.** "Words CoachLens should know" (technique names, drill names) are sent to speech-to-text along with the roster names.

## Responsiveness and offline

- **Transcript first.** What the coach said appears on the lens before the agents finish.
- **Dual-mic start.** The glasses and phone mics open together. CoachLens uses the glasses audio when it delivers enough audio, and otherwise the phone's.
- **Keep-warm.** The API is pinged during a session to avoid cold starts mid-class.
- **Offline queue.** Notes are saved on the phone first, including the audio, which is held temporarily, and sync later. The lens shows `↑ 2 queued`, and the phone offers Retry now. Retries are idempotent, so a lost response does not duplicate a note.

We have not measured end-to-end latency on physical G2. Small audit probes measured roughly 1–3 s for the server step on text and about 1.6 s for one clean speech-to-text call. These are not end-to-end numbers.

## Three modes and onboarding

| Mode | People | Plan | Metrics | Messages go to |
|---|---|---|---|---|
| Martial arts | students | drill deck | rank, time in rank | parent |
| Personal training | clients | session plan | lift PRs | the client |
| Tutoring | students | lesson plan | test grades | parent |

Personal-training output never contains medical, injury or nutrition advice, and tutoring output never guarantees grades. Setup is an AI onboarding quiz. It reads pasted text, CSV or photos of rosters, schedules and curriculum into editable tables that the coach confirms.

## Install and run

### On the judges' loaner

The team pairs it at judging. Put it on, launch CoachLens from the glasses home, tap a class, tap to start, and talk.

### On your own G2 (Beta)

1. Send the team your Even account email so we can add you to the CoachLens Beta group.
2. In the Even Realities app on your iPhone, go to **Me → Beta tester → CoachLens → Install**.
3. Open CoachLens on the phone and enter the pairing code the team gives you in person.
4. Launch CoachLens from the glasses home and tap.

Testers need no API keys. The live service is the single-coach demo deployment with synthetic data, so every tester sees the same demo instructor. iPhone is the supported device; on Android the WebView may pause when the phone locks. The installed-Beta checks are tracked in [`docs/beta-acceptance.md`](docs/beta-acceptance.md).

**Dev test URL:** https://coachlens-phone.vercel.app. With Even developer mode on, scan its QR code from the Even app.

### Run it locally (tested Oct 18, 2026 on macOS with Node 24.11)

You need:
- **Node 22.9 or newer.** The API dev script uses `--env-file-if-exists`.
- npm.
- A **Neon** Postgres database. The API uses the Neon HTTP driver, so a plain local Postgres will not work without a Neon proxy.
- Keys for Anthropic, OpenAI and Resend, for real model, speech and mail calls.

```bash
npm ci                                   # install all workspaces from the lockfile
cp api/.env.example api/.env.local       # fill in values; never commit this file
```

`npm run dev -w api` loads `api/.env.local` automatically. It refuses to start until the required variables below are set, and names the first missing one (for example `Error: missing env DATABASE_URL`).

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | Neon connection string |
| `ANTHROPIC_API_KEY` | yes | router and writers |
| `OPENAI_API_KEY` | optional | speech-to-text; without it the API starts, `/v1/transcribe` returns `503 stt_not_configured`, and `/v1/status` reports speech-to-text as unconfigured |
| `RESEND_API_KEY` | yes | email |
| `MAIL_FROM` | yes (the example file has a default) | sender address |
| `PAIRING_CODE` | yes, at least 6 characters | the demo instructor's pairing code |
| `CRON_SECRET` | yes | protects the cron routes |
| `ALLOWED_ORIGINS` | yes (default `*`) | CORS origins |
| `DEMO_EMAIL_OVERRIDE` | strongly recommended | sends every email to one inbox you own |
| `AI_DAILY_CAP` | optional (default 400) | see [Budget and degraded mode](#budget-and-degraded-mode) |
| `SEED_GUARDIAN_EMAILS` | for seeding | inboxes you own, comma-separated |

Then, from the repo root:

```bash
# 1. Database schema and synthetic demo data (needs a real DATABASE_URL).
#    The seed WIPES all data first. These two commands do not read
#    .env.local on their own, so load it into the shell first:
set -a; . api/.env.local; set +a
npm run db:migrate -w api
npm run seed -w api

# 2. Run (separate terminals)
npm run dev -w api                                        # API on :8787 (GET /health returns {"ok":true})
npm run dev -w app                                        # Even Hub app on :5173
cd app && npx evenhub-simulator http://localhost:5173     # G2 simulator

# 3. Tests and types
npm test                                                  # all workspaces
npm run typecheck
```

What we checked on Oct 18, without real secrets:
- `npm ci` succeeds.
- `npm run dev -w api` with no `.env.local` prints `.env.local not found` and exits with `missing env DATABASE_URL`.
- With a partial file, it names the next missing key.
- With every required key set to a placeholder, it starts, and `GET /health` returns `{"ok":true}`.
- `npm run dev -w app` serves on port 5173.
- `npm run seed -w api` with no environment exits with a message asking for `DATABASE_URL` and `SEED_GUARDIAN_EMAILS`.
- With every required key set to a placeholder and no `OPENAI_API_KEY`, it still starts and warns that speech-to-text is disabled.
- The tests pass in each workspace (13 shared, 317 api, 395 app on this branch after merging batch 1). On a heavily loaded machine some API tests can hit the 20 s timeout; run `npx vitest run --maxWorkers=2` in `api/`.

We did not run migrations, seeding or model calls in this check, because they need real credentials.

The app talks to `http://localhost:8787` in dev and to the production API in a build. Set `VITE_API_URL` to override this. To run on real glasses over the LAN, use `cd app && npx evenhub qr --url http://<your-lan-ip>:5173`. To package for the Even Hub portal, run `cd app && npm run build && npx evenhub pack app.json dist -o coachlens.ehpk`, and set the `network` whitelist in `app/app.json` to your API origin.

**Multi-instructor isolation is deployed.** Every query is scoped to the signed-in instructor, and each instructor has their own pairing code. The live service still holds only synthetic demo data, so use only synthetic or consented data. For multi-coach use, also set `AI_INSTRUCTOR_DAILY_CAP`; unset, it equals the global cap and gives no per-coach fairness.

## Budget and degraded mode

`AI_DAILY_CAP` (default 400 per America/Los_Angeles day) counts **Anthropic model calls only**, including failed ones. It does **not** cap tokens, OpenAI speech-to-text, email, database or hosting costs, so it is not a complete spending cap; set limits with each provider as well.

When the cap is reached, the service runs in **degraded mode**. Model-backed agents fail soft with "Daily AI budget reached". Transcripts that the router cannot sort are still saved as unsorted notes for review, and deterministic features (briefs, metrics, insights) keep working. Roll call, attendance counts and coverage questions ("who hasn't been noted yet") make zero model calls, so they keep working past the cap and do not use it up; tag questions still use one routing call.

`GET /v1/status` reports Anthropic calls used and left today against the cap (failed calls included), whether speech-to-text is configured, and a list of degraded reasons (`ai_budget_reached`, `speech_to_text_unconfigured`).

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

- **Lens:** Even Hub SDK 0.0.16 text containers, IMU (nod) and `audioControl` (glasses mic). A pure reducer drives every screen, and the per-second timer uses partial container updates.
- **Phone:** React and Vite inside the Even app WebView.
- **API:** Hono on Vercel Fluid Compute, Neon Postgres via Drizzle, Claude via the AI SDK, and a daily model-call cap that fails soft.

| Path | What |
|---|---|
| `shared/` | Zod contracts, mode definitions, name matching |
| `api/` | Hono API, agents, insights detectors, Drizzle schema and migrations, evals |
| `app/` | Even Hub app: `lens/` (reducer + G2 renderers), `phone/` (React), `core/` (API client, outbox, audio) |

Internal package names keep the original `@matside/*` prefix. Design docs: [`docs/voice-design.md`](docs/voice-design.md), [`docs/originality.md`](docs/originality.md), and the amendments under `docs/superpowers/plans/`.

## Judging criteria

### Made for G2
*"Does the experience make thoughtful use of G2 and its place in the wearer's line of sight?"*
Every screen fits about three glanceable rows within the SDK's container limits. Gestures map to what the coach needs: tap to start and stop a note, swipe for the drill deck, double-tap to end, nod to go dark. CoachLens uses the IMU, the glasses mic and partial text updates. The line of sight carries the drill, the clock, the next kid to coach, a ★ returning student, or the answer to a question about the class.

### Quiet by Design
*"Does the technology appear when it is useful and stay out of the way when it isn't?"*
Insights wait for the lobby and the end-of-class summary, and mid-class only high-urgency items appear. Emails default to Review. Quiet mode is the default on the deployed phone app: the idle display hides after 8 s and cards dismiss after 6 s. The Even Hub v0.1.0 build under review still keeps the drill, timer and cards on screen until dismissed.

### Originality
*"Does the idea open up a new moment or use case for Even Hub?"*
We claim a specific combination: observations that the teacher speaks during a live class on G2, each linked to a student, driving the instructor's follow-up. We build on prior art. Lumilo (CMU, 2018) showed teachers per-student status in mixed-reality glasses, and Even's QuickNote and Conversate already cover spoken capture and in-lens context. In our non-exhaustive survey of about 220 community G2 projects, we found none built for instructors that links spoken observations to individual students. We could not enumerate the official store. Details: [`docs/originality.md`](docs/originality.md).

### Experience & Polish
*"Is it clear, natural, and easy to use?"*
Plain speech, no syntax. The transcript shows first, the agent card confirms, and double-tap undoes. Undo is complete on the deployed service and phone app; the Even Hub v0.1.0 client predates the fix and is not verified against it. The coach can ask the class a question and get an ANSWER card. Lens text is clipped at word boundaries. Setup is a quiz that reads a photo of the roster.

### Execution
*"Can a judge put on G2 and experience the core idea right now?"*
Yes, on the loaner, which is paired at the table. We ran development builds on a real G2 during the hackathon. The installed-Beta acceptance run is still open ([`docs/beta-acceptance.md`](docs/beta-acceptance.md)). The Oct 18 audit ran the suite at 687 passing tests (13 shared, 279 api, 395 app); with the remediation merged so far, this branch passes 725 (13, 317, 395). In an earlier run, 43 of 44 router eval cases passed on the live model; we have not rerun it since.

## Policy and security

- **Billing is flags only.** No payments, no financial advice.
- **Outward emails respect per-agent autonomy** (default Review). Demo emails go to one owned inbox (`DEMO_EMAIL_OVERRIDE`).
- **Synthetic data.** Every student, parent and class in the demo is a seeded fake.
- **Injuries are logged as observations**, never diagnosed.
- **CORS is `*` on purpose.** The Even WebView sends a custom-scheme or null origin. Every `/v1/*` call needs a bearer token from pairing, and no cookies are used.
- **Pairing** uses per-instructor codes stored hashed, tokens expire after 90 days, and Unpair revokes the server token. Uninstalling alone does not revoke it. This is deployed; the Even Hub v0.1.0 build under review has no Unpair control. See [`docs/privacy.md`](docs/privacy.md).
- Secrets live only in Vercel environment variables. The app bundle holds no keys.

## Research

The research in [`docs/research.md`](docs/research.md) motivates the problem; it does not measure CoachLens. High-information feedback has an effect size of d=0.99, versus d=0.24 for praise (Wisniewski, Zierer and Hattie 2020). Weekly personalized teacher-to-parent messages cut course failure from 15.8% to 9.3% (Kraft and Rogers 2015). CoachLens has not been piloted. The file lists what we haven't measured yet and a pilot plan.

## Credits

Built by Galen Jauss (who teaches kids martial arts) with Claude Code, for LA Hacks 2026. Thanks to the Even Realities team for platform guidance.
