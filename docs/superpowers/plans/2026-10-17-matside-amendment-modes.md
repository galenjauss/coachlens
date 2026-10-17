# Amendment B: teaching modes + rename to CoachLens (new Task 12b, runs after Task 12, before Task 13)

**Source:**
- Galen's decision, after advice from the Even Realities booth: build teaching **modes**. Each mode has its own flavor, and they all share the same engine.
- Galen chose the user-facing name **CoachLens**.

**Global constraint changes (override the index):**
- **App name:** `CoachLens` (≤20 chars, no "Even"). package_id `com.coachlens.app`. The internal workspace names (`@matside/*`) stay unchanged to avoid churn.
- **Skill tags are no longer one fixed list.** Each mode has its own fixed taxonomy of 10 tags. The router must still only emit tags from the **current class's mode**.
- **Personal-training mode guardrail:** no medical, injury or nutrition advice in any agent output.

## Modes

Ship exactly these three modes, defined in `shared/src/modes.ts`:

| field | `martial_arts` | `personal_training` | `tutoring` |
|---|---|---|---|
| label | Martial arts | Personal training | Tutoring |
| person / people | student / students | client / clients | student / students |
| recipient | parent | client (the person themself) | parent |
| planUnit | Drill deck | Session plan | Lesson plan |
| planItem | drill | exercise | activity |
| planShape (planner guidance) | warm-up → technique on the weekly theme → drills → forms due → game → calm finish; 8–12 items, 40–50 min | warm-up → main lifts (sets × reps in cues) → accessory → finisher → cool-down; 6–10 items, 45–60 min | warm-up problem → concept explanation → guided practice → independent practice → exit ticket; 5–8 items, 45–60 min |
| tags (exactly 10) | stance, guard, kicks, strikes, forms, footwork, focus, effort, respect, sparring | form, depth, tempo, bracing, range, breathing, load, effort, consistency, recovery | concept, procedure, accuracy, speed, vocabulary, reasoning, focus, effort, confidence, homework |
| tagLabels | same as the plan's TAG_LABEL (Stances, Guard drops, …) | Form, Depth, Tempo, Bracing, Range of motion, Breathing, Load, Effort, Consistency, Recovery | Concept gaps, Procedure, Accuracy, Speed, Vocabulary, Reasoning, Focus, Effort, Confidence, Homework |
| weeklyLabel / itemsDueLabel | Theme / Forms due | Program block / Goals | Unit / Upcoming |
| reportCardFocus | belt progress, focus areas, effort and respect | progress toward goals, PRs, consistency | mastery by topic, next skills, effort |
| billingExamples | gear, monthly dues, testing fees | sessions left in package, renewal | session pack balance |
| guardrails | No medical advice. Never mention other students. | No medical, injury or nutrition advice; refer to a professional. Never mention other clients. | No grade guarantees. Never mention other students. |
| cueExamples | "knees out · back tall" | "chest up · drive through heels" | "show your steps" |

### Shared code (`shared/src/modes.ts`, exported from the index)
```ts
export const MODE_IDS = ['martial_arts', 'personal_training', 'tutoring'] as const
export const ModeId = z.enum(MODE_IDS); export type ModeId = z.infer<typeof ModeId>
export interface ModeConfig { id: ModeId; label: string; person: string; people: string; recipient: 'parent' | 'client'; planUnit: string; planItem: string; planShape: string; tags: readonly string[]; tagLabels: Record<string, string>; weeklyLabel: string; itemsDueLabel: string; reportCardFocus: string; billingExamples: string; guardrails: string; cueExamples: string }
export const MODES: Record<ModeId, ModeConfig> = { /* the three rows above, verbatim */ }
export const ALL_TAGS: string[] // union of every mode's tags, deduped
```

### Contract changes (`shared/src/contracts.ts`)
- `SkillTag` becomes `z.string().min(1).max(24)`. Remove the `SKILL_TAGS` export, or alias it to `MODES.martial_arts.tags` for compatibility.
- Add `routerOutputFor(mode: ModeId)`. It returns a `RouterOutput`-shaped schema where `skillTags` is `z.array(z.enum(MODES[mode].tags as [string, ...string[]])).max(2)`. The exported static `RouterOutput`/`Intent` keep `skillTags: z.array(SkillTag).max(2)` for transport.
- `Today` adds `mode: ModeId`, `modeLabel: string`, `weeklyLabel: string`, `itemsDueLabel: string`, `planUnit: string`, `people: string`.
- `StudentRef`, `RosterStudent` and the other types are unchanged.

### DB changes (one new migration)
- `classes.mode`: `text('mode').$type<ModeId>().notNull().default('martial_arts')`.
- `curriculum`: add `mode` text, not null, default `'martial_arts'`. The primary key becomes `(week_start, mode)`. Lookups filter by the class's mode.
- `issues.tag` and `notes.tags` become plain strings (the type changes; the columns are already text/jsonb).

### Agents and services
- Add a helper `modeForClass(db, classId): Promise<ModeConfig>` in `services/context.ts`. `SessionContext` gains `mode: ModeConfig`.
- **Router:** `ROUTER_INSTRUCTIONS` becomes `routerInstructions(mode)`. It uses the mode's tags, `people` and `recipient` wording ("contact a student's parent" vs "message the client"), plus the billing examples and guardrails. `routeUtterance` validates with `routerOutputFor(mode.id)`.
  - Update the eval: `run-router.ts` keeps the martial-arts cases.
  - Add `evals/router-cases-pt.json` (5 cases) and `evals/router-cases-tutoring.json` (5 cases), and run all three.
  - Examples (PT): "Maria's squat depth was great, knees caving on the last set" → feedback [depth|form]. "Tom only has two sessions left in his package" → billing.
  - Examples (tutoring): "Sam kept forgetting to distribute the negative" → feedback [procedure]. "Email Ava's mom that she aced the quiz" → parent_message.
- **Planner:** `planningContext` includes the mode label, planShape, cueExamples, guardrails and weeklyLabel/itemsDueLabel. `draftDeck`'s DraftOut bounds become `min(5).max(12)`, because tutoring needs 5–8.
- **Parent email:** instructions take the mode. For `recipient: 'client'`, address the client in second person and sign as the coach. The guardrails are appended.
- **Report card:** instructions take `reportCardFocus` and the guardrails.
- **Today:** returns the mode fields. `TAG_LABEL` comes from the mode's `tagLabels`. The class picker is unchanged (by weekday).
- **Recurring rule, coverage, ranking, card lines:** unchanged. The card line shows the tag string.

### Seed (extend `seed.ts`; keep the martial-arts world exactly as-is)
- **Personal training:** class `PT · Mon 6:00` (weekday 1) with 5 clients (adult names, no birth years under 18; belt field = "client"; birthYear e.g. 1990). Guardian rows hold the client's own email (from the same `guardianEmail` source).
  - 2 prior notes for "Maria Gomez" tagged `depth` (5 and 11 days ago), so her 3rd depth note triggers recurring live.
  - Curriculum for mode personal_training: this week "Lower-body strength", goals ["Squat 5×5", "Deadlift form check"].
  - A 7-item session plan for the next Mon.
- **Tutoring:** class `Algebra · Wed 4:00` (weekday 3) with 4 students.
  - 2 prior `procedure` notes for "Sam Patel".
  - Curriculum mode tutoring: "Linear equations", upcoming ["Unit quiz Fri"].
  - A 6-item lesson plan for the next Wed.
- Fix the Task 9 deferred minor: seeded deck rationales must not say "this week's theme" if the deck falls in another week. Use neutral wording ("Stances focus").
- Update the seed test to check the counts: 3 classes, 23 people, curriculum rows per mode, and one deck per class.

### App (Tasks 16–19 pick this up; noted here so the briefs carry it)
- `app.json` name `CoachLens`, package_id `com.coachlens.app`. The first-run lens copy says "WELCOME TO COACHLENS".
- Phone header: CoachLens, with a mode badge on Today (`🥋 Martial arts`, `🏋️ Personal training`, `📐 Tutoring`). Labels come from `Today.weeklyLabel`, `itemsDueLabel`, `planUnit` and `people`.
- **Demo mode switch (phone, Today tab):** a small "Class" picker listing the seeded classes, so the demo can jump to the PT or tutoring class without waiting for its weekday. API: `GET /v1/classes` returns `[{ id, name, mode, modeLabel }]`, and `GET /v1/today?classId=…` overrides the weekday pick. Add both in Task 12b.
- The lens is identical across modes. The deck browser header uses `planUnit` (e.g. `SESSION PLAN · 7`).

## Task 12b steps (TDD)
1. Write tests first:
   - `modes.test.ts` (shared): each mode has exactly 10 tags, labels for every tag, and `routerOutputFor` rejects another mode's tag.
   - api: the router prompt for `personal_training` contains "client" and the PT tags.
   - `/v1/today?classId=<pt>` returns `mode: 'personal_training'` and a session-plan deck.
   - A PT recurring flow: Maria's 3rd depth note → recurring + email draft addressed to the client.
   - `/v1/classes` lists 3 classes after seed.
2. Implement shared modes + contracts, then the migration (`drizzle-kit generate`), then the agents/services, then the seed, then the routes.
3. `npm test && npm run typecheck` (all workspaces) must be green. Commit `feat: teaching modes (martial arts, personal training, tutoring) and CoachLens naming` with the Co-Authored-By line.
