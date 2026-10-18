# Amendment E: speed, plan control, flexibility, student intelligence, opportunistic agents, rubric demo

**Source:** Galen, Sat ~21:00. Overrides earlier amendments where they conflict.

**Judging criteria** (from the Even judging doc; every feature below serves one):
- Made for G2
- Quiet by Design
- Originality
- Experience & Polish
- Execution

**Product goal:** everything feels smooth, integrated and autonomous. The instructor commands agents by voice, and agents also act or suggest *opportunistically*.

## Global constraints (all tasks)

**Code and tests**
- The repo layout and conventions are unchanged: Zod contracts in `shared`, Hono and Drizzle in `api`, a pure reducer plus a controller in `app/src/lens`, and React in `app/src/phone`.
- Tests run with vitest; the api uses PGlite. Every task adds tests for its new logic. All suites must stay green: run `npm test` at the root.
- Migrations: add a new numbered drizzle migration with `npx drizzle-kit generate` from `api/`. Never edit applied migrations 0000–0008.

**LLM calls and safety**
- Every LLM call goes through `deps.llm` (router = Haiku, everything else = Sonnet) and is budget-guarded. Prefer deterministic logic where it is enough: detectors, briefs and summaries need no LLM.
- No medical or financial advice. Billing is notes only and never processes payments.
- Outward emails respect the per-agent autonomy setting (Task 27). The default is review.

**Lens limits and conventions**
- Lens text: ≤8 text containers, ≤12 total, exactly one with isEventCapture, container names ≤16 chars, ~3 glanceable rows.
- Partial updates replace the whole container text on the G2. Always send full lines.
- Reuse the existing word-boundary truncation helpers in `app/src/lens/text.ts`.
- The lightbulb glyph is a config constant `INSIGHT_GLYPH` in `app/src/config.ts`, default `'💡'`. Hardware may not render emoji; Galen verifies it on G2 and may swap it to `'✦'`.

**Phone and naming**
- Phone screens must scroll inside `#root` (theme.css). Never add position:fixed full-screen layers or html/body height locks.
- Follow the existing names: `withRun` for agent logging, `safeDefer` for background work, and `resolveName` for names.

---

## Task 25: Speed and offline confidence (app + api)
1. **Transcript-first.**
   - New `POST /v1/transcribe` (multipart `audio` plus optional `classId` or `sessionId` for roster hints). It returns `{ transcript }`.
   - Same auth, rate limit and size checks as `/v1/utterance`; share a helper and don't duplicate it. Custom vocabulary hints are added in Task 27, so leave a single `hintsFor(db, …)` function to extend.
   - Lens: after recording stops, call transcribe with a 5 s timeout. On success, show the "You said" column at once (card `transcript` filled, runs pending, a `… sorting` line). Then enqueue a **text** utterance (`text` field, no audio) through the existing outbox and fill the card from the response.
   - On a transcribe timeout or failure, fall back to the current audio-in-outbox path. Nothing is ever lost.
2. **Dual-mic start.**
   - When recording starts, open the glasses mic and the phone mic together. Buffer both.
   - On stop, use the glasses audio if it has ≥0.4 s of audio; otherwise use the phone audio. This replaces the sequential `MIC_FALLBACK_MS` fallback when `MIC_DUAL_START` (config, default true) is on. With it off, the current behavior runs.
   - Stopping must release both mics. Unit-test the selection logic as a pure function.
3. **Keep-warm.**
   - While a session is active, the controller pings `GET /health` every 4 min. Stop on session end and app suspend.
   - The phone app also pings once on resume (`visibilitychange`).
4. **Offline queue visibility (Feature 6).**
   - `Outbox` exposes `count()` and an onChange hook through the bus (`outboxChanged`, with the count).
   - Lens peek and home show a compact `⟳ 2 queued` suffix on the status row when count > 0.
   - Phone Today shows a banner `2 notes waiting to send · Retry now` (button flushes) when count > 0.
   - The controller retries flushes every 20 s while count > 0, and on `online`.

## Task 26: (merged into 25)

## Task 27: Agent autonomy and custom vocabulary (api + phone)
1. **Autonomy setting.** Table `agent_settings(task text pk, autonomy text not null)`. Autonomy is `'auto' | 'review' | 'off'`; a missing row means the default.

   | Task | Default | Allowed | `auto` | `review` | `off` |
   |---|---|---|---|---|---|
   | `parent_email` | review | all | sends immediately via the existing approve/send path | — | skips drafting and logs a run "skipped (off)" |
   | `report_card` | review | review / off | — | — | — |
   | `planner` | review | all | auto-accepts diffs from `autoAdjustNextDeck` and `suggestDiff` triggered by notes | — | no auto-adjust |
   | `billing` | auto | auto / off | records flags | — | — |
   | `progress` | auto | auto / off | — | — | — |
   | `attendance` | auto | auto / off | — | — | — |
   | `insights` | review | all | executes the suggestion's action | creates a suggestion | none |

   - `auto` for parent_email still respects `DEMO_EMAIL_OVERRIDE`.
   - The `insights` row is used by Task 31.
   - The service is `getAutonomy(db, task)`. All agents call it. Every run's `reason` mentions the autonomy when it changed the outcome.
   - Endpoints: `GET /v1/settings` returns `{ autonomy: Record<task, value>, vocabulary: string[] }`. `PATCH /v1/settings` takes a partial body and validates allowed values per task (400 otherwise).
2. **Custom vocabulary (Feature 8).** Table `school_vocab(term text pk, created_at)`, max 200 terms, each ≤40 chars.
   - STT hints = roster names, aliases, vocabulary and the current deck's drill names (cap the total prompt as the transcriber requires).
   - The router instructions get a "Known terms" line.
   - Onboarding commit adds curriculum items and drill names as terms (dedupe, best effort).
3. **Phone.**
   - Each Agents task detail screen gets a 3-way segmented control: **Auto · Review · Off** (only the allowed ones), with one sentence on what each does for that agent.
   - Today → Settings gets "Words CoachLens should know": a chip editor (add or remove), the same pattern as AliasEditor.

## Task 28: Plans with and without AI, and the voice-plan API (api + phone)
1. **Manual plan sources (Feature 9).** `POST /v1/decks/:id/replace { source: 'last' | 'blank' | 'ai' | { deckId } }` replaces the drills of a **not-started** deck (409 if its session started).
   - `last`: copy the drills of the most recent previous deck for the same class.
   - `deckId`: copy another deck's drills; any class is allowed.
   - `blank`: empty.
   - `ai`: re-run `draftDeck`.
   - Copies get fresh ids. Positions start at 1. Each replace is logged as a planner run (`trigger: 'replace'`).
   - The response is the Deck.
2. **Phone DeckEditor.**
   - A "Start from…" sheet with "Repeat last class", "Copy another class's plan" (pick from `/v1/classes` → their current deck), "Blank" and "Let AI draft". Show a confirm before replacing.
   - The existing manual editing (add, rename, minutes, reorder, delete, cues) must be easy. Make sure "Add item" exists and works without AI.
   - Keep the AI "ask" box.
3. **Voice plan editing.** `POST /v1/plan/voice { classId, transcript }`, where the transcript can be a multi-speaker conversation.
   - Planner agent: "the coach and an assistant are discussing the upcoming class; extract the intended changes and make the plan roughly match". It returns a DeckDiff against the class's next not-started deck, created via `nextDeckFor`.
   - The diff is **applied immediately**, because the instructor explicitly asked. Store it as an accepted diff so `POST /v1/diffs/:id/undo` works.
   - Response: `{ diffId, deckId, lines: string[] }`, where `lines` is a ≤4-line human summary like `+ Partner sparring 6m`, `− Kata 2`, `~ Warm-up 10→5m`, `↕ Pads moved to 2nd`. Build it with a pure function `diffSummary(before, after)`, unit-tested.
   - If nothing actionable was found, return `{ diffId: null, lines: ['No plan changes heard'] }`.
   - Log it as a planner run with `trigger: 'voice_plan'`. This route ignores the planner autonomy setting: an explicit command always applies.

## Task 29: Lens class lobby and planning listen (app)
**Gesture model (Galen's design):**
- **Home = class selection.** Swipe up/down cycles classes (as now). **Tap enters that class's lobby.** Double-tap = platform exit (root rule, unchanged).
- **Lobby (new screen).**
  - Shows: line 1 is the class name, start time and plan length; then the first 3 plan items (truncated); then the top insight banner when present (Task 32 fills it; render nothing when absent).
  - Footer hint: `tap start · 2×tap plan by voice · swipe back`.
  - **Tap = start class** (the existing start flow: roll call and so on).
  - **Double-tap = start planning listen.**
  - **Swipe = back to home.**
- **Planning listen (new screen).** A continuous recording meant for a conversation with an assistant instructor.
  - Shows `● Planning · m:ss` and the last ~60 chars heard.
  - Every 20 s, the controller cuts the audio buffered so far into a chunk and sends it to `/v1/transcribe` in the background. The transcript accumulates. This keeps each request small (Vercel's 4.5 MB body limit) and makes the end fast.
  - Hard cap: 3 min. **Tap = stop and apply.** **Double-tap = cancel.**
  - On stop, transcribe the remainder, join the chunks, then call `POST /v1/plan/voice`. While waiting, show a thinking line.
- **Plan result screen.** Shows the summary lines.
  - **Tap = OK** (back to lobby, plan refreshed).
  - **Double-tap = undo** (calls diff undo, shows `Plan change undone`, back to lobby).
  - Swipe = back to lobby.
- **In-class gestures are unchanged:** tap = talk, swipe = deck, double-tap = end class, long-press = hold to talk. Nod toggles dark in lobby and in class.
- Update `docs/voice-design.md` with the new gesture map (home / lobby / planning / in class).
- Reducer tests: every transition above. Controller tests: chunked transcription accumulates in order, a failed chunk is retried once, then the remainder is included in the final request.

## Task 30: Student intelligence (api + router + phone + lens)
1. **Metrics.** Table `student_metrics(id, student_id, key text, value text, num double null, unit text null, recorded_at, source 'voice'|'phone'|'seed', utterance_id null)`. Column `students.rank_since date null`, so time in rank is derived.
   - Mode defaults (suggested keys, not enforced):
     - martial_arts: `rank`, time in rank (derived);
     - personal_training: lift PRs `squat`, `deadlift`, `bench`, unit lb;
     - tutoring: `test` grades as a percent, with value text like "Unit 3 test".
2. **Router intents** (extend the `IntentType` enum, router instructions and evals).
   - **`metric`** ("Maria hit 225 on deadlift", "Sam got an 88 on the unit test", "Leo's been a yellow belt since March").
     - Fields: studentNames, metricKey, metricValue, metricNum, metricUnit.
     - Applying it inserts a metric row. A rank with a date sets `rank_since`.
     - Card line: `✓ Maria · deadlift 225 lb (PR +10)`. PR detection: numeric, higher than any previous value for the key; for grades, show the delta vs the last value.
     - Logged as a progress run.
   - **`student_query`** ("how's Priya doing?", "what did I say about Leo last week?").
     - No DB writes. The response carries a **brief** for the lens.
3. **Brief.** A deterministic `GET /v1/students/:id/brief` and a shared builder `buildBrief(db, studentId, mode)` returning ≤5 short lines:
   - name and rank (time in rank);
   - attendance over the last 6 sessions as `●●○●●●` with a trend word;
   - the latest 2 notes, short;
   - open issues;
   - the latest metric or PR, or the latest grade with its trend.
   - `UtteranceResponse` gains an optional `brief: { name, lines[] } | null`. The lens card shows the brief in place of the agent-progress column when present, with swipe paging.
4. **Phone StudentDetail.**
   - A "Profile" section with the brief lines.
   - A metrics list grouped by key: latest value, history sparkline-as-text, and a delete action.
   - An "Add a custom field" form (key, value, optional number and unit).
   - Editable rank and "rank since".
   - Endpoints: `POST /v1/students/:id/metrics` and `DELETE /v1/metrics/:id`. `PATCH /v1/students/:id` accepts `belt` and `rankSince`.

## Task 31: Opportunistic insights agent (api)
1. **Table** `insights(id, kind, student_id null, class_id null, title ≤60, detail ≤160, urgency 'low'|'high', action jsonb, status 'new'|'accepted'|'dismissed'|'auto_done', dedupe_key unique, created_at, acted_at)`.
2. **Deterministic detectors** (pure functions over loaded data, each unit-tested), in `api/src/agents/insights.ts`:

   | Detector | Fires when | Urgency |
   |---|---|---|
   | `attendance_decline` | absent in ≥2 of their last 3 sessions, or attendance rate in the last 4 weeks < 50% of the prior 4 weeks | low |
   | `returning_student` | marked present today after ≥2 consecutive absences | **high**: mid-class `Jake's back after 3 missed classes · welcome him` |
   | `no_feedback` | present in the last 3 sessions with zero notes | low; and **high** in class when present today and still uncovered at 70% of class time |
   | `ready_to_test` | martial_arts only: time in rank ≥ 90 days and no open issues | low |
   | `new_pr` | personal_training: a PR recorded in the last 7 days | low, praise email suggestion |
   | `grade_drop` | tutoring: the latest test is ≥10 points below the previous | low |
   | `issue_resolved` | an open issue's tag has had no new notes for 21 days | low; suggests a positive parent note and resolving it |
   | `billing_repeat` | ≥2 open billing flags for the same student | low |

   - `dedupe_key` = kind + student + ISO week, so nothing repeats.
3. **Actions** (`action` jsonb):
   - `{ type: 'draft_email', studentId, purpose }`: parentEmail agent with trigger `{ kind: 'insight', content: detail }`;
   - `{ type: 'plan_focus', classId, studentId, text }`: `autoAdjustNextDeck`;
   - `{ type: 'resolve_issue', issueId }`;
   - `{ type: 'none' }`.
4. **Autonomy (`insights` setting):**
   - `off`: detectors don't run;
   - `review`: rows are `new`;
   - `auto`: the action executes immediately (still subject to the parent_email or planner autonomy for what it creates) and the row becomes `auto_done`.
5. **Triggers.**
   - On session end (deferred).
   - On attendance changes inside a session: run only `returning_student`, deferred.
   - From the daily cron `/jobs/plan` (append to it).
   - Lazily from `GET /v1/insights` when the last run was more than 10 min ago (keep a timestamp in a tiny `kv` table or in-memory; best effort).
   - Every detector run is a `withRun({ agent: 'insights' })` with a summary like `3 new: Jake attendance, Maria ready to test…`.
6. **Endpoints.**
   - `GET /v1/insights?scope=all|class&sessionId=&classId=`: `new` rows.
     - `class` scope filters to students enrolled in the class.
     - In a live session it returns only `high` items created during that session.
   - `POST /v1/insights/:id/accept` executes the action and returns `{ ok, outcome }`.
   - `POST /v1/insights/:id/dismiss`.
7. **Agents summary.** Add an `insights` tile (AgentTask enum, label "Insights", color amber when there are new rows).

## Task 32: Insight surfaces and the end-of-class summary (lens + phone)
1. **Lens banner**, styled like Even's Conversate AI insights.
   - Top row: `${INSIGHT_GLYPH} ${title}`, with the detail on the next row, truncated.
   - Shown in the **lobby** (top `class`-scope insight, fetched on lobby enter) and **mid-class only for `high` urgency**:
     - the controller polls `GET /v1/insights?scope=class&sessionId=…` every 30 s during a session;
     - a new high item shows as a banner atop peek for 8 s, then collapses to a `💡1` suffix on the status row until seen;
     - swipe on a banner → details; tap → dismiss. It never interrupts recording or the card.
2. **End-of-class summary (Feature 5)**, upgrading the wrapup screen to ≤4 rows:
   - `40 min · 6 drills · 9/12 got feedback`;
   - `Missed: Jake, Mia, Leo`;
   - `7 agent actions · 3 to review`;
   - the top insight banner, if any.
   - **Tap = "plan missed kids first next class"** (the existing remind effect). The hint row says exactly `tap: put Jake, Mia first next class`, with names truncated to fit.
   - Double-tap = done (home).
3. **Phone Today.** A "From your agents" card above the plan with up to 3 insights. Each has title, detail and buttons **Do it** (accept) and **Dismiss**, and the outcome is shown inline. A link "All insights" opens the Agents → Insights task detail.
4. **Agents tab.** The Insights tile and task detail list insights with accept/dismiss, plus the autonomy control from Task 27.

## Task 33: Demo seed (api)
Extend `api/src/db/seed.ts` so every detector has a believable hit and every mode has profile data:
- martial_arts:
  - Jake: absent in 2 of the last 3 sessions;
  - Maria-belt student `rank_since` 120 days ago with no open issues → ready_to_test;
  - Priya: guard issue, open 25 days, no recent notes → issue_resolved;
  - ranks for everyone.
- personal_training: squat, deadlift and bench history, with a PR 3 days ago.
- tutoring: test grades with one 12-point drop.
- 6+ past sessions per class with attendance, so the dot strings render.
- Keep the seed idempotent, as it is now. Update the seed tests.

## Task 34: Rubric demo, Devpost, README (docs)
Rewrite `docs/demo-script.md` (2:30), `docs/devpost.md` and the README to answer the judges **word for word**. Use their exact headings:
- "Who is this for?";
- "What moment is it designed for?";
- "Why does it belong on G2?";
- "Can the judge try it right now?";
- then the five criteria as headings: Made for G2, Quiet by Design, Originality, Experience & Polish, Execution.

Under each, give concrete evidence, such as:
- Originality: cite `docs/originality.md`, with the "to our knowledge" claim and the count.
- Quiet by Design: lens dark until triggered; insights only at quiet moments unless urgent; one gesture to talk.
- Execution: test counts, the hardware-tested flows, and the steps a judge follows to try it on a loaner.

The demo script shows the G2 view for each beat:
1. lobby;
2. planning conversation;
3. start class;
4. notes (feedback, urgent, metric PR, "how's Priya doing");
5. the mid-class returning-student insight;
6. the end summary;
7. agents acting (Review, Insights, autonomy toggle).
