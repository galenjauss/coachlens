# MatSide: design spec

- **Date:** 2026-10-17
- **Event:** LA Hacks 2026, Even Realities track
- **Deadline:** Sun 2026-10-18 12:00 PM (Devpost + Even Hub Beta)
- **Builders:** Galen (solo) + Claude. G2 in hand, demo on iPhone.
- **Research:** [docs/research.md](../../research.md)

## 1. Product

**One line.** An instructor who owns a martial arts school and teaches kids' classes alone speaks to their G2 mid-class. Each utterance starts autonomous AI agent workflows that track progress, draft parent emails, write report cards, flag billing issues and plan the next class. The lens runs an improvisation-friendly drill deck and makes sure every kid gets specific feedback.

**Pitch:** "Prep Notes for the dojo. Teach the class; MatSide runs the business."

**Hero (what judges must remember):** the feedback-coverage loop powered by agents.
1. The lens nudges the instructor to give every student specific feedback ("Feedback 3/12 · Next: Priya").
2. One spoken sentence starts several agents.
3. Parents get specific, drill-grounded updates.

**Target user:**
- Owner-operator, often teaching alone, mostly kids' classes.
- Parents pay and want progress updates.
- Plans from a fixed forms cycle plus weekly themes (hand / leg / stance…), but mostly improvises.

**Why G2:**
- Hands are busy and eyes need to be on kids; a phone on the mat is unsafe and breaks flow.
- 2-second glances, voice capture, and temple taps fit the setting.

**Evidence (details in research.md):**
- High-information feedback d=0.99 vs praise d=0.24 (Wisniewski et al. 2020).
- Personalized teacher→parent messages: −41% course failure (Kraft & Rogers 2015, randomized trial).
- About 1 in 5 members quit within 90 days. Automated follow-up converts 85% vs 71% manual (Gymdesk 2026, 4.6k gyms).
- Lumilo: AR "who needs attention" glasses improved learning.
- Incumbents (Kicksite, Zen Planner, Spark, Gymdesk, Mindbody) are after-class dashboards. No in-class, hands-free capture found. No coaching or teaching app found on Even Hub.

**Gaps to state openly:**
- Share of schools run by a solo instructor is unknown.
- No martial-arts-specific proof that report cards improve retention.
- "Invisible middle" is a hypothesis.

## 2. Scope

**Must work end to end:**
- Voice attendance.
- Drill-deck runner with timers.
- Push-to-talk notes → Router → progress / attendance / billing / parent-email / planner agents.
- Live feedback coverage + "next student" suggestion.
- Agent card on the lens.
- Wrap-up with the missed list.
- Phone app: Today, Deck editor (edit + suggest → diff), Review (approve emails, handle billing flags), Agents feed, Students (timeline + report card).
- Monthly report card job (+ "Run now").
- Real email delivery.

**Out of scope:**
- Payment processing (billing is flags and notes only).
- Animations.
- Live-streaming speech-to-text.
- Multi-instructor or multi-school.
- Parent-facing app.
- Android-specific background hardening.
- Public store release (Beta only).
- Any separate web dashboard: all user-facing UI lives in the Even app.

**Policy guardrails:**
- No financial advice and no payments.
- Injury mentions are logged as observations only, never diagnosis.
- Parent-facing messages always wait for instructor approval.
- Data about minors is minimized; the demo uses seeded fake students.

**Autonomy tiers:**
- *Internal* actions run automatically: logging, tagging, attendance, issues, billing flags, next-deck edits.
- *Outward-facing* actions wait in Review: parent emails, report cards. They are approved one at a time or with "Approve all".

## 3. Lens experience (576×288, monochrome green, one font)

**Design rules:**
- Readable in about 2 s.
- At most 4 text rows of primary content.
- Hierarchy comes from position, borders and glyphs (`>` cursor, `━─` progress, `●○` meter). Font size can't change.
- At most 8 non-image containers per page, exactly 1 capturing input.
- If `✓` isn't in the firmware font, fall back to `●`.

**Gestures:**

| Gesture | Action |
|---|---|
| tap | primary action |
| swipe ▲▼ | browse |
| long-press | talk shortcut (never the only path, because the OS can claim tap-then-hold) |
| double-tap | back / cancel / end class |
| double-tap on the root (home) page | `shutDownPageContainer(1)` → exit dialog |

**Screens (approved mockups: layout A for the drill card):**

| Screen | Content | Gestures |
|---|---|---|
| **Home / first run** | Next class, "Tap to start". First run shows setup instructions on the glasses; never a black screen. | tap = start · 2× = exit dialog |
| **Attendance** | "Say who's absent: 'Everyone except Jake and Mia'" · `● Listening…` | tap = stop & send |
| **Attendance confirmed** | `12 present / absent: Jake, Mia` + deck preview (drill count, minutes, focus) | tap = first drill |
| **Drill card (main)** | Top row: `THEME · Class` and `Feedback n/N`. Box: drill name + timer, `━─` progress, `cue: …`. Below: `> Next feedback: Priya (guard)`. Bottom: gesture hint. | tap = talk · swipe = deck · 2× = "End class? tap to confirm" (any other input cancels) |
| **Deck browser** | List container (≤20 items, ≤64 chars each): `> Guard-up jab drill · 6m (4 kids)` | tap = run drill · swipe = browse · 2× = back |
| **Recording** | Timer row stays at top. Box: `● REC 0:04`, then the transcript once it returns. | tap = send · 2× = cancel |
| **Agent card** | `✓ Priya · guard (3rd time)` / `→ progress logged` / `→ parent note drafted` / `→ added to next deck`, then the coverage count. Closes itself after 4 s. | 2× = undo |
| **Billing card** | `✓ Billing flag · Leo · HIGH` / quoted note → owner queue | (closes itself) |
| **Disambiguation** | `Priya or Pria?` (two options) | tap = choose |
| **Wrap-up** | `CLASS DONE · 47 min · 7 drills` / `Feedback 9/12 ●●●…○` / `missed: Jake, Leo, Mia` / `11 agent actions · 3 emails to review` | tap = put the missed kids first next class |

**Behavior:**
- The timer counts from a saved start time, so it survives locks and restarts and buzzes the next prompt when it ends.
- Each drill actually run is logged with its real duration.
- A spoken new drill ("add: partner tag, 5 min") is inserted into the deck.
- "Next feedback" ranking: only present students not yet noted this session are eligible. Sort by:
  1. Flagged "missed" last class first.
  2. Then an open recurring issue.
  3. Then longest since their last note.
- Coverage counts unique present students with at least one feedback note this session.

## 4. Phone experience (Even app web view, Even dark theme #232323)

Four tabs plus the deck editor (approved mockups).

- **Today:**
  - Class header, this week's theme + forms due, focus issues from notes, the AI-drafted deck (summary).
  - Buttons: **Roster check-in** (attendance fallback: big tap targets) and **Start on glasses**.
- **Deck editor** (from Today):
  - Drag to reorder, tap to edit, ⇄ alternatives, swipe to delete, + add drill.
  - **Drill detail:** length, lens cues, focus students, private notes, "why the planner chose this", 3 alternatives.
  - **Tell the planner** bar: text, voice or quick chips ("More games", "Shorter", "More sparring", "Low energy day") → **diff view** (added / changed / removed, with reasons, new total time) → Accept / Tweak / Undo all.
  - Prompt "Remember for future decks: '…'?" saves a preference.
- **Review:**
  - Pending parent emails (Edit / Skip / Send, **Approve all**).
  - Billing flags (urgency pill, Add note / Mark handled).
  - Unassigned notes (pick a student).
  - Planner diffs requested from the lens.
  - Report cards.
- **Agents at work:** a live feed of `agent_runs`: agent, time, action, reason. For example: "3rd time in 30 days → marked recurring", "Marked Leo present (named in a note)". Failed runs show Retry.
- **Students:** list → detail with belt, age, class count, Working on (issues, with recurring badge), coach notes tied to drill and date, report card draft (Preview / Send to parent).

## 5. Architecture

```
G2 glasses ⇄ BLE ⇄ Even app (iPhone) ── WebView: MatSide app (lens + phone UI)
                                             │ HTTPS (whitelisted origin, CORS)
                                             ▼
                               api/ (Hono on Vercel Functions, Node)
                     ┌───────────────┼──────────────────────┬───────────────┐
              Postgres (Neon,     OpenAI transcription   Claude via AI SDK   Resend
              Drizzle)            (STT)                  + AI Gateway        (email)
                     ▲
              Vercel Cron: nightly planner (02:00), monthly report cards (1st, 06:00)
```

### 5.1 `app/`: the Even Hub app (Vite + TypeScript, packaged as `.ehpk`)

- **`lens/`:**
  - Screen state machine (pure reducer: `state + event → state + effects`).
  - Container renderers built on SDK text and list containers, using `textContainerUpgrade` for flicker-free updates.
  - Gesture router: reads `sysEvent` for taps, double-taps and long-press; reads `textEvent`/`listEvent` for scrolls and selection.
  - Class timer.
- **`phone/`:** React screens for the four tabs + deck editor. Polls `/agents/feed` every 2 s during class.
- **`core/`:**
  - `api.ts`: typed client with a bearer token.
  - `outbox.ts`: queue saved to `setLocalStorage` that keeps utterances and edits; retries on resume and when the network returns.
  - `audio.ts`: `audioControl(true, Glasses)`; gathers PCM 16 kHz s16le mono → WAV blob; re-arms on resume.
  - `session.ts`: active session state saved for cold-start recovery.
- **`app.json` permissions:**
  - `g2-microphone` ("Record voice notes about students during class").
  - `network` with the whitelist `[https://<api-domain>]`.
- **Name:** "MatSide" (≤20 chars, no "Even").

### 5.2 `api/`: hidden backend

| Endpoint | Purpose |
|---|---|
| `POST /pair` | Pairing code → per-instructor bearer token (stored in app storage) |
| `GET /today` | Next class, theme, forms due, focus issues, deck, roster |
| `POST /sessions` / `POST /sessions/:id/end` | Start/end class; end returns the wrap-up summary |
| `POST /utterance` | Multipart: audio (or `text` for dev), sessionId, currentDrillId, mode (`attendance` or `note`) → `{transcript, cardLines[], coverage, nextStudent, disambiguation?}` |
| `POST /sessions/:id/drills` | Log a drill start/end; add a spoken drill |
| `GET /decks/:id` · `PATCH /decks/:id` | Read/edit a deck |
| `POST /decks/:id/suggest` | Text → planner diff `{added[], changed[], removed[], reasons, totalMin}` |
| `POST /decks/:id/diffs/:diffId/accept` | Apply a diff |
| `GET /review` · `POST /review/:kind/:id/{approve,skip,handle}` | Review queue actions |
| `GET /agents/feed?since=` | `agent_runs` feed |
| `GET /students/:id` | Timeline, issues, report card |
| `POST /jobs/report-cards` · `POST /jobs/plan` | Cron targets + "Run now" |

- CORS: allow the app origin only.
- Input validated with Zod at every endpoint.
- Rate limit on `/utterance`.
- Secrets live only in Vercel env vars.

### 5.3 Agents

Router and specialists are server-side; every run writes an `agent_runs` row (agent, trigger, input summary, output, reason, status, ms).

| Agent | Implementation | Contract |
|---|---|---|
| **Router** | Claude, structured output (Zod schema). Prompt includes roster names, current drill, theme. | transcript → `intents[]`; each intent is `{type: feedback \| attendance \| billing \| plan_request \| parent_message \| add_drill, studentRefs[], content, skillTags[], urgency?, amount?}`. A single utterance may yield several intents. |
| **Name resolver** | Code: fuzzy match (Jaro-Winkler) against the session roster, with the roster also passed to the speech-to-text model as a prompt hint | ≥0.88 auto-matches. Between 0.75 and 0.88 shows the top two choices for the lens to resolve. Otherwise `unassigned`. |
| **Progress** | Code + the Router's skill tags (fixed taxonomy: stance, guard, kicks, strikes, forms, footwork, focus, effort, respect, sparring) | Inserts `notes` (student, session, drill, tags, text). **Recurring rule:** same tag ≥3 times in the last 30 days and no open issue → create `issue`, emit `issue.recurring` → triggers Parent email + Planner. |
| **Attendance** | Code | "everyone except X, Y" / "X is here" → `attendance`. Backstop: a feedback note marks that student present. |
| **Billing** | Code | → `billing_flags` (student, urgency low/med/high from the Router, note, amount?). No payment calls exist anywhere in the codebase. |
| **Parent email** | Claude | Inputs: student, guardian, last 30 days of notes with drill context, open issue. Output: subject + 80–140-word warm, specific email with one at-home tip → `outbox` (`pending_review`). Runs after the response is sent. |
| **Planner** | Claude, structured output | Inputs: theme, forms cycle, open issues (with student counts), last deck's run log, preferences, request text. Output: deck (8–12 drills: name, minutes, cues ≤2, focusStudentIds, rationale) or a diff against the current deck. Nightly job drafts the next deck; mid-class `plan_request` and the "Remind me" wrap-up feed into it. |
| **Report card** | Claude | One month of notes, drills, attendance, issues → `{strengths, workingOn, coachNotes (quoted with drill), attendance, nextGoal}` + email draft → Review. |

**Model:** `claude-sonnet-5-5` through AI Gateway for all LLM agents. Router target: <1.5 s.

**Latency budget for `/utterance`:** transcription ~0.8 s + Router ~1.2 s + code agents ~0.1 s ≈ ≤3 s to the agent card. Parent email and planner run after the response.

### 5.4 Data model (Postgres)

- `instructors(id, name, email, token_hash)`
- `classes(id, instructor_id, name, weekday, start_time)`
- `students(id, name, nickname, belt, birth_year)`
- `guardians(id, student_id, name, email)`
- `enrollments(class_id, student_id)`
- `curriculum(week_start, theme, forms_due jsonb)`
- `sessions(id, class_id, started_at, ended_at, deck_id)`
- `attendance(session_id, student_id, status, source: voice|phone|backstop)`
- `decks(id, class_id, for_date, status: draft|active|done)`
- `drills(id, deck_id, position, name, minutes, cues jsonb, focus_student_ids, rationale, started_at, ended_at)`
- `deck_diffs(id, deck_id, request_text, diff jsonb, status)`
- `notes(id, session_id, student_id null, drill_id, text, tags text[], created_at)`
- `issues(id, student_id, tag, status: open|resolved, opened_at)`
- `billing_flags(id, student_id, urgency, note, amount null, status)`
- `outbox(id, kind: parent_email|report_card, student_id, to_email, subject, body, status: pending_review|sent|skipped, sent_at)`
- `report_cards(id, student_id, month, content jsonb, outbox_id)`
- `agent_runs(id, session_id null, agent, trigger, summary, output jsonb, reason, status, ms, created_at)`
- `preferences(id, class_id, text)`

**Seed:**
- 1 school, 1 instructor, 2 kids classes (Tue/Thu 5 PM), 14 students + guardians (team-owned email addresses).
- Curriculum: 4 weekly themes + forms cycle.
- 3 weeks of past sessions/notes, chosen so that:
  - Priya has 2 prior "guard" notes, so her 3rd during the demo makes the issue recurring.
  - 4 kids share guard notes.
  - Leo has no notes recently.
- Tonight's deck drafted.

## 6. Failure handling

| Failure | Behavior |
|---|---|
| No network / app backgrounded | Utterance queued in the outbox. Lens shows `● Saved · will sync`. Sent on resume/online. Cold start rebuilds the session from storage. |
| Speech-to-text empty or unclear | `Didn't catch that · tap to retry`. The clip is kept for one retry. |
| Name doesn't match the roster | Two-choice screen on the lens, else `unassigned` in Review. Agents never guess silently. |
| Agent error | `agent_runs.status=error`, feed shows Retry. Notes are written before any LLM step, so they are never lost. |
| Slow agents | Lens card shows synchronous results only. Async results appear in the feed. |
| Mic permission denied | Glasses screen explains how to fix it. Phone lets you type notes. |
| Email send fails | Outbox item returns to `pending_review` with the error. |
| Even QA rules | Root double-tap → exit dialog. First-run instructions on the glasses. Responsive after 2 min idle and a 5 min lock. Timer completes while locked (iOS). |

## 7. Testing

- **Vitest unit tests:**
  - Lens reducer (every screen transition and gesture).
  - Name resolver thresholds.
  - Recurring-issue rule.
  - Attendance parsing.
  - Coverage + next-student ranking.
  - Outbox retry/ordering.
  - Deck diff apply.
  - WAV encoder.
- **API integration tests** against a test database for `/utterance` (text mode), `/sessions/:id/end`, review approve, deck suggest/accept.
- **Router evals:** 15 sample utterances with expected intents (multi-student, billing + feedback combined, attendance phrasing, plan requests, a bad name). Must pass before each deploy.
- **Simulator:** all lens flows. **Hardware (G2 + iPhone):** mic capture, lock 5 min → resume, mic denial, Beta install, exit dialog.

## 8. Demo (2–3 min video, live at the table)

1. Problem in numbers (d=0.99 vs 0.24; −41%; 1 in 5 quit within 90 days).
2. Phone Today → deck → "more structure, sparring for green belts" → diff → Accept.
3. Lens: "Everyone except Jake and Mia" → drill card → *"Priya, guard drops on the jab again, great energy though"* → agent card with 3 agents; the phone Agents feed updates live.
4. *"Leo's dad still owes for sparring gear, kinda urgent"* → HIGH billing flag.
5. Double-tap → wrap-up: 9/12, missed Jake/Leo/Mia → Remind me.
6. Review → approve Priya's parent email → it arrives in a real inbox.
7. Run report cards → Priya's October card.
8. Close with the pitch line. Judges then wear the G2 and try steps 3–5.

## 9. Delivery checklist

- [ ] `.ehpk` uploaded and a Beta group created with the phone account's email.
- [ ] Installed via Me → Beta tester and tested on the G2.
- [ ] Public GitHub repo, README section "Install & run on G2" (pairing code, test account, no keys needed by the tester).
- [ ] Devpost: description, tech, Even challenge selected, Even Hub name "MatSide", demo video with lens footage or simulator.
- [ ] Return the G2.

## 10. Cut order (if behind)

1. Planner "remember preference".
2. ⇄ drill alternatives (keep direct edit).
3. Students tab polish (report card via button + Review only).
4. Planner diff → full regenerate.

**Never cut:** voice notes → agents, agent card, feedback coverage, wrap-up, parent email approve → real send.
