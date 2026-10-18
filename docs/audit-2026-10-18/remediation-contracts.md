# Remediation: cross-batch contracts

Batches 2 (server), 3 (lens and phone client) and 4 (docs) run in parallel. These shapes are binding; whoever implements a side must match them exactly.

## C1 · Idempotency (F03)

- **Request:** the client sends a stable operation id per queued item, as the multipart form field `opId` (the outbox item id, a UUID) AND the header `Idempotency-Key: <opId>`. This applies to `POST /v1/utterance` and `POST /v1/transcribe`. Transcribe has no side effects, so the key is optional there.
- **Storage:** a table `operations(instructor_id, key, route, status 'pending'|'done', response_json, created_at)`, unique on (instructor_id, key).
- **First request:** inserts a pending row, runs, stores the response, and marks the row done, all in one transaction with the writes where possible.
- **Retry with the same key:**
  - If the row is done: return the stored response with HTTP 200 and the header `Idempotent-Replay: true`. Nothing runs again, and no downstream agent task is re-enqueued.
  - If the row is still pending (concurrent): return 409 `{ error: 'in_progress' }`. The client keeps the item and retries later.
- **Downstream deferred work** (parent emails, plan adjustments, insights) is keyed by `utterance_id` plus the task kind. Re-running the same utterance never creates a second draft or plan change.

## C2 · Undo (F02)

- **Request:** `POST /v1/utterances/:id/undo`.
- **Response 200:** `{ ok: true, reversed: string[], cancelled: string[], notReversible: string[] }`. Each string is a short human label, at most 38 characters, for example `Removed Priya note`, `Restored Maya rank: brown`, `Attendance restored (13 present)`, `Cancelled email draft for Dee`, `Email already sent to Dee's family`.
- **Response 409:** `{ error: 'already_undone' }`.
- **Response 404:** unknown id.
- **What the server reverses** (via an action ledger written when each action is applied: kind, entity, before, after):
  - notes;
  - billing flags;
  - attendance (restore the previous status per student, or delete rows that were created);
  - metrics (delete the inserted metric rows);
  - rank/belt and rank_since (restore the before values);
  - issues opened by this utterance (delete or reopen);
  - drills added;
  - planner diffs applied (revert them, or mark undone when pending);
  - pending outbox drafts (cancel them: status `cancelled`);
  - pending or deferred agent work, which must check a cancellation flag before writing (a race test is required).
- **Sent email** cannot be reversed. It is reported in `notReversible`.

## C3 · Roster and class maintenance (F23, F16)

Every route is scoped to the authenticated instructor (C4).
- `GET /v1/notes/:id/candidates` returns `{ classId, className, capturedAt, students: [{ id, name, nickname, aliases }] }`: the roster of the note's own class.
- `POST /v1/students` with `{ name, belt?, nickname?, classIds: string[], guardians?: [{ name, email }] }` returns the student.
- `PATCH /v1/students/:id`: the existing fields plus `name`, `nickname`, `classIds`, and `guardians` (replace).
- `DELETE /v1/students/:id`: deletes the student and their personal data (notes, metrics, guardians, enrollments, attendance). Returns `{ ok: true }`.
- `POST /v1/classes` with `{ name, mode, startTime, weekday?/days }`. Match the fields the existing class row has.
- `PATCH /v1/classes/:id` and `DELETE /v1/classes/:id` (removes enrollments and decks; refuse with 409 while a session is live).

## C4 · Accounts and auth (F18, F19)

- **Ownership:** every table that holds instructor data is scoped by `instructor_id`, directly or through its class. Every query filters by the authenticated instructor. Pairing maps a code to ONE instructor; there is no "first instructor" fallback.
- **Pairing codes:** reusable per instructor and rotatable through `POST /v1/pairing/rotate`, which returns the new code once; this is an owner action. Codes are hashed at rest. The env `PAIRING_CODE` seeds the demo instructor's code.
- **Tokens:** expire after 90 days. `POST /v1/unpair` revokes the current token (the client calls it on "Unpair this phone"). An expired or revoked token gets 401, which leads to the existing re-pair flow.
- **Isolation tests:** two instructors with separate classes, students and notes. Every list and read route returns only the caller's data, and every write to another instructor's entity returns 404.

## C5 · Status (F20)

`GET /v1/status` returns `{ aiCallsToday, aiDailyCap, sttConfigured, mailMode: 'review'|'auto'|'off', degraded: boolean }`. This is batch 1's domain; the client may show it.

## C6 · Lens display policy (F06, F12, F13)

- **Setting:** `coachlens.displayMode` = `quiet` (the default) or `standard`, in KV, with a phone toggle in Settings.
- **Quiet mode:**
  - During class, the idle display auto-hides to dark 8 s after the last change.
  - Result cards auto-dismiss after 6 s.
  - A banner never captures tap. Tap always records during an active class (it wakes and records). Swipe dismisses or opens the banner detail.
  - Double-tap meanings stay consistent: cancel, undo, or end-class confirm, with an on-screen hint.
- **Standard mode:** the current persistent display.
