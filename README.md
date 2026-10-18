# CoachLens

**Prep Notes for the dojo.** An Even Hub app for the Even Realities G2 smart glasses, built at LA Hacks 2026 (Even Realities track).

CoachLens is for the solo instructor in the middle of a class: martial arts, personal training or tutoring. Hands are on pads or a whiteboard and eyes are on the kids, so a phone is the wrong tool. Tap the temple, say what you saw in plain language, and a team of AI agents does the paperwork while you keep teaching. The lens shows one glance of confirmation, then gets out of the way.

## The hero loop

1. **Tap** the glasses and **speak naturally**: "Priya, guard drops on the jab again, great energy though." No code words and no grammar.
2. **Agents act.** A router (Claude Haiku) splits the sentence into intents. Specialists (Claude Sonnet writers plus plain code) log progress, mark attendance, flag billing, update the next plan, and draft a parent or client email when it is warranted.
3. **One-glance card.** Left column: what you said. Right column: live agent progress (`✓ sorted`, `✓ logged`, `… email`, `✓ plan`). Double-tap undoes it.
4. **Between glances the lens stays quiet.** A persistent peek view shows the drill, time left and the next student who needs feedback. A nod toggles it dark or back (experimental), and a tap wakes it.

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

- **Progress**: logs a feedback note per student with skill tags. Spots recurring issues (same tag 3 or more times in 30 days) and adds them to the next plan and the monthly report card.
- **Parent / client email**: drafted only when the note is **urgent** or you **ask for it**. Otherwise at most one auto-draft per student per 30 days. Every email waits in Review for your approval.
- **Report cards**: monthly job (and "Run now") that writes strengths, working-on, quoted coach notes and a next goal.
- **Billing flags**: neutral flags and notes with an urgency level. There are no payment calls anywhere in the codebase.
- **Planner**: drafts the next deck or lesson plan nightly, and turns "more structure", "shorter" or "low energy day" into a reviewable diff.
- **Attendance**: "Everyone except Jake and Mia" or "Present: A, B, C". A feedback note also marks that student present.

The phone app (inside the Even app) has an **Agents** grid of task tiles colored by urgency. Open one, then use the "Tell this agent..." box to steer it: redraft an email, reassign a note, add a billing note.

## Onboarding quiz

First run on the phone is a six-step quiz: coaching type, business basics, classes and schedule, roster, curriculum, then review and confirm. Each step accepts pasted text, a CSV or a photo (a schedule, a sign-in sheet) and extracts it with AI into editable tables. Photos are only sent when you tap **Read with AI**.

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

Working on glasses: the per-second timer (partial text updates), the two-column agent card, one-gesture talk with a phone-microphone fallback when the glasses send no audio, the nod toggle calibrated to the pitch axis (x, rest about -0.11, nod about -0.55; threshold about -0.22), and phone-screen scrolling in the iOS WebView.

Known limits: the nod toggle is experimental, the `✓` glyph may not render in the lens font on every firmware (falls back to `●`), and card text width was tuned by eye. Lens card text may need narrowing (`SAID_COLS` in the lens config) on other firmware.

Tests: 345 across shared (12), api (117) and app (216), plus live eval suites for the agents (martial arts 15/15, personal training 5/5, tutoring 5/5).

## Research

Evidence and gaps are in [`docs/research.md`](docs/research.md). Highlights:

- High-information feedback d=0.99 versus praise d=0.24 (Wisniewski, Zierer and Hattie 2020 meta-analysis).
- Weekly personalized teacher-to-parent messages cut course failure from 15.8% to 9.3% (Kraft and Rogers 2015, randomized trial).
- About 1 in 5 new gym members quit within 90 days; automated follow-up converts 85% versus 71% manual (Gymdesk 2026 benchmark, 4.6k gyms).
- Lumilo (CMU, 2018): teacher glasses showing who needs attention improved learning.

## Credits

Built by Galen Jauss (who teaches kids martial arts) with Claude Code, for LA Hacks 2026. Thanks to the Even Realities team for platform guidance. Built on the Even Hub SDK, Hono, Drizzle, Neon, Vercel, Anthropic Claude, OpenAI transcription and Resend.
