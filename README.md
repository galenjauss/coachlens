# CoachLens

**Prep Notes for the dojo.** An Even Hub app for the Even Realities G2 smart glasses, built at LA Hacks 2026 (Even Realities track).

CoachLens is for the solo instructor in the middle of a class: martial arts, personal training or tutoring. Hands are on pads or a whiteboard and eyes are on the kids, so a phone is the wrong tool. Tap the temple, say what you saw in plain language, and a team of AI agents does the paperwork while you keep teaching. The lens shows one glance of confirmation, then gets out of the way.

## The hero loop

1. **Tap** the glasses and **speak naturally**: "Priya, guard drops on the jab again, great energy though." No code words and no grammar. The lens shows `● LISTENING 0:04` (the dot pulses), and after you tap again, `heard > SENDING > thinking···` while the note goes out.
2. **Agents act.** A router (Claude Haiku) splits the sentence into intents. Specialists (Claude Sonnet writers plus plain code) log progress, mark attendance, flag billing, update the next plan, and draft a parent or client email only when it is urgent or you ask.
3. **One-glance card.** It stays until you tap it away. Left: the full transcript of what you said (swipe to page through it). Right: a compact agent progress line (`✓ sorted`, `✓ logged`, `… email`, `✓ plan`). Double-tap undoes it.
4. **Between glances the lens stays quiet.** The persistent peek view stays on during class: drill, a per-second countdown, and the next student who needs feedback. A **nod** (calibrated on the x-axis) toggles it dark or visible on any idle screen, and a tap in the dark wakes it (it never starts recording).
5. **Wrap-up.** Double-tap to end class. The lens shows `Missed: ...` and `Tap = coach them first next class · 2x = done`. Tapping saves the missed students so they go first next class.

Other lens details: swipe on the lens home to choose the class (`COACHLENS (2/3)`); the deck opens a drill detail (full name and every cue, swipe to page) and a tap starts the drill; if the glasses send no audio, CoachLens falls back to the phone microphone (`● LISTENING (phone)`). Lens text is wrapped and clipped at word boundaries, never mid-word.

The lens also nudges the instructor toward feedback coverage ("Feedback 3/12, next: Priya"), because specific feedback is what moves outcomes (see research).

## Teaching modes

One engine, three flavors, each with its own skill tags, vocabulary and guardrails:

| Mode | People | Plan | Messages go to |
|---|---|---|---|
| Martial arts | students | drill deck | parent |
| Personal training | clients | session plan | the client |
| Tutoring | students | lesson plan | parent |

Personal-training output never contains medical, injury or nutrition advice. Tutoring never guarantees grades.

## Agents

- **Progress**: logs a feedback note per student with skill tags. Spots recurring issues (same tag 3 or more times in 30 days) and adds them to the next plan and the monthly report card. Recurring issues do **not** email parents on their own.
- **Parent / client email**: drafted only when a note is **urgent** (injury, behavior or safety, as judged by the router; for example "Dee rolled her ankle and sat out the last drill") or you **explicitly ask for it**. Routine and recurring issues roll into the **monthly report card** instead. Every email waits in Review for your approval.
- **Report cards**: monthly job (and "Run now") that writes strengths, working-on, quoted coach notes and a next goal.
- **Billing flags**: flags and notes with an urgency level only. There are no payment calls anywhere in the codebase.
- **Planner**: drafts the next deck or lesson plan nightly, and turns "more structure", "shorter" or "low energy day" into a reviewable diff. Output is validated leniently with word-boundary length limits (names up to 80 characters, cues 90), so a long name is clipped cleanly instead of failing. If the AI is unavailable, a **starter plan** is used and visibly flagged, and it **self-heals**: the next load re-drafts it in the background (10-minute cooldown).
- **Attendance**: "Everyone except Jake and Mia" or "Present: A, B, C" (the `present:` roll call). A feedback note also marks that student present.
- **Name aliases**: when you reassign a note to a student, the misheard spelling is learned as an alias, so "Mya" resolves to Maya next time.

The phone app (inside the Even app) has an **Agents** tab. It opens on topic tiles (emails, progress, billing, plan, attendance, report cards). Each tile leads to color-coded runs, then a run detail with a **"Tell this agent..."** box to steer it: redraft an email ("warmer, shorter"), reassign a note, add a billing note.

## Onboarding quiz

First run on the phone is a six-step AI-assisted quiz: coaching type, business basics, classes and schedule, roster, curriculum, then review and commit. Each step accepts pasted text, a CSV/text file or a photo (a schedule, a sign-in sheet) and extracts it with AI into editable tables. Review and fix the tables, then commit; re-running a commit does not duplicate anything. Photos are only sent when you tap **Read with AI**.

## Architecture

```
G2 glasses <-> BLE <-> Even app (iPhone) -- WebView: CoachLens (lens + phone UI)
                                              | HTTPS (whitelisted origin, bearer token)
                                              v
                                api/ (Hono on Vercel Functions)
              +----------------+----------------+-----------------+
         Neon Postgres     OpenAI STT      Anthropic Claude     Resend
         (Drizzle)     (voice -> text)  (Haiku router,        (email)
                                         Sonnet writers)
                  Vercel Cron: nightly planner, monthly report cards
```

Monorepo (npm workspaces; internal package names keep the original `@matside/*` prefix):

| Path | What |
|---|---|
| `shared/` | Zod schemas, mode definitions, name matching |
| `api/` | Hono API, agents, Drizzle schema and migrations, live evals |
| `app/` | Vite + TypeScript Even Hub app: `lens/` (pure reducer + G2 renderers), `phone/` (React UI), `core/` (API client, outbox, audio) |

Design docs: [`docs/superpowers/specs/2026-10-17-matside-design.md`](docs/superpowers/specs/2026-10-17-matside-design.md), [`docs/voice-design.md`](docs/voice-design.md), and the amendments under `docs/superpowers/plans/`.

## Cost controls

- A **daily AI call cap** (`AI_DAILY_CAP`, default 400 per America/Los_Angeles day). Over the cap, agents fail soft with "Daily AI budget reached" and nothing else breaks.
- A fast, cheap model routes (Haiku). The larger model only writes emails, report cards and plans.
- Provider spend limits are set in the Anthropic and OpenAI consoles.

## Install and run on the G2

Testers need **no API keys**.

1. **Join the Beta.** Send the team your Even account email. We add you to the CoachLens Beta group in the Even Hub developer portal. (Or use the loaner glasses and phone at the table.)
2. **Install.** In the Even Realities app on your iPhone: **Me -> Beta tester -> CoachLens -> Install**.
3. **Pair.** Open CoachLens on the phone and enter the pairing code `<pairing code from the team>`.
4. **Wear the G2 and tap.** Launch CoachLens from the glasses home, tap to start class, and talk.

iPhone is the supported device. On Android the WebView may be suspended when the phone locks.

## Local development

Requires Node 20+ and a Neon (or any Postgres) database.

```bash
npm install
cp api/.env.example api/.env.local   # then fill in the values (never commit this file)
```

Variables in `api/.env.example`: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `MODEL_FAST`, `MODEL_SMART`, `AI_DAILY_CAP`, `OPENAI_API_KEY`, `STT_MODEL`, `RESEND_API_KEY`, `MAIL_FROM`, `PAIRING_CODE`, `CRON_SECRET`, `ALLOWED_ORIGINS`, `DEMO_EMAIL_OVERRIDE`, `INSTRUCTOR_NAME`, `TZ_NAME`, `SEED_GUARDIAN_EMAILS`.

```bash
npm run dev -w api                    # API
npm run dev -w app                    # Even Hub app on :5173
cd app && npx evenhub-simulator http://localhost:5173   # G2 simulator
npm test                              # all workspaces (shared, api, app)
```

To try on real glasses over the network: `cd app && npx evenhub qr --url http://<your-lan-ip>:5173` and scan it from the Even app.

Package for the Even Hub portal:

```bash
cd app && npm run build && npx evenhub pack app.json dist -o coachlens.ehpk
```

Set `VITE_API_URL` (see `app/.env.example`) and the `network` whitelist in `app/app.json` to your API origin.

## Policy and security notes

- **Billing is flags only.** No payments, no financial advice.
- **Parent and client emails need approval.** Nothing outward-facing sends without a tap in Review.
- **Demo emails go to a single owned inbox** (`DEMO_EMAIL_OVERRIDE`), and the data is seeded fake students.
- **Injuries are logged as observations**, never diagnosed.
- **CORS is `*` on purpose.** The Even WebView sends a custom-scheme or null origin that cannot be allow-listed. Every `/v1/*` call needs a bearer token from pairing and no cookies are used, so there is no ambient credential for another origin to ride.
- Secrets live only in Vercel environment variables. The app bundle holds no keys.

## Status (hardware-tested on a real G2)

Working on glasses: the per-second timer (partial text updates), the agent card with transcript and progress, one-gesture talk with a phone-microphone fallback when the glasses send no audio, the nod toggle calibrated on the x-axis (rest about -0.11, nod about -0.55; threshold about -0.22), and phone-screen scrolling in the iOS WebView (a nested scroller in the class picker was the cause of the earlier scroll bug; verified in a desktop browser, so confirm on the iPhone).

Known limits: the nod toggle is experimental, the `✓` glyph may not render in the lens font on every firmware (falls back to `●`), and card text width was tuned by eye. Lens card text may need narrowing (`SAID_COLS` in the lens config) on other firmware.

Tests: 400 across shared (12), api (140) and app (248), plus live eval suites for the agents (martial arts 15/15, personal training 5/5, tutoring 5/5).

## Research

Evidence and gaps are in [`docs/research.md`](docs/research.md). Highlights:

- High-information feedback d=0.99 versus praise d=0.24 (Wisniewski, Zierer and Hattie 2020 meta-analysis).
- Weekly personalized teacher-to-parent messages cut course failure from 15.8% to 9.3% (Kraft and Rogers 2015, randomized trial).
- About 1 in 5 new gym members quit within 90 days; automated follow-up converts 85% versus 71% manual (Gymdesk 2026 benchmark, 4.6k gyms).
- Lumilo (CMU, 2018): teacher glasses showing who needs attention improved learning.

## Credits

Built by Galen Jauss (who teaches kids martial arts) with Claude Code, for LA Hacks 2026. Thanks to the Even Realities team for platform guidance. Built on the Even Hub SDK, Hono, Drizzle, Neon, Vercel, Anthropic Claude, OpenAI transcription and Resend.
