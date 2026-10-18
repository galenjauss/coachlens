# Amendment D: v2 from the first hands-on test (Galen, Sat evening)

**Source:** Galen's hands-on feedback and decisions. This overrides earlier amendments where they conflict.

## Task 21 (api): agent behavior fixes
1. **Email cooldown + urgency.**
   - A recurring issue no longer drafts a parent/client email. It still opens the issue and adjusts the next plan, and it feeds the monthly report card.
   - An email is drafted immediately only for:
     - (a) an explicit `parent_message` intent;
     - (b) a feedback intent the router marks `urgent: true`. Add `urgent` to `Intent` (boolean, default false). The router sets it for injury, safety or serious-behavior notes.
   - Cooldown: at most one **non-urgent** auto email per student per 30 days. Explicit requests and urgent notes bypass the cooldown.
   - Card lines change: recurring → `→ added to report card` instead of `→ parent note drafting`. Urgent → `⚠ urgent · parent note drafting`.
2. **Name aliases.**
   - `students.aliases` jsonb string[] (migration).
   - `resolveName` also scores aliases.
   - Assigning an unassigned note (`POST /v1/notes/:id/assign`) appends that note's `heard` to the student's aliases (deduped, max 10).
   - `PATCH /v1/students/:id { aliases: string[] }`.
   - Roster hints to STT include aliases.
3. **Attendance by presence.**
   - `parseAttendance` also handles "present: A, B, C" / "here: A, B" / "only A and B are here": `{ kind: 'present', names }`. Everyone else is marked absent.
   - Unresolved names follow the same rollcall_unclear rule.
4. **Utterance → agent progress.**
   - `agent_runs.utterance_id` (nullable, migration). Every run started from `handleUtterance` (router, progress, billing, attendance, add_drill, and the deferred email/planner) records it.
   - `GET /v1/utterances/:id/runs` → `[{ agent, summary, status, createdAt }]` so the lens can show agent progress live.
5. **Steering agents.**
   - `POST /v1/review/outbox/:id/redraft { instruction }` → re-runs the email or report-card agent on that draft with the instruction. Same row, new subject/body, still pending_review. Logged.
   - `GET /v1/agents/summary` → one tile per agent task: `progress`, `parent_email`, `report_card`, `billing`, `planner`, `attendance`. Each tile has `{ task, label, counts: { today, pending, urgent }, latest: AgentRunView | null }`.
   - `GET /v1/agents/:task?limit=50` → that task's runs, with linked item ids when available (outboxId, billingFlagId, diffId, noteId) so the phone can open and steer them.
6. **Onboarding backend** (see Task 24; may be split into its own task).

## Task 22 (app/lens): lens v2
1. **On during class.**
   - After class starts, the rest screen is **`peek`, persistent**: drill + time + bar + next kid. No auto-hide.
   - `dark` is entered only by the toggle gesture.
   - Keep the current gesture layout exactly: tap = talk, swipe = deck, double-tap = end class, long-press = hold-to-talk.
   - Tap in `dark` **wakes** the lens to peek. It does NOT record.
2. **Nod to toggle (experimental).**
   - Replace HeadTiltDetector with a NodDetector: pitch dips past a threshold and returns within 600 ms → toggle `dark` ↔ `peek`.
   - **Calibration aid:** when the app is opened with `?imu=1` or the phone debug toggle is on, show live IMU x/y/z on the phone screen, so Galen can read the axis and sign while nodding. Values come from the controller via the bus. Defaults stay configurable in config.ts.
   - If IMU never reports, show nothing and keep working.
3. **Agent card stays up and shows agent progress.**
   - After sending, the card stays until tapped away (no 4 s timeout).
   - Layout: **left column = what you said** (transcript, wrapped to about 3 lines); **right column = agent progress** (`✓ sorted`, `✓ logged`, `… email`, `✓ plan`), polled from `GET /v1/utterances/:id/runs` every 2 s for up to 30 s.
   - Use two side-by-side text containers so each column updates on its own (partial updates).
   - Double-tap = undo, as before.
4. **Timer.** Per-second `m:ss` using `textContainerUpgrade` **partial updates** (`contentOffset`/`contentLength` covering only the time characters) in a dedicated small timer container. Progress bar `━─` refreshed every 5 s. Never repaint unchanged containers.
5. **Class choice on the lens.** On home, swipe up/down cycles through `api.classes()` (name + mode). Tap starts the shown class (writes KV `coachlens.classId` + bus `classChanged`, so the phone stays in sync).
6. **Roll call hint.** The attendance screen shows the enrolled count and both phrasings: "Everyone except …" or "Present: …". Double-tap skips.

## Task 23 (app/phone): phone fixes + agents tiles
1. **Scroll bug:** roster check-in, and every phone screen, must scroll on iOS. Check `index.html` body/html `height:100%`, `overscroll-behavior:none`, `touch-action`, and any fixed-height containers. Fix so screens scroll inside the WebView while the tab bar stays fixed.
2. **Agents tiles** (after mockup approval): a grid of task tiles from `/v1/agents/summary`, colored by urgency (red urgent, amber pending review, green done). Tap → task detail list → item detail with a **"Tell this agent…"** box:
   - email/report card → redraft;
   - planner → suggest diff;
   - progress → reassign/edit note;
   - billing → add note.
3. **Aliases:** the student detail screen shows the aliases list, editable.

## Task 24: AI-assisted onboarding quiz (api + phone), after mockup approval
**Structured steps, each with AI extraction from pasted text or a photo or file:**
1. coaching type → mode;
2. business basics (school name, coach name, time zone);
3. classes & schedule (paste or photo of the schedule);
4. roster (paste, CSV or photo of the sign-in sheet) → students + guardian emails;
5. curriculum (paste notes or a doc) → weekly themes and items due;
6. review & confirm everything in editable tables → commit.

**API:**
- `POST /v1/onboarding/extract { step, text?, imageBase64? }` → a typed proposal for that step (Sonnet with vision; budget-guarded).
- `POST /v1/onboarding/commit { proposal }` → creates the classes/students/guardians/curriculum in one go (idempotent per name), and drafts the first plans for each class.

The phone shows a progress stepper, one card per step, and an "AI found 14 students — check them" review table. No free-form chat.
