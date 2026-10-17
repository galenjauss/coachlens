# MatSide Plan, Part 1: Backend core (Tasks 1–9)

> Index and Global Constraints: [2026-10-17-matside.md](2026-10-17-matside.md). Every task implicitly includes the Global Constraints.

---

### Task 1: Repo, workspaces, git

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `shared/package.json`, `shared/tsconfig.json`, `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`
- Move: `g2-starter/` → `app/`; modify `app/package.json` (name), `app/tsconfig.json` (extends)

**Interfaces:**
- Produces: workspace packages `@matside/shared`, `@matside/api`, `@matside/app`. Root scripts `npm test`, `npm run typecheck`.

- [ ] **Step 1: Init git and move the starter**

```bash
cd ~/lahacks
git init -b main
mv g2-starter app
rm -rf app/node_modules app/package-lock.json
mkdir -p shared/src api/src
```

- [ ] **Step 2: Root files**

`package.json`:
```json
{
  "name": "matside",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "api", "app"],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "types": []
  }
}
```

`.gitignore`:
```
node_modules
dist
.env
.env.*
!.env.example
.superpowers/
.vercel
*.ehpk
```

- [ ] **Step 3: Workspace package files**

`shared/package.json`:
```json
{
  "name": "@matside/shared",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p .", "test": "vitest run" },
  "dependencies": { "zod": "^4.6.7" },
  "devDependencies": { "typescript": "^5.7.0", "vitest": "^5.0.5" }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src"] }
```

`api/package.json`:
```json
{
  "name": "@matside/api",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc -p .",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "seed": "tsx src/db/seed-cli.ts",
    "eval": "tsx evals/run-router.ts",
    "dev": "tsx watch src/dev-server.ts"
  },
  "dependencies": {
    "@matside/shared": "*",
    "@neondatabase/serverless": "^1.2.0",
    "@vercel/functions": "^3.0.0",
    "ai": "^7.0.143",
    "drizzle-orm": "^0.45.4",
    "hono": "^4.13.13",
    "openai": "^7.37.0",
    "resend": "^6.34.1",
    "zod": "^4.6.7"
  },
  "devDependencies": {
    "@electric-sql/pglite": "^0.3.0",
    "@hono/node-server": "^2.1.5",
    "@types/node": "^24.0.0",
    "drizzle-kit": "^0.31.11",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^5.0.5"
  }
}
```

`api/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "evals", "drizzle.config.ts"] }
```

`api/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 20000 } })
```

- [ ] **Step 4: Point the app at the workspace**

In `app/package.json`:
- set `"name": "@matside/app"`;
- add `"@matside/shared": "*"` to `dependencies`;
- add scripts `"typecheck": "tsc --noEmit -p ."` and `"test": "vitest run"`;
- add devDependency `"vitest": "^5.0.5"`.

Replace `app/tsconfig.json` with:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["vite/client"] }, "include": ["src"] }
```

- [ ] **Step 5: Install and verify**

Run: `cd ~/lahacks && npm install && npm run typecheck`
Expected: install succeeds. Typecheck passes for `app`. `shared` and `api` have no sources yet: if tsc errors "No inputs were found", add an empty `shared/src/index.ts` and `api/src/index.ts` containing `export {}`.

If `@vercel/functions@^3` or `@electric-sql/pglite@^0.3` don't resolve, run `npm view <pkg> version` and pin the latest.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: monorepo with shared, api, app workspaces

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Shared contracts

**Files:**
- Create: `shared/src/contracts.ts`, `shared/src/index.ts`
- Test: `shared/src/contracts.test.ts`

**Interfaces:**
- Produces (every later task imports these from `@matside/shared`):
  - Constants: `SKILL_TAGS`.
  - Zod schemas, each also exported as a same-named type: `SkillTag`, `Urgency`, `IntentType`, `Intent`, `RouterOutput`, `DrillKind`, `DrillDraft`, `Drill`, `Deck`, `DeckDiff`, `StudentRef`, `RosterStudent`, `Coverage`, `NextStudent`, `Disambiguation`, `UtteranceResponse`, `StartSessionResponse`, `WrapUp`, `FocusItem`, `Today`, `AgentRunView`, `ReviewItem`, `StudentDetail`, `ReportCardContent`, `UtteranceForm`.

- [ ] **Step 1: Write the failing test**

`shared/src/contracts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Intent, RouterOutput, DeckDiff, UtteranceResponse, ReviewItem } from './contracts'

describe('contracts', () => {
  it('parses a router output with feedback + billing', () => {
    const out = RouterOutput.parse({
      intents: [
        { type: 'feedback', studentNames: ['Priya'], content: 'guard drops on the jab', skillTags: ['guard'], urgency: null, amount: null, minutes: null, attendanceStatus: null },
        { type: 'billing', studentNames: ['Leo'], content: 'owes for sparring gear', skillTags: [], urgency: 'high', amount: null, minutes: null, attendanceStatus: null },
      ],
    })
    expect(out.intents).toHaveLength(2)
  })

  it('rejects unknown skill tags', () => {
    expect(() => Intent.parse({ type: 'feedback', studentNames: [], content: 'x', skillTags: ['karate'], urgency: null, amount: null, minutes: null, attendanceStatus: null })).toThrow()
  })

  it('parses a deck diff and an utterance response', () => {
    DeckDiff.parse({ added: [], changed: [], removed: [{ drillId: 'd1', reason: 'too wild' }], rememberSuggestion: null })
    UtteranceResponse.parse({ utteranceId: 'u1', transcript: 't', cardLines: ['✓ Priya · guard'], coverage: { covered: 1, present: 12 }, nextStudent: null, disambiguation: null })
  })

  it('discriminates review items by kind', () => {
    const item = ReviewItem.parse({ kind: 'billing', id: 'b1', studentName: 'Leo', urgency: 'high', note: 'gear', amount: null, createdAt: '2026-10-17T00:00:00Z' })
    expect(item.kind).toBe('billing')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w shared`
Expected: FAIL, cannot resolve `./contracts`.

- [ ] **Step 3: Implement**

`shared/src/contracts.ts`:
```ts
import { z } from 'zod'

export const SKILL_TAGS = ['stance', 'guard', 'kicks', 'strikes', 'forms', 'footwork', 'focus', 'effort', 'respect', 'sparring'] as const
export const SkillTag = z.enum(SKILL_TAGS)
export type SkillTag = z.infer<typeof SkillTag>

export const Urgency = z.enum(['low', 'med', 'high'])
export type Urgency = z.infer<typeof Urgency>

export const IntentType = z.enum(['feedback', 'attendance', 'billing', 'plan_request', 'parent_message', 'add_drill'])
export type IntentType = z.infer<typeof IntentType>

// Every field is required and nullable/array so it works with LLM structured output.
export const Intent = z.object({
  type: IntentType,
  studentNames: z.array(z.string()),
  content: z.string(),
  skillTags: z.array(SkillTag).max(2),
  urgency: Urgency.nullable(),
  amount: z.number().nullable(),
  minutes: z.number().int().nullable(),
  attendanceStatus: z.enum(['present', 'absent']).nullable(),
})
export type Intent = z.infer<typeof Intent>

export const RouterOutput = z.object({ intents: z.array(Intent) })
export type RouterOutput = z.infer<typeof RouterOutput>

export const DrillKind = z.enum(['warmup', 'technique', 'drill', 'forms', 'game', 'sparring'])
export type DrillKind = z.infer<typeof DrillKind>

export const DrillDraft = z.object({
  name: z.string().min(1).max(40),
  minutes: z.number().int().min(1).max(30),
  kind: DrillKind,
  cues: z.array(z.string().max(40)).max(2),
  focusStudentIds: z.array(z.string()),
  rationale: z.string().max(160),
})
export type DrillDraft = z.infer<typeof DrillDraft>

export const Drill = DrillDraft.extend({
  id: z.string(),
  position: z.number().int(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
})
export type Drill = z.infer<typeof Drill>

export const Deck = z.object({
  id: z.string(),
  classId: z.string(),
  forDate: z.string(),
  status: z.enum(['draft', 'active', 'done']),
  drills: z.array(Drill),
})
export type Deck = z.infer<typeof Deck>

export const DeckDiff = z.object({
  added: z.array(DrillDraft.extend({ afterPosition: z.number().int().min(0), reason: z.string() })),
  changed: z.array(z.object({ drillId: z.string(), after: DrillDraft, reason: z.string() })),
  removed: z.array(z.object({ drillId: z.string(), reason: z.string() })),
  rememberSuggestion: z.string().nullable(),
})
export type DeckDiff = z.infer<typeof DeckDiff>

export const StudentRef = z.object({ id: z.string(), name: z.string() })
export type StudentRef = z.infer<typeof StudentRef>

export const RosterStudent = StudentRef.extend({ nickname: z.string().nullable(), belt: z.string() })
export type RosterStudent = z.infer<typeof RosterStudent>

export const Coverage = z.object({ covered: z.number().int(), present: z.number().int() })
export type Coverage = z.infer<typeof Coverage>

export const NextStudent = StudentRef.extend({ reason: z.string() })
export type NextStudent = z.infer<typeof NextStudent>

export const Disambiguation = z.object({ noteId: z.string(), heard: z.string(), options: z.array(StudentRef).length(2) })
export type Disambiguation = z.infer<typeof Disambiguation>

export const UtteranceResponse = z.object({
  utteranceId: z.string(),
  transcript: z.string(),
  cardLines: z.array(z.string()).max(4),
  coverage: Coverage,
  nextStudent: NextStudent.nullable(),
  disambiguation: Disambiguation.nullable(),
})
export type UtteranceResponse = z.infer<typeof UtteranceResponse>

export const UtteranceForm = z.object({
  sessionId: z.string().min(1),
  drillId: z.string().min(1).nullable(),
  mode: z.enum(['note', 'attendance']),
  text: z.string().min(1).max(1000).nullable(),
})
export type UtteranceForm = z.infer<typeof UtteranceForm>

export const StartSessionResponse = z.object({ sessionId: z.string(), startedAt: z.string(), coverage: Coverage, nextStudent: NextStudent.nullable() })
export type StartSessionResponse = z.infer<typeof StartSessionResponse>

export const WrapUp = z.object({
  sessionId: z.string(),
  minutes: z.number().int(),
  drillsRun: z.number().int(),
  coverage: Coverage,
  missed: z.array(StudentRef),
  agentActions: z.number().int(),
  pendingReview: z.number().int(),
})
export type WrapUp = z.infer<typeof WrapUp>

export const FocusItem = z.object({ label: z.string(), studentIds: z.array(z.string()), studentNames: z.array(z.string()) })
export type FocusItem = z.infer<typeof FocusItem>

export const Today = z.object({
  classId: z.string(),
  className: z.string(),
  startTime: z.string(),
  forDate: z.string(),
  sessionId: z.string().nullable(),
  theme: z.string(),
  formsDue: z.array(z.string()),
  focus: z.array(FocusItem),
  deck: Deck,
  roster: z.array(RosterStudent),
})
export type Today = z.infer<typeof Today>

export const AgentRunView = z.object({
  id: z.string(),
  agent: z.string(),
  summary: z.string(),
  reason: z.string(),
  status: z.enum(['ok', 'error']),
  createdAt: z.string(),
})
export type AgentRunView = z.infer<typeof AgentRunView>

const at = z.string()
export const ReviewItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('parent_email'), id: z.string(), studentName: z.string(), to: z.string(), subject: z.string(), body: z.string(), createdAt: at }),
  z.object({ kind: z.literal('report_card'), id: z.string(), studentName: z.string(), to: z.string(), subject: z.string(), body: z.string(), createdAt: at }),
  z.object({ kind: z.literal('billing'), id: z.string(), studentName: z.string(), urgency: Urgency, note: z.string(), amount: z.number().nullable(), createdAt: at }),
  z.object({ kind: z.literal('unassigned_note'), id: z.string(), heard: z.string().nullable(), text: z.string(), createdAt: at }),
  z.object({ kind: z.literal('deck_diff'), id: z.string(), deckId: z.string(), requestText: z.string(), diff: DeckDiff, createdAt: at }),
])
export type ReviewItem = z.infer<typeof ReviewItem>

export const ReportCardContent = z.object({
  strengths: z.array(z.string()).max(3),
  workingOn: z.array(z.string()).max(3),
  coachNotes: z.array(z.object({ date: z.string(), drill: z.string(), quote: z.string() })).max(4),
  attendance: z.string(),
  nextGoal: z.string(),
})
export type ReportCardContent = z.infer<typeof ReportCardContent>

export const StudentDetail = z.object({
  id: z.string(),
  name: z.string(),
  belt: z.string(),
  age: z.number().int(),
  classCount: z.number().int(),
  issues: z.array(z.object({ tag: SkillTag, status: z.enum(['open', 'resolved']) })),
  notes: z.array(z.object({ date: z.string(), drillName: z.string().nullable(), text: z.string() })),
  reportCard: z.object({ id: z.string(), month: z.string(), content: ReportCardContent, outboxId: z.string(), status: z.string() }).nullable(),
})
export type StudentDetail = z.infer<typeof StudentDetail>
```

`shared/src/index.ts`:
```ts
export * from './contracts'
```

- [ ] **Step 4: Run tests**

Run: `npm test -w shared && npm run typecheck -w shared`
Expected: 4 tests PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat: shared zod contracts for api and app

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: DB schema, migrations, PGlite test harness, Deps

**Files:**
- Create: `api/src/db/schema.ts`, `api/src/db/client.ts`, `api/drizzle.config.ts`, `api/src/deps.ts`, `api/src/test/helpers.ts`
- Generate: `api/drizzle/*.sql`
- Test: `api/src/db/schema.test.ts`

**Interfaces:**
- Consumes: `SkillTag`, `Urgency`, `DeckDiff`, `ReportCardContent` from `@matside/shared`.
- Produces:
  - **Tables:** `instructors, classes, students, guardians, enrollments, curriculum, sessions, attendance, decks, drills, deckDiffs, utterances, notes, issues, billingFlags, outbox, reportCards, agentRuns, preferences`.
  - **`client.ts`:** `type Db`.
  - **`deps.ts`:**
    - interfaces `Llm`, `Transcriber`, `Mailer`, `Env`, `Deps`;
    - `Llm.object<T>({ name, instructions, prompt, schema }): Promise<T>`;
    - `Transcriber.transcribe(wav: Uint8Array, hints: string[]): Promise<string>`;
    - `Mailer.send({ to, subject, text }): Promise<{ id: string }>`;
    - `Deps = { db, llm, stt, mail, now(): Date, defer(p: Promise<unknown>): void, env: Env }`.
  - **`test/helpers.ts`:** `makeTestDb(): Promise<Db>`; `makeDeps(db, over?: Partial<Deps>): TestDeps` with `TestDeps = Deps & { deferred: Promise<unknown>[]; sent: MailMsg[]; flush(): Promise<void> }`; `fakeLlm(handler: (a: { name: string; prompt: string }) => unknown): Llm`.

- [ ] **Step 1: Install the PGlite test dependency**

Run: `npm install -w api` (dependencies were declared in Task 1; this confirms they're present).

- [ ] **Step 2: Write the schema**

`api/src/db/schema.ts`:
```ts
import { pgTable, text, integer, real, timestamp, jsonb, primaryKey } from 'drizzle-orm/pg-core'
import type { SkillTag, Urgency, DeckDiff, ReportCardContent } from '@matside/shared'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => ts('created_at').notNull().defaultNow()

export const instructors = pgTable('instructors', {
  id: id(), name: text('name').notNull(), email: text('email').notNull(), tokenHash: text('token_hash'),
})
export const classes = pgTable('classes', {
  id: id(), instructorId: text('instructor_id').notNull(), name: text('name').notNull(),
  weekday: integer('weekday').notNull(), // 0 = Sunday
  startTime: text('start_time').notNull(), // "17:00"
  remindIds: jsonb('remind_ids').$type<string[]>().notNull().default([]),
})
export const students = pgTable('students', {
  id: id(), name: text('name').notNull(), nickname: text('nickname'), belt: text('belt').notNull(), birthYear: integer('birth_year').notNull(),
})
export const guardians = pgTable('guardians', {
  id: id(), studentId: text('student_id').notNull(), name: text('name').notNull(), email: text('email').notNull(),
})
export const enrollments = pgTable('enrollments', {
  classId: text('class_id').notNull(), studentId: text('student_id').notNull(),
}, t => [primaryKey({ columns: [t.classId, t.studentId] })])
export const curriculum = pgTable('curriculum', {
  weekStart: text('week_start').primaryKey(), // Monday, YYYY-MM-DD
  theme: text('theme').notNull(),
  formsDue: jsonb('forms_due').$type<string[]>().notNull(),
})
export const sessions = pgTable('sessions', {
  id: id(), classId: text('class_id').notNull(), deckId: text('deck_id').notNull(),
  forDate: text('for_date').notNull(),
  startedAt: ts('started_at').notNull(), endedAt: ts('ended_at'),
  remindIds: jsonb('remind_ids').$type<string[]>().notNull().default([]),
})
export const attendance = pgTable('attendance', {
  sessionId: text('session_id').notNull(), studentId: text('student_id').notNull(),
  status: text('status').$type<'present' | 'absent'>().notNull(),
  source: text('source').$type<'voice' | 'phone' | 'backstop'>().notNull(),
}, t => [primaryKey({ columns: [t.sessionId, t.studentId] })])
export const decks = pgTable('decks', {
  id: id(), classId: text('class_id').notNull(), forDate: text('for_date').notNull(),
  status: text('status').$type<'draft' | 'active' | 'done'>().notNull().default('draft'),
})
export const drills = pgTable('drills', {
  id: id(), deckId: text('deck_id').notNull(), position: integer('position').notNull(),
  name: text('name').notNull(), minutes: integer('minutes').notNull(),
  kind: text('kind').$type<'warmup' | 'technique' | 'drill' | 'forms' | 'game' | 'sparring'>().notNull(),
  cues: jsonb('cues').$type<string[]>().notNull().default([]),
  focusStudentIds: jsonb('focus_student_ids').$type<string[]>().notNull().default([]),
  rationale: text('rationale').notNull().default(''),
  startedAt: ts('started_at'), endedAt: ts('ended_at'),
})
export const deckDiffs = pgTable('deck_diffs', {
  id: id(), deckId: text('deck_id').notNull(), requestText: text('request_text').notNull(),
  diff: jsonb('diff').$type<DeckDiff>().notNull(),
  status: text('status').$type<'pending' | 'accepted' | 'undone'>().notNull().default('pending'),
  createdAt: createdAt(),
})
export const utterances = pgTable('utterances', {
  id: id(), sessionId: text('session_id'), transcript: text('transcript').notNull(),
  mode: text('mode').$type<'note' | 'attendance'>().notNull(), createdAt: createdAt(),
})
export const notes = pgTable('notes', {
  id: id(), sessionId: text('session_id'), utteranceId: text('utterance_id'), studentId: text('student_id'),
  heard: text('heard'), drillId: text('drill_id'), text: text('text').notNull(),
  tags: jsonb('tags').$type<SkillTag[]>().notNull().default([]), createdAt: createdAt(),
})
export const issues = pgTable('issues', {
  id: id(), studentId: text('student_id').notNull(), tag: text('tag').$type<SkillTag>().notNull(),
  status: text('status').$type<'open' | 'resolved'>().notNull().default('open'), openedAt: createdAt(),
})
export const billingFlags = pgTable('billing_flags', {
  id: id(), studentId: text('student_id'), utteranceId: text('utterance_id'),
  urgency: text('urgency').$type<Urgency>().notNull(), note: text('note').notNull(), amount: real('amount'),
  status: text('status').$type<'open' | 'handled'>().notNull().default('open'), createdAt: createdAt(),
})
export const outbox = pgTable('outbox', {
  id: id(), kind: text('kind').$type<'parent_email' | 'report_card'>().notNull(),
  studentId: text('student_id').notNull(), sessionId: text('session_id'), toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(), body: text('body').notNull(),
  status: text('status').$type<'pending_review' | 'sent' | 'skipped' | 'error'>().notNull().default('pending_review'),
  error: text('error'), sentAt: ts('sent_at'), createdAt: createdAt(),
})
export const reportCards = pgTable('report_cards', {
  id: id(), studentId: text('student_id').notNull(), month: text('month').notNull(),
  content: jsonb('content').$type<ReportCardContent>().notNull(), outboxId: text('outbox_id').notNull(),
})
export const agentRuns = pgTable('agent_runs', {
  id: id(), sessionId: text('session_id'), agent: text('agent').notNull(), trigger: text('trigger').notNull(),
  summary: text('summary').notNull(), reason: text('reason').notNull(), output: jsonb('output'),
  status: text('status').$type<'ok' | 'error'>().notNull(), ms: integer('ms').notNull(), createdAt: createdAt(),
})
export const preferences = pgTable('preferences', {
  id: id(), classId: text('class_id').notNull(), text: text('text').notNull(), createdAt: createdAt(),
})
```

`api/src/db/client.ts`:
```ts
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type * as schema from './schema'
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>
```

`api/drizzle.config.ts`:
```ts
import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost/unused' },
})
```

- [ ] **Step 3: Generate the migration**

Run: `cd api && npx drizzle-kit generate && ls drizzle`
Expected: one `0000_*.sql` file plus `meta/`.

- [ ] **Step 4: Deps + test helpers**

`api/src/deps.ts`:
```ts
import type { z } from 'zod'
import type { Db } from './db/client'

export interface Llm {
  object<T>(args: { name: string; instructions: string; prompt: string; schema: z.ZodType<T> }): Promise<T>
}
export interface Transcriber { transcribe(wav: Uint8Array, hints: string[]): Promise<string> }
export interface MailMsg { to: string; subject: string; text: string }
export interface Mailer { send(m: MailMsg): Promise<{ id: string }> }
export interface Env {
  pairingCode: string
  cronSecret: string
  allowedOrigins: string[] // ['*'] allowed in dev only
  demoEmailOverride: string | null
  instructorName: string
  timeZone: string // 'America/Los_Angeles'
}
export interface Deps {
  db: Db
  llm: Llm
  stt: Transcriber
  mail: Mailer
  now: () => Date
  defer: (p: Promise<unknown>) => void
  env: Env
}
```

`api/src/test/helpers.ts`:
```ts
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import * as schema from '../db/schema'
import type { Db } from '../db/client'
import type { Deps, Llm, MailMsg } from '../deps'

export async function makeTestDb(): Promise<Db> {
  const client = new PGlite()
  const db = drizzle({ client, schema })
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  return db as unknown as Db
}

export function fakeLlm(handler: (a: { name: string; prompt: string }) => unknown): Llm {
  return { async object({ name, prompt, schema }) { return schema.parse(await handler({ name, prompt })) } }
}

export type TestDeps = Deps & { deferred: Promise<unknown>[]; sent: MailMsg[]; flush(): Promise<void> }

export function makeDeps(db: Db, over: Partial<Deps> = {}): TestDeps {
  const deferred: Promise<unknown>[] = []
  const sent: MailMsg[] = []
  return {
    db,
    llm: fakeLlm(() => { throw new Error('llm not stubbed') }),
    stt: { async transcribe() { return 'stub transcript' } },
    mail: { async send(m) { sent.push(m); return { id: `mail_${sent.length}` } } },
    now: () => new Date('2026-10-20T00:30:00Z'), // Mon 2026-10-19 5:30 PM PT
    defer: p => { deferred.push(p) },
    env: { pairingCode: '4242', cronSecret: 'cron', allowedOrigins: ['*'], demoEmailOverride: null, instructorName: 'Coach Galen', timeZone: 'America/Los_Angeles' },
    deferred,
    sent,
    async flush() { while (deferred.length) await Promise.all(deferred.splice(0)) },
    ...over,
  }
}
```

- [ ] **Step 5: Write the failing schema test**

`api/src/db/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb } from '../test/helpers'
import { students, notes } from './schema'

describe('schema', () => {
  it('migrates and round-trips rows with jsonb tags', async () => {
    const db = await makeTestDb()
    const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
    await db.insert(notes).values({ studentId: s!.id, text: 'guard drops', tags: ['guard'] })
    const rows = await db.select().from(notes).where(eq(notes.studentId, s!.id))
    expect(rows[0]!.tags).toEqual(['guard'])
  })
})
```

- [ ] **Step 6: Run the test**

Run: `npm test -w api`
Expected: PASS. If it fails on the migrations path, print `fileURLToPath(new URL('../../drizzle', import.meta.url))` and fix the relative path.

- [ ] **Step 7: Commit**

```bash
git add api
git commit -m "feat(api): drizzle schema, migrations, pglite test harness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure logic modules (TDD)

**Files:**
- Create: `api/src/logic/names.ts`, `attendance.ts`, `recurring.ts`, `ranking.ts`, `deckDiff.ts`, `cardLines.ts`, `dates.ts`
- Test: `api/src/logic/logic.test.ts`

**Interfaces:**
- Consumes: `RosterStudent`, `StudentRef`, `NextStudent`, `DeckDiff`, `DrillDraft`, `SkillTag`, `Urgency` (shared).
- Produces:
  - **`names.ts`:**
    - `jaroWinkler(a, b): number`
    - `resolveName(heard: string, roster: RosterStudent[]): NameMatch`, where `NameMatch = { kind: 'match'; student: RosterStudent } | { kind: 'ambiguous'; options: [StudentRef, StudentRef] } | { kind: 'none' }`
  - **`attendance.ts`:** `parseAttendance(t: string): { kind: 'except'; names: string[] } | { kind: 'all' } | null`
  - **`recurring.ts`:** `RECURRING_THRESHOLD = 3`, `RECURRING_WINDOW_DAYS = 30`, `isRecurring(countInWindow: number, hasOpenIssue: boolean): boolean`
  - **`ranking.ts`:** `rankNextStudent(i: RankInput): NextStudent | null`, where `RankInput = { present: StudentRef[]; notedIds: Set<string>; remindIds: Set<string>; openIssue: Map<string, SkillTag>; lastNoteAt: Map<string, Date>; now: Date }`
  - **`deckDiff.ts`:**
    - `applyDiff(drills: ExistingDrill[], diff: DeckDiff): PlannedDrill[]`, where `ExistingDrill = DrillDraft & { id: string; position: number }` and `PlannedDrill = DrillDraft & { id: string | null }` (positions = array order)
    - `totalMinutes(d: { minutes: number }[]): number`
  - **`cardLines.ts`:** `type CardAction`, `buildCardLines(actions: CardAction[]): string[]` (≤4 lines, ≤38 chars each)
  - **`dates.ts`:**
    - `localDate(d: Date, tz: string): string` (YYYY-MM-DD)
    - `localWeekday(d: Date, tz: string): number` (0 = Sun)
    - `weekStart(date: string): string` (that week's Monday)
    - `nextDateForWeekday(fromDate: string, weekday: number): string` (strictly after `fromDate`)
    - `addDays(date: string, n: number): string`

- [ ] **Step 1: Write failing tests**

`api/src/logic/logic.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { resolveName, jaroWinkler } from './names'
import { parseAttendance } from './attendance'
import { isRecurring } from './recurring'
import { rankNextStudent } from './ranking'
import { applyDiff, totalMinutes } from './deckDiff'
import { buildCardLines } from './cardLines'
import { localDate, localWeekday, weekStart, nextDateForWeekday, addDays } from './dates'

const roster = [
  { id: 's1', name: 'Priya Rao', nickname: null, belt: 'orange' },
  { id: 's2', name: 'Maya Chen', nickname: null, belt: 'yellow' },
  { id: 's3', name: 'Mia Lopez', nickname: null, belt: 'white' },
  { id: 's4', name: 'Leonardo Diaz', nickname: 'Leo', belt: 'yellow' },
]

describe('names', () => {
  it('jaroWinkler is 1 for equal strings and 0 for empty', () => {
    expect(jaroWinkler('priya', 'priya')).toBe(1)
    expect(jaroWinkler('', 'priya')).toBe(0)
  })
  it('matches exact first names, nicknames and close misspellings', () => {
    expect(resolveName('Priya', roster)).toMatchObject({ kind: 'match', student: { id: 's1' } })
    expect(resolveName("Leo's", roster)).toMatchObject({ kind: 'match', student: { id: 's4' } })
    expect(resolveName('Pria', roster)).toMatchObject({ kind: 'match', student: { id: 's1' } })
  })
  it('returns two options when ambiguous', () => {
    const r = resolveName('Mya', roster)
    expect(r.kind).toBe('ambiguous')
    if (r.kind === 'ambiguous') expect(r.options.map(o => o.id).sort()).toEqual(['s2', 's3'])
  })
  it('returns none for unknown names', () => {
    expect(resolveName('Bob', roster)).toEqual({ kind: 'none' })
  })
})

describe('attendance', () => {
  it('parses everyone except', () => {
    expect(parseAttendance('Everyone except Jake and Mia')).toEqual({ kind: 'except', names: ['Jake', 'Mia'] })
    expect(parseAttendance("everybody's here but Jake, Mia, and Leo.")).toEqual({ kind: 'except', names: ['Jake', 'Mia', 'Leo'] })
  })
  it('parses everyone here', () => {
    expect(parseAttendance("Everyone's here")).toEqual({ kind: 'all' })
  })
  it('returns null for other speech', () => {
    expect(parseAttendance('Priya guard drops')).toBeNull()
  })
})

describe('recurring', () => {
  it('opens on the third note when no issue is open', () => {
    expect(isRecurring(2, false)).toBe(false)
    expect(isRecurring(3, false)).toBe(true)
    expect(isRecurring(4, true)).toBe(false)
  })
})

describe('ranking', () => {
  const now = new Date('2026-10-20T00:00:00Z')
  const present = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cal' }, { id: 'd', name: 'Dee' }]
  const base = { present, notedIds: new Set<string>(), remindIds: new Set<string>(), openIssue: new Map(), lastNoteAt: new Map(), now }
  it('prefers reminded, then open issue, then oldest note', () => {
    expect(rankNextStudent({ ...base, remindIds: new Set(['c']) })).toEqual({ id: 'c', name: 'Cal', reason: 'missed last class' })
    expect(rankNextStudent({ ...base, openIssue: new Map([['b', 'guard']]) })).toEqual({ id: 'b', name: 'Ben', reason: 'guard' })
    const lastNoteAt = new Map([['a', new Date('2026-10-18T00:00:00Z')], ['b', new Date('2026-10-01T00:00:00Z')], ['c', new Date('2026-10-10T00:00:00Z')], ['d', new Date('2026-10-12T00:00:00Z')]])
    expect(rankNextStudent({ ...base, lastNoteAt })).toEqual({ id: 'b', name: 'Ben', reason: '19 days since note' })
  })
  it('says no notes yet and skips noted students; null when all noted', () => {
    expect(rankNextStudent({ ...base, notedIds: new Set(['a']) })).toMatchObject({ id: 'b', reason: 'no notes yet' })
    expect(rankNextStudent({ ...base, notedIds: new Set(['a', 'b', 'c', 'd']) })).toBeNull()
  })
})

describe('deckDiff', () => {
  const d = (id: string, position: number, name: string, minutes = 5) => ({ id, position, name, minutes, kind: 'drill' as const, cues: [], focusStudentIds: [], rationale: '' })
  it('removes, changes, and inserts in order', () => {
    const drills = [d('x1', 1, 'Tag'), d('x2', 2, 'Holds'), d('x3', 3, 'Sharks')]
    const out = applyDiff(drills, {
      removed: [{ drillId: 'x3', reason: 'too wild' }],
      changed: [{ drillId: 'x1', after: { ...d('x1', 1, 'Line drills'), id: undefined } as never, reason: 'structure' }],
      added: [{ name: 'Sparring', minutes: 8, kind: 'sparring', cues: [], focusStudentIds: [], rationale: '', afterPosition: 2, reason: 'green belts' },
              { name: 'Bow-in', minutes: 1, kind: 'warmup', cues: [], focusStudentIds: [], rationale: '', afterPosition: 0, reason: 'reset' }],
      rememberSuggestion: null,
    })
    expect(out.map(x => x.name)).toEqual(['Bow-in', 'Line drills', 'Holds', 'Sparring'])
    expect(out.map(x => x.id)).toEqual([null, 'x1', 'x2', null])
    expect(totalMinutes(out)).toBe(1 + 5 + 5 + 8)
  })
})

describe('cardLines', () => {
  it('builds the recurring feedback card', () => {
    expect(buildCardLines([{ kind: 'feedback', name: 'Priya', tag: 'guard', count: 3, recurring: true }]))
      .toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ parent note drafting', '→ added to next deck'])
  })
  it('combines feedback and billing and caps at 4 lines', () => {
    const lines = buildCardLines([
      { kind: 'feedback', name: 'Sam', tag: 'forms', count: 1, recurring: false },
      { kind: 'billing', name: 'Leo', urgency: 'high' },
      { kind: 'feedback', name: 'Ava', tag: 'forms', count: 1, recurring: false },
      { kind: 'feedback', name: 'Ben', tag: 'kicks', count: 3, recurring: true },
    ])
    expect(lines).toEqual(['✓ Sam · forms', '✓ Billing flag · Leo · HIGH', '✓ Ava · forms', '+1 more'])
  })
  it('formats attendance', () => {
    expect(buildCardLines([{ kind: 'attendance', present: 12, absentNames: ['Jake', 'Mia'] }])).toEqual(['12 present', 'absent: Jake, Mia'])
  })
})

describe('dates', () => {
  it('computes local date/weekday in a time zone', () => {
    const d = new Date('2026-10-20T00:30:00Z') // Mon Oct 19, 5:30 PM PT
    expect(localDate(d, 'America/Los_Angeles')).toBe('2026-10-19')
    expect(localWeekday(d, 'America/Los_Angeles')).toBe(1)
  })
  it('date arithmetic', () => {
    expect(weekStart('2026-10-22')).toBe('2026-10-19')
    expect(weekStart('2026-10-19')).toBe('2026-10-19')
    expect(nextDateForWeekday('2026-10-20', 2)).toBe('2026-10-27')
    expect(nextDateForWeekday('2026-10-19', 4)).toBe('2026-10-22')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- logic`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the modules**

`api/src/logic/names.ts`:
```ts
import type { RosterStudent, StudentRef } from '@matside/shared'

export const AUTO_MATCH = 0.88
export const AMBIGUOUS = 0.75

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aM = new Array<boolean>(la).fill(false)
  const bM = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb)
    for (let j = lo; j < hi; j++) {
      if (!bM[j] && a[i] === b[j]) { aM[i] = true; bM[j] = true; matches++; break }
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3
  let p = 0
  while (p < 4 && p < la && p < lb && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

const norm = (s: string) => s.toLowerCase().replace(/'s\b/g, '').replace(/[^a-z\s-]/g, '').trim()

function scoreStudent(heard: string, s: RosterStudent): number {
  const h = norm(heard)
  const candidates = [s.name, s.name.split(' ')[0] ?? s.name, s.nickname ?? ''].map(norm).filter(Boolean)
  return Math.max(...candidates.map(c => jaroWinkler(h, c)))
}

export type NameMatch =
  | { kind: 'match'; student: RosterStudent }
  | { kind: 'ambiguous'; options: [StudentRef, StudentRef] }
  | { kind: 'none' }

export function resolveName(heard: string, roster: RosterStudent[]): NameMatch {
  const ranked = roster.map(s => ({ s, score: scoreStudent(heard, s) })).sort((x, y) => y.score - x.score)
  const [best, second] = ranked
  if (!best || best.score < AMBIGUOUS) return { kind: 'none' }
  if (best.score >= AUTO_MATCH && (!second || second.score < AUTO_MATCH)) return { kind: 'match', student: best.s }
  if (!second) return { kind: 'match', student: best.s }
  return { kind: 'ambiguous', options: [{ id: best.s.id, name: best.s.name }, { id: second.s.id, name: second.s.name }] }
}
```

`api/src/logic/attendance.ts`:
```ts
const EXCEPT = /^(?:everyone|everybody|all)(?:'s|\s+is|\s+are)?(?:\s+(?:here|present))?,?\s+(?:except(?:\s+for)?|but)\s+(.+?)[.!]?$/i
const ALL = /^(?:everyone|everybody|all)(?:'s|\s+is|\s+are)?\s+(?:here|present)[.!]?$/i

export function splitNames(list: string): string[] {
  return list.split(/,|\band\b|&/i).map(s => s.trim()).filter(Boolean)
}

export function parseAttendance(t: string): { kind: 'except'; names: string[] } | { kind: 'all' } | null {
  const s = t.trim()
  const m = EXCEPT.exec(s)
  if (m?.[1]) return { kind: 'except', names: splitNames(m[1]) }
  if (ALL.test(s)) return { kind: 'all' }
  return null
}
```

`api/src/logic/recurring.ts`:
```ts
export const RECURRING_THRESHOLD = 3
export const RECURRING_WINDOW_DAYS = 30
export function isRecurring(countInWindow: number, hasOpenIssue: boolean): boolean {
  return countInWindow >= RECURRING_THRESHOLD && !hasOpenIssue
}
```

`api/src/logic/ranking.ts`:
```ts
import type { NextStudent, SkillTag, StudentRef } from '@matside/shared'

export interface RankInput {
  present: StudentRef[]
  notedIds: Set<string>
  remindIds: Set<string>
  openIssue: Map<string, SkillTag>
  lastNoteAt: Map<string, Date>
  now: Date
}

const DAY = 86_400_000

export function rankNextStudent(i: RankInput): NextStudent | null {
  const eligible = i.present.filter(s => !i.notedIds.has(s.id))
  if (!eligible.length) return null
  const key = (s: StudentRef) => [i.remindIds.has(s.id) ? 0 : 1, i.openIssue.has(s.id) ? 0 : 1, i.lastNoteAt.get(s.id)?.getTime() ?? 0] as const
  const sorted = [...eligible].sort((a, b) => {
    const x = key(a), y = key(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
  const s = sorted[0]!
  const last = i.lastNoteAt.get(s.id)
  const reason = i.remindIds.has(s.id) ? 'missed last class'
    : i.openIssue.get(s.id) ?? (last ? `${Math.floor((i.now.getTime() - last.getTime()) / DAY)} days since note` : 'no notes yet')
  return { id: s.id, name: s.name, reason }
}
```

`api/src/logic/deckDiff.ts`:
```ts
import type { DeckDiff, DrillDraft } from '@matside/shared'

export type ExistingDrill = DrillDraft & { id: string; position: number }
export type PlannedDrill = DrillDraft & { id: string | null }

const draftOf = (d: DrillDraft): DrillDraft => ({ name: d.name, minutes: d.minutes, kind: d.kind, cues: d.cues, focusStudentIds: d.focusStudentIds, rationale: d.rationale })

export function applyDiff(drills: ExistingDrill[], diff: DeckDiff): PlannedDrill[] {
  const removed = new Set(diff.removed.map(r => r.drillId))
  const changed = new Map(diff.changed.map(c => [c.drillId, c.after]))
  const kept = [...drills].sort((a, b) => a.position - b.position).filter(d => !removed.has(d.id))
  const out: (PlannedDrill & { origPos: number })[] = kept.map(d => ({ ...draftOf(changed.get(d.id) ?? d), id: d.id, origPos: d.position }))
  const adds = [...diff.added].sort((a, b) => b.afterPosition - a.afterPosition)
  for (const a of adds) {
    const item = { ...draftOf(a), id: null, origPos: -1 }
    if (a.afterPosition === 0) { out.unshift(item); continue }
    const idx = out.findIndex(x => x.origPos === a.afterPosition)
    if (idx === -1) out.push(item)
    else out.splice(idx + 1, 0, item)
  }
  return out.map(({ origPos: _o, ...rest }) => rest)
}

export function totalMinutes(d: { minutes: number }[]): number {
  return d.reduce((n, x) => n + x.minutes, 0)
}
```

Note: when several drills are added after the same position, processing them in descending `afterPosition` order keeps their relative order stable enough for the demo.

`api/src/logic/cardLines.ts`:
```ts
import type { SkillTag, Urgency } from '@matside/shared'

export type CardAction =
  | { kind: 'feedback'; name: string; tag: SkillTag | null; count: number; recurring: boolean }
  | { kind: 'billing'; name: string; urgency: Urgency }
  | { kind: 'attendance'; present: number; absentNames: string[] }
  | { kind: 'marked'; name: string; status: 'present' | 'absent' }
  | { kind: 'parent_note'; name: string }
  | { kind: 'plan_request' }
  | { kind: 'add_drill'; name: string; minutes: number }
  | { kind: 'unassigned' }
  | { kind: 'saved_unsorted' }

const MAX_LINES = 4
const MAX_CHARS = 38
const ordinal = (n: number) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s)

function linesFor(a: CardAction): string[] {
  switch (a.kind) {
    case 'feedback': {
      const head = `✓ ${a.name}${a.tag ? ` · ${a.tag}` : ''}${a.count >= 2 ? ` (${ordinal(a.count)} time)` : ''}`
      return a.recurring ? [head, '→ progress logged', '→ parent note drafting', '→ added to next deck'] : [head]
    }
    case 'billing': return [`✓ Billing flag · ${a.name} · ${a.urgency.toUpperCase()}`]
    case 'attendance': return [`${a.present} present`, ...(a.absentNames.length ? [`absent: ${a.absentNames.join(', ')}`] : [])]
    case 'marked': return [`✓ ${a.name} marked ${a.status}`]
    case 'parent_note': return [`→ parent note for ${a.name} drafting`]
    case 'plan_request': return ['✓ Planner: next deck suggestion queued']
    case 'add_drill': return [`✓ Added: ${a.name} · ${a.minutes}m`]
    case 'unassigned': return ['● Saved · pick student in Review']
    case 'saved_unsorted': return ['● Saved · sorting failed, see Review']
  }
}

export function buildCardLines(actions: CardAction[]): string[] {
  const groups = actions.map(linesFor)
  const total = groups.reduce((n, g) => n + g.length, 0)
  if (total <= MAX_LINES) return groups.flat().map(clip)
  // Over budget: keep whole groups while leaving the last line for "+N more".
  const out: string[] = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!
    if (out.length + g.length <= MAX_LINES - 1) { out.push(...g); continue }
    if (out.length === 0) return g.slice(0, MAX_LINES).map(clip)
    out.push(`+${groups.length - i} more`)
    break
  }
  return out.map(clip)
}
```

`api/src/logic/dates.ts`:
```ts
export function localDate(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
export function localWeekday(d: Date, tz: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}
const toUtc = (date: string) => new Date(`${date}T12:00:00Z`)
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export function addDays(date: string, n: number): string {
  const d = toUtc(date); d.setUTCDate(d.getUTCDate() + n); return fmt(d)
}
export function weekStart(date: string): string {
  const dow = toUtc(date).getUTCDay()
  return addDays(date, dow === 0 ? -6 : 1 - dow)
}
export function nextDateForWeekday(fromDate: string, weekday: number): string {
  const dow = toUtc(fromDate).getUTCDay()
  const delta = ((weekday - dow + 7) % 7) || 7
  return addDays(fromDate, delta)
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w api -- logic`
Expected: all PASS. If a `resolveName` case fails, print the scores with `console.log(roster.map(s => [s.name, jaroWinkler('mya', s.name.split(' ')[0]!.toLowerCase())]))` and confirm Maya ≈0.825 and Mia ≈0.80 (both in the ambiguous band). Fix the implementation, not the thresholds.

- [ ] **Step 5: Commit**

```bash
git add api/src/logic
git commit -m "feat(api): pure logic for names, attendance, recurrence, ranking, deck diff, card lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: LLM layer, run log, Router agent, evals

**Files:**
- Create: `api/src/agents/llm.ts`, `api/src/agents/runs.ts`, `api/src/agents/router.ts`, `api/evals/router-cases.json`, `api/evals/run-router.ts`
- Test: `api/src/agents/router.test.ts`

**Interfaces:**
- Consumes: `Deps`, `Llm` (Task 3); `RouterOutput`, `Intent`, `RosterStudent` (shared); `agentRuns` table.
- Produces:
  - **`llm.ts`:** `gatewayLlm(model?: string): Llm`, `MODEL = 'anthropic/claude-sonnet-5-5'`
  - **`runs.ts`:** `withRun<T>(deps, meta: { agent: string; trigger: string; sessionId: string | null }, fn: () => Promise<{ result: T; summary: string; reason: string; output?: unknown }>): Promise<T | null>`. Writes one `agent_runs` row with status ok or error; returns null on error.
  - **`router.ts`:** `routeUtterance(deps, a: { sessionId: string; transcript: string; roster: RosterStudent[]; drillName: string | null; theme: string }): Promise<Intent[] | null>`

- [ ] **Step 1: Write the failing test**

`api/src/agents/router.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { routeUtterance } from './router'
import { withRun } from './runs'
import { agentRuns } from '../db/schema'

const roster = [{ id: 's1', name: 'Priya Rao', nickname: null, belt: 'orange' }]

describe('router', () => {
  it('returns intents and logs a run with the roster in the prompt', async () => {
    const db = await makeTestDb()
    let seenPrompt = ''
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name, prompt }) => {
        expect(name).toBe('router')
        seenPrompt = prompt
        return { intents: [{ type: 'feedback', studentNames: ['Priya'], content: 'guard drops', skillTags: ['guard'], urgency: null, amount: null, minutes: null, attendanceStatus: null }] }
      }),
    })
    const intents = await routeUtterance(deps, { sessionId: 'sess', transcript: 'Priya guard drops', roster, drillName: 'Jab drill', theme: 'Stances' })
    expect(intents?.[0]?.type).toBe('feedback')
    expect(seenPrompt).toContain('Priya Rao')
    const runs = await db.select().from(agentRuns)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ agent: 'router', status: 'ok', sessionId: 'sess' })
  })

  it('withRun records errors and returns null', async () => {
    const db = await makeTestDb()
    const deps = makeDeps(db)
    const r = await withRun(deps, { agent: 'x', trigger: 't', sessionId: null }, async () => { throw new Error('boom') })
    expect(r).toBeNull()
    const [run] = await db.select().from(agentRuns)
    expect(run).toMatchObject({ status: 'error', summary: 'boom' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- router`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`api/src/agents/llm.ts`:
```ts
import { generateText, Output } from 'ai'
import type { Llm } from '../deps'

export const MODEL = 'anthropic/claude-sonnet-5-5'

// Uses AI Gateway: plain "provider/model" strings; auth via AI_GATEWAY_API_KEY or Vercel OIDC.
export function gatewayLlm(model: string = MODEL): Llm {
  return {
    async object({ instructions, prompt, schema }) {
      const { output } = await generateText({ model, instructions, prompt, output: Output.object({ schema }) })
      return schema.parse(output)
    },
  }
}
```

`api/src/agents/runs.ts`:
```ts
import { agentRuns } from '../db/schema'
import type { Deps } from '../deps'

export async function withRun<T>(
  deps: Deps,
  meta: { agent: string; trigger: string; sessionId: string | null },
  fn: () => Promise<{ result: T; summary: string; reason: string; output?: unknown }>,
): Promise<T | null> {
  const t0 = Date.now()
  try {
    const r = await fn()
    await deps.db.insert(agentRuns).values({ ...meta, summary: r.summary, reason: r.reason, output: r.output ?? null, status: 'ok', ms: Date.now() - t0 })
    return r.result
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[agent:${meta.agent}]`, message)
    await deps.db.insert(agentRuns).values({ ...meta, summary: message.slice(0, 300), reason: 'error', output: null, status: 'error', ms: Date.now() - t0 })
    return null
  }
}
```

`api/src/agents/router.ts`:
```ts
import { RouterOutput, SKILL_TAGS, type Intent, type RosterStudent } from '@matside/shared'
import type { Deps } from '../deps'
import { withRun } from './runs'

export const ROUTER_INSTRUCTIONS = `You are the intake router for MatSide, a voice assistant used by a kids' martial arts instructor while teaching class.
Split the instructor's spoken utterance into one or more intents. Output every field; use [] or null when unused.
- feedback: an observation about one or more students' technique, effort or behavior. studentNames = names exactly as spoken. skillTags: 1-2 from [${SKILL_TAGS.join(', ')}]. content = the observation, lightly cleaned, in the instructor's voice. Praise counts as feedback.
- billing: money owed, payments, declined cards, fees, gear purchases. urgency: "high" if urgent/asap/overdue a while, "low" if casual, else "med". amount in dollars if spoken, else null. Never give financial advice.
- attendance: a student arrived, left, or is absent. attendanceStatus present|absent.
- plan_request: a request about a FUTURE class plan (e.g. "next class more sparring"). content = the request.
- parent_message: an explicit request to contact a student's parent/guardian. content = what to tell them.
- add_drill: adding a drill to TODAY's class. content = drill name; minutes if spoken.
- Injuries or pain: record only as a feedback observation (no diagnosis, no advice).
- One utterance can hold several intents, e.g. feedback for two students plus a billing note.`

export async function routeUtterance(
  deps: Deps,
  a: { sessionId: string; transcript: string; roster: RosterStudent[]; drillName: string | null; theme: string },
): Promise<Intent[] | null> {
  const prompt = [
    `Roster: ${a.roster.map(s => (s.nickname ? `${s.name} ("${s.nickname}")` : s.name)).join('; ')}`,
    `Current drill: ${a.drillName ?? 'none'}`,
    `Weekly theme: ${a.theme}`,
    `Utterance: """${a.transcript}"""`,
  ].join('\n')
  return withRun(deps, { agent: 'router', trigger: 'utterance', sessionId: a.sessionId }, async () => {
    const out = await deps.llm.object({ name: 'router', instructions: ROUTER_INSTRUCTIONS, prompt, schema: RouterOutput })
    return {
      result: out.intents,
      summary: `Sorted "${a.transcript.slice(0, 60)}" into ${out.intents.map(i => i.type).join(', ') || 'nothing'}`,
      reason: `${out.intents.length} intent(s)`,
      output: out,
    }
  })
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w api -- router`
Expected: PASS.

- [ ] **Step 5: Eval cases and runner (live, manual)**

`api/evals/router-cases.json`:
```json
[
  { "t": "Priya, guard drops on the jab again, great energy though", "types": ["feedback"], "names": ["Priya"] },
  { "t": "Sam and Ava, great kata today", "types": ["feedback"], "names": ["Sam", "Ava"] },
  { "t": "Leo's dad still owes for sparring gear, kinda urgent", "types": ["billing"], "names": ["Leo"], "urgency": "high" },
  { "t": "Maya's front stance is too short. Also her mom's card bounced.", "types": ["feedback", "billing"], "names": ["Maya"] },
  { "t": "Jake just walked in", "types": ["attendance"], "names": ["Jake"] },
  { "t": "Mia had to leave early", "types": ["attendance"], "names": ["Mia"] },
  { "t": "Next class let's do more sparring for the green belts", "types": ["plan_request"], "names": [] },
  { "t": "Email Ben's parents that he's ready to test for yellow belt", "types": ["parent_message"], "names": ["Ben"] },
  { "t": "Add partner tag, five minutes", "types": ["add_drill"], "names": [] },
  { "t": "Ava's kicks are getting way higher, super proud", "types": ["feedback"], "names": ["Ava"] },
  { "t": "Cal keeps talking during line-up, needs to work on focus", "types": ["feedback"], "names": ["Cal"] },
  { "t": "Dee rolled her ankle a little, sat out the last drill", "types": ["feedback"], "names": ["Dee"] },
  { "t": "Priya and Sam both dropping hands when tired, and remind me Sam owes twenty dollars for the patch", "types": ["feedback", "billing"], "names": ["Priya", "Sam"] },
  { "t": "Leo great respect bowing in", "types": ["feedback"], "names": ["Leo"] },
  { "t": "Pria guard better today", "types": ["feedback"], "names": ["Pria"] }
]
```

`api/evals/run-router.ts`:
```ts
import { readFileSync } from 'node:fs'
import { RouterOutput } from '@matside/shared'
import { gatewayLlm } from '../src/agents/llm'
import { ROUTER_INSTRUCTIONS } from '../src/agents/router'

type Case = { t: string; types: string[]; names: string[]; urgency?: string }
const cases: Case[] = JSON.parse(readFileSync(new URL('./router-cases.json', import.meta.url), 'utf8'))
const roster = 'Priya Rao; Sam Lee; Ava Kim; Leo Diaz ("Leo"); Maya Chen; Jake Ross; Mia Lopez; Ben Ortiz; Cal Wu; Dee Park'
const llm = gatewayLlm()
let pass = 0
for (const c of cases) {
  const out = await llm.object({ name: 'router', instructions: ROUTER_INSTRUCTIONS, schema: RouterOutput,
    prompt: `Roster: ${roster}\nCurrent drill: Guard-up jab drill\nWeekly theme: Stances\nUtterance: """${c.t}"""` })
  const types = [...new Set(out.intents.map(i => i.type))].sort()
  const names = [...new Set(out.intents.flatMap(i => i.studentNames))]
  const ok = JSON.stringify(types) === JSON.stringify([...c.types].sort())
    && c.names.every(n => names.some(x => x.toLowerCase().includes(n.toLowerCase())))
    && (!c.urgency || out.intents.some(i => i.urgency === c.urgency))
  if (ok) pass++
  console.log(ok ? 'PASS' : 'FAIL', c.t, ok ? '' : JSON.stringify(out.intents))
}
console.log(`${pass}/${cases.length}`)
if (pass < 13) process.exit(1)
```

Run later, once a gateway key exists (Task 13): `AI_GATEWAY_API_KEY=… npm run eval -w api`
Expected: ≥13/15 PASS. If not, tune `ROUTER_INSTRUCTIONS` only.

- [ ] **Step 6: Commit**

```bash
git add api/src/agents api/evals
git commit -m "feat(api): llm layer, agent run log, router agent with evals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Parent-email and Planner agents (drafting)

**Files:**
- Create: `api/src/agents/parentEmail.ts`, `api/src/agents/planner.ts`, `api/src/services/decks.ts`
- Test: `api/src/agents/agents.test.ts`

**Interfaces:**
- Consumes: `withRun` (Task 5); tables; `applyDiff`, `totalMinutes`, `localDate`, `weekStart`, `nextDateForWeekday` (Task 4); `DeckDiff`, `DrillDraft`, `Deck`, `SkillTag` (shared).
- Produces:
  - **`parentEmail.ts`:**
    - `draftParentEmail(deps, a: { studentId: string; sessionId: string | null; trigger: { kind: 'recurring'; tag: SkillTag } | { kind: 'request'; content: string } }): Promise<string | null>` (outbox id)
    - `PARENT_EMAIL_INSTRUCTIONS`
  - **`planner.ts`:**
    - `draftDeck(deps, classId: string, forDate: string): Promise<string | null>` (deck id; uses an existing deck if present)
    - `suggestDiff(deps, deckId: string, requestText: string, sessionId?: string | null): Promise<{ diffId: string; diff: DeckDiff } | null>`
    - `acceptDiff(deps, diffId: string, opts: { remember: boolean }): Promise<Deck>`
    - `nextDeckFor(deps, classId: string, afterDate: string): Promise<string | null>`
    - `autoAdjustNextDeck(deps, a: { classId: string; afterDate: string; requestText: string; sessionId: string | null }): Promise<void>`
  - **`services/decks.ts`:** `getDeck(db, deckId): Promise<Deck>`, `findDeck(db, classId, forDate): Promise<{ id: string } | undefined>`

- [ ] **Step 1: Write failing tests**

`api/src/agents/agents.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { draftParentEmail } from './parentEmail'
import { draftDeck, suggestDiff, acceptDiff } from './planner'
import { getDeck } from '../services/decks'
import { classes, students, guardians, enrollments, curriculum, notes, outbox, deckDiffs, preferences } from '../db/schema'

const drill = (name: string, minutes = 5) => ({ name, minutes, kind: 'drill', cues: ['knees out'], focusStudentIds: [], rationale: 'theme' })

async function world() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Tue', weekday: 2, startTime: '17:00' }).returning()
  const [s] = await db.insert(students).values({ name: 'Priya Rao', belt: 'orange', birthYear: 2018 }).returning()
  await db.insert(guardians).values({ studentId: s!.id, name: 'Anita Rao', email: 'anita@example.com' })
  await db.insert(enrollments).values({ classId: c!.id, studentId: s!.id })
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  await db.insert(notes).values({ studentId: s!.id, text: 'guard drops on jab', tags: ['guard'] })
  return { db, classId: c!.id, studentId: s!.id }
}

describe('parent email agent', () => {
  it('drafts a pending_review email to the guardian with notes in the prompt', async () => {
    const { db, studentId } = await world()
    let prompt = ''
    const deps = makeDeps(db, { llm: fakeLlm(a => { prompt = a.prompt; return { subject: "Priya's guard", body: 'Hi Anita, …' } }) })
    const id = await draftParentEmail(deps, { studentId, sessionId: null, trigger: { kind: 'recurring', tag: 'guard' } })
    expect(prompt).toContain('guard drops on jab')
    const [row] = await db.select().from(outbox).where(eq(outbox.id, id!))
    expect(row).toMatchObject({ status: 'pending_review', toEmail: 'anita@example.com', kind: 'parent_email' })
  })
})

describe('planner agent', () => {
  it('drafts a deck, suggests a diff, and accepts it with a remembered preference', async () => {
    const { db, classId } = await world()
    const deps = makeDeps(db, {
      llm: fakeLlm(({ name }) => name === 'planner.draft'
        ? { drills: ['Tag', 'Holds', 'Jab', 'Kata 2', 'Sharks', 'Kicks', 'Pads', 'Bow out'].map(n => drill(n)) }
        : { added: [{ ...drill('Sparring', 8), kind: 'sparring', afterPosition: 2, reason: 'green belts' }], changed: [], removed: [], rememberSuggestion: 'Tuesday kids need more structure' }),
    })
    const deckId = await draftDeck(deps, classId, '2026-10-20')
    expect((await getDeck(db, deckId!)).drills).toHaveLength(8)
    expect(await draftDeck(deps, classId, '2026-10-20')).toBe(deckId) // idempotent
    const s = await suggestDiff(deps, deckId!, 'add sparring')
    expect(s?.diff.added).toHaveLength(1)
    const deck = await acceptDiff(deps, s!.diffId, { remember: true })
    expect(deck.drills.map(d => d.name).slice(0, 3)).toEqual(['Tag', 'Holds', 'Sparring'])
    expect(deck.drills.map(d => d.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    const [diffRow] = await db.select().from(deckDiffs)
    expect(diffRow!.status).toBe('accepted')
    expect(await db.select().from(preferences)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- agents`
Expected: FAIL.

- [ ] **Step 3: Implement**

`api/src/services/decks.ts`:
```ts
import { and, asc, eq } from 'drizzle-orm'
import type { Deck } from '@matside/shared'
import type { Db } from '../db/client'
import { decks, drills } from '../db/schema'

export async function findDeck(db: Db, classId: string, forDate: string) {
  const [d] = await db.select({ id: decks.id }).from(decks).where(and(eq(decks.classId, classId), eq(decks.forDate, forDate)))
  return d
}

export async function getDeck(db: Db, deckId: string): Promise<Deck> {
  const [d] = await db.select().from(decks).where(eq(decks.id, deckId))
  if (!d) throw new Error(`deck ${deckId} not found`)
  const rows = await db.select().from(drills).where(eq(drills.deckId, deckId)).orderBy(asc(drills.position))
  return {
    id: d.id, classId: d.classId, forDate: d.forDate, status: d.status,
    drills: rows.map(r => ({
      id: r.id, position: r.position, name: r.name, minutes: r.minutes, kind: r.kind, cues: r.cues,
      focusStudentIds: r.focusStudentIds, rationale: r.rationale,
      startedAt: r.startedAt?.toISOString() ?? null, endedAt: r.endedAt?.toISOString() ?? null,
    })),
  }
}
```

`api/src/agents/parentEmail.ts`:
```ts
import { and, desc, eq, gte } from 'drizzle-orm'
import { z } from 'zod'
import type { SkillTag } from '@matside/shared'
import type { Deps } from '../deps'
import { drills, guardians, issues, notes, outbox, students } from '../db/schema'
import { withRun } from './runs'

export const PARENT_EMAIL_INSTRUCTIONS = `You write short emails from a kids' martial arts instructor to a student's parent.
- 80-140 words, plain text, warm and specific. Open with something genuinely positive from the notes.
- Explain the one thing being worked on, referencing the actual drill(s) from the notes.
- Give exactly one fun at-home tip (under 5 minutes, safe, no equipment).
- Never mention other students. No medical or financial advice. No guilt or pressure.
- Sign off as the coach name given.`

const EmailOut = z.object({ subject: z.string().min(3).max(80), body: z.string().min(40) })
const DAY = 86_400_000

export async function draftParentEmail(
  deps: Deps,
  a: { studentId: string; sessionId: string | null; trigger: { kind: 'recurring'; tag: SkillTag } | { kind: 'request'; content: string } },
): Promise<string | null> {
  const { db } = deps
  return withRun(deps, { agent: 'parent_email', trigger: a.trigger.kind, sessionId: a.sessionId }, async () => {
    const [s] = await db.select().from(students).where(eq(students.id, a.studentId))
    const [g] = await db.select().from(guardians).where(eq(guardians.studentId, a.studentId))
    if (!s || !g) throw new Error(`no student/guardian for ${a.studentId}`)
    const since = new Date(deps.now().getTime() - 30 * DAY)
    const recent = await db.select({ text: notes.text, at: notes.createdAt, drill: drills.name })
      .from(notes).leftJoin(drills, eq(drills.id, notes.drillId))
      .where(and(eq(notes.studentId, a.studentId), gte(notes.createdAt, since))).orderBy(desc(notes.createdAt)).limit(8)
    const open = await db.select({ tag: issues.tag }).from(issues).where(and(eq(issues.studentId, a.studentId), eq(issues.status, 'open')))
    const firstName = s.name.split(' ')[0]
    const why = a.trigger.kind === 'recurring' ? `Recurring focus area: ${a.trigger.tag}` : `Instructor asked to tell the parent: ${a.trigger.content}`
    const prompt = [
      `Coach: ${deps.env.instructorName}`, `Student: ${firstName} (${s.belt} belt)`, `Parent: ${g.name}`, why,
      `Open focus areas: ${open.map(o => o.tag).join(', ') || 'none'}`,
      `Recent coach notes (newest first):`, ...recent.map(r => `- ${r.at.toISOString().slice(0, 10)} [${r.drill ?? 'class'}] ${r.text}`),
    ].join('\n')
    const email = await deps.llm.object({ name: 'parent_email', instructions: PARENT_EMAIL_INSTRUCTIONS, prompt, schema: EmailOut })
    const [row] = await db.insert(outbox).values({ kind: 'parent_email', studentId: s.id, sessionId: a.sessionId, toEmail: g.email, subject: email.subject, body: email.body }).returning()
    return { result: row!.id, summary: `Drafted note to ${g.name} (${firstName}): "${email.subject}"`, reason: why, output: email }
  })
}
```

`api/src/agents/planner.ts`:
```ts
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm'
import { z } from 'zod'
import { DeckDiff, DrillDraft, type Deck } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, curriculum, deckDiffs, decks, drills, enrollments, issues, preferences, students } from '../db/schema'
import { applyDiff, totalMinutes } from '../logic/deckDiff'
import { nextDateForWeekday, weekStart } from '../logic/dates'
import { findDeck, getDeck } from '../services/decks'
import { withRun } from './runs'

export const PLANNER_INSTRUCTIONS = `You plan kids' martial arts classes (ages 6-12) as a DECK of drill cards the instructor picks from live.
- 8-12 drills totalling 40-50 minutes. Start with a warmup, include technique and drills on the weekly theme, the forms due, at least one game, and end calm.
- Target open issues: include drills that fix the most common ones and list those students in focusStudentIds (use the provided ids only).
- cues: at most 2 short coaching cues (≤40 chars) the instructor will read on smart glasses.
- rationale: one short sentence on why this drill is in the deck.
- Respect the instructor's remembered preferences.
- Keep names ≤40 chars. No medical advice.`

const DraftOut = z.object({ drills: z.array(DrillDraft).min(8).max(12) })

async function planningContext(deps: Deps, classId: string, forDate: string) {
  const { db } = deps
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(forDate)))
  const roster = await db.select({ id: students.id, name: students.name, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, classId))
  const ids = roster.map(r => r.id)
  const open = ids.length ? await db.select().from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : []
  const byTag = new Map<string, string[]>()
  for (const i of open) byTag.set(i.tag, [...(byTag.get(i.tag) ?? []), i.studentId])
  const prefs = await db.select().from(preferences).where(eq(preferences.classId, classId))
  const [last] = await db.select().from(decks).where(and(eq(decks.classId, classId), lt(decks.forDate, forDate))).orderBy(desc(decks.forDate)).limit(1)
  const lastDrills = last ? await db.select().from(drills).where(eq(drills.deckId, last.id)).orderBy(asc(drills.position)) : []
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name ?? id
  const text = [
    `Weekly theme: ${cur?.theme ?? 'General skills'}`,
    `Forms due: ${(cur?.formsDue ?? []).join(', ') || 'none'}`,
    `Roster (id: name, belt): ${roster.map(r => `${r.id}: ${r.name}, ${r.belt}`).join('; ')}`,
    `Open issues: ${[...byTag].map(([tag, s]) => `${tag} → ${s.map(id => `${nameOf(id)} [${id}]`).join(', ')}`).join(' | ') || 'none'}`,
    `Last class: ${lastDrills.map(d => `${d.name} (${d.startedAt ? 'ran' : 'skipped'})`).join(', ') || 'none'}`,
    `Remembered preferences: ${prefs.map(p => p.text).join(' | ') || 'none'}`,
  ].join('\n')
  return { text, theme: cur?.theme ?? 'General skills' }
}

export async function draftDeck(deps: Deps, classId: string, forDate: string): Promise<string | null> {
  const existing = await findDeck(deps.db, classId, forDate)
  if (existing) return existing.id
  return withRun(deps, { agent: 'planner', trigger: 'draft', sessionId: null }, async () => {
    const ctx = await planningContext(deps, classId, forDate)
    const out = await deps.llm.object({ name: 'planner.draft', instructions: PLANNER_INSTRUCTIONS, prompt: `Plan the class on ${forDate}.\n${ctx.text}`, schema: DraftOut })
    const [deck] = await deps.db.insert(decks).values({ classId, forDate }).returning()
    await deps.db.insert(drills).values(out.drills.map((d, i) => ({ ...d, deckId: deck!.id, position: i + 1 })))
    return { result: deck!.id, summary: `Drafted ${forDate} deck: ${out.drills.length} drills, ${totalMinutes(out.drills)} min (${ctx.theme})`, reason: 'theme + forms cycle + open issues', output: out }
  })
}

export async function suggestDiff(deps: Deps, deckId: string, requestText: string, sessionId: string | null = null) {
  return withRun(deps, { agent: 'planner', trigger: 'suggest', sessionId }, async () => {
    const deck = await getDeck(deps.db, deckId)
    const ctx = await planningContext(deps, deck.classId, deck.forDate)
    const prompt = [
      `Instructor request: """${requestText}"""`,
      `Current deck (position. id | name | minutes | kind):`,
      ...deck.drills.map(d => `${d.position}. ${d.id} | ${d.name} | ${d.minutes}m | ${d.kind}`),
      `Return a minimal diff. afterPosition refers to CURRENT positions (0 = before the first). Use existing drill ids for changed/removed.`,
      `If the request states a lasting preference about this class, put a one-sentence version in rememberSuggestion, else null.`,
      ctx.text,
    ].join('\n')
    const diff = await deps.llm.object({ name: 'planner.diff', instructions: PLANNER_INSTRUCTIONS, prompt, schema: DeckDiff })
    const [row] = await deps.db.insert(deckDiffs).values({ deckId, requestText, diff }).returning()
    return {
      result: { diffId: row!.id, diff },
      summary: `Suggested changes for ${deck.forDate}: +${diff.added.length} ~${diff.changed.length} -${diff.removed.length}`,
      reason: `"${requestText.slice(0, 80)}"`,
      output: diff,
    }
  })
}

export async function acceptDiff(deps: Deps, diffId: string, opts: { remember: boolean }): Promise<Deck> {
  const { db } = deps
  const [row] = await db.select().from(deckDiffs).where(eq(deckDiffs.id, diffId))
  if (!row || row.status !== 'pending') throw new Error(`diff ${diffId} not pending`)
  const deck = await getDeck(db, row.deckId)
  const planned = applyDiff(deck.drills, row.diff)
  const keepIds = new Set(planned.flatMap(p => (p.id ? [p.id] : [])))
  const toDelete = deck.drills.filter(d => !keepIds.has(d.id)).map(d => d.id)
  if (toDelete.length) await db.delete(drills).where(inArray(drills.id, toDelete))
  for (const [i, p] of planned.entries()) {
    const { id, ...fields } = p
    if (id) await db.update(drills).set({ ...fields, position: i + 1 }).where(eq(drills.id, id))
    else await db.insert(drills).values({ ...fields, deckId: deck.id, position: i + 1 })
  }
  await db.update(deckDiffs).set({ status: 'accepted' }).where(eq(deckDiffs.id, diffId))
  if (opts.remember && row.diff.rememberSuggestion) await db.insert(preferences).values({ classId: deck.classId, text: row.diff.rememberSuggestion })
  return getDeck(db, deck.id)
}

export async function nextDeckFor(deps: Deps, classId: string, afterDate: string): Promise<string | null> {
  const [c] = await deps.db.select().from(classes).where(eq(classes.id, classId))
  if (!c) return null
  return draftDeck(deps, classId, nextDateForWeekday(afterDate, c.weekday))
}

export async function autoAdjustNextDeck(deps: Deps, a: { classId: string; afterDate: string; requestText: string; sessionId: string | null }) {
  const deckId = await nextDeckFor(deps, a.classId, a.afterDate)
  if (!deckId) return
  const s = await suggestDiff(deps, deckId, a.requestText, a.sessionId)
  if (s) await acceptDiff(deps, s.diffId, { remember: false })
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -w api -- agents`
Expected: PASS. In the planner test the added drill has `afterPosition: 2`, so it lands third: `['Tag','Holds','Sparring',…]`, 9 drills.

- [ ] **Step 5: Commit**

```bash
git add api/src
git commit -m "feat(api): parent email and planner agents with deck diffs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Utterance pipeline (session context, coverage, specialists)

**Files:**
- Create: `api/src/services/context.ts`, `api/src/services/utterance.ts`
- Test: `api/src/services/utterance.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6. `routeUtterance`, `draftParentEmail`, `suggestDiff`, `nextDeckFor`, `autoAdjustNextDeck`, `resolveName`, `parseAttendance`, `isRecurring`, `rankNextStudent`, `buildCardLines`, `localDate`, `weekStart`.
- Produces:
  - **`context.ts`:**
    - `SessionContext = { sessionId; classId; deckId; forDate; theme; roster: RosterStudent[]; presentIds: Set<string>; attendanceTaken: boolean; remindIds: Set<string>; drill: { id; name; position } | null }`
    - `loadSessionContext(db, sessionId, drillId: string | null): Promise<SessionContext>`
    - `computeCoverage(db, ctx): Promise<Coverage>`
    - `nextStudentFor(db, ctx, now): Promise<NextStudent | null>`
    - `markPresent(db, sessionId, studentId, source)`
  - **`utterance.ts`:** `handleUtterance(deps, input: { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; transcript: string }): Promise<UtteranceResponse>`

- [ ] **Step 1: Write failing tests**

`api/src/services/utterance.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, makeDeps, fakeLlm } from '../test/helpers'
import { handleUtterance } from './utterance'
import { classes, students, guardians, enrollments, curriculum, decks, drills, sessions, notes, issues, billingFlags, attendance, outbox } from '../db/schema'

const intent = (o: Partial<Record<string, unknown>>) => ({ type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null, attendanceStatus: null, ...o })

async function classWorld() {
  const db = await makeTestDb()
  const [c] = await db.insert(classes).values({ instructorId: 'i1', name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const names = ['Priya Rao', 'Leo Diaz', 'Jake Ross', 'Mia Lopez', 'Maya Chen']
  const ss = await db.insert(students).values(names.map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: `${s.name} parent`, email: `${s.id}@example.com` })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19', status: 'active' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Guard-up jab', minutes: 6, kind: 'drill' }).returning()
  const [se] = await db.insert(sessions).values({ classId: c!.id, deckId: d!.id, forDate: '2026-10-19', startedAt: new Date('2026-10-20T00:00:00Z') }).returning()
  const priya = ss[0]!
  await db.insert(notes).values([{ studentId: priya.id, text: 'guard low', tags: ['guard'], createdAt: new Date('2026-10-10T00:00:00Z') }, { studentId: priya.id, text: 'guard drops', tags: ['guard'], createdAt: new Date('2026-10-14T00:00:00Z') }])
  return { db, classId: c!.id, sessionId: se!.id, drillId: dr!.id, ss }
}

describe('handleUtterance', () => {
  it('attendance by exception marks present/absent without the LLM', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db)
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'attendance', transcript: 'Everyone except Jake and Mia' })
    expect(r.cardLines).toEqual(['3 present', 'absent: Jake, Mia'])
    expect(r.coverage).toEqual({ covered: 0, present: 3 })
    const rows = await w.db.select().from(attendance).where(eq(attendance.sessionId, w.sessionId))
    expect(rows.filter(x => x.status === 'absent')).toHaveLength(2)
  })

  it('3rd guard note opens a recurring issue, defers email + next-deck adjust', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, {
      llm: fakeLlm(({ name }) => {
        if (name === 'router') return { intents: [intent({ studentNames: ['Priya'], content: 'guard drops on the jab again', skillTags: ['guard'] })] }
        if (name === 'parent_email') return { subject: "Priya's guard", body: 'Hi! Priya brought great energy today and we are working on her guard.' }
        if (name === 'planner.draft') return { drills: Array.from({ length: 8 }, (_, i) => ({ name: `D${i}`, minutes: 5, kind: 'drill', cues: [], focusStudentIds: [], rationale: '' })) }
        return { added: [{ name: 'Hands-up freeze', minutes: 5, kind: 'game', cues: [], focusStudentIds: [], rationale: 'guard', afterPosition: 1, reason: 'guard' }], changed: [], removed: [], rememberSuggestion: null }
      }),
    })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: w.drillId, mode: 'note', transcript: 'Priya, guard drops on the jab again' })
    expect(r.cardLines).toEqual(['✓ Priya · guard (3rd time)', '→ progress logged', '→ parent note drafting', '→ added to next deck'])
    expect(r.coverage.covered).toBe(1)
    expect(await w.db.select().from(issues)).toHaveLength(1)
    await deps.flush()
    expect(await w.db.select().from(outbox)).toHaveLength(1)
  })

  it('billing + ambiguous name in one utterance', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, {
      llm: fakeLlm(() => ({ intents: [
        intent({ type: 'billing', studentNames: ['Leo'], content: 'owes for sparring gear', urgency: 'high' }),
        intent({ studentNames: ['Mya'], content: 'kicks higher', skillTags: ['kicks'] }),
      ] })),
    })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'Leo owes for gear urgent, Mya kicks higher' })
    expect(r.cardLines[0]).toBe('✓ Billing flag · Leo · HIGH')
    expect(r.disambiguation?.options.map(o => o.name).sort()).toEqual(['Maya Chen', 'Mia Lopez'])
    expect(await w.db.select().from(billingFlags)).toHaveLength(1)
  })

  it('router failure saves an unassigned note', async () => {
    const w = await classWorld()
    const deps = makeDeps(w.db, { llm: fakeLlm(() => { throw new Error('gateway down') }) })
    const r = await handleUtterance(deps, { sessionId: w.sessionId, drillId: null, mode: 'note', transcript: 'something' })
    expect(r.cardLines).toEqual(['● Saved · sorting failed, see Review'])
    const [n] = await w.db.select().from(notes).where(eq(notes.text, 'something'))
    expect(n!.studentId).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- utterance`
Expected: FAIL.

- [ ] **Step 3: Implement `context.ts`**

`api/src/services/context.ts`:
```ts
import { and, eq, inArray, max } from 'drizzle-orm'
import type { Coverage, NextStudent, RosterStudent, SkillTag } from '@matside/shared'
import type { Db } from '../db/client'
import { attendance, curriculum, drills, enrollments, issues, notes, sessions, students } from '../db/schema'
import { weekStart } from '../logic/dates'
import { rankNextStudent } from '../logic/ranking'

export interface SessionContext {
  sessionId: string; classId: string; deckId: string; forDate: string; theme: string
  roster: RosterStudent[]; presentIds: Set<string>; attendanceTaken: boolean; remindIds: Set<string>
  drill: { id: string; name: string; position: number } | null
}

export async function loadSessionContext(db: Db, sessionId: string, drillId: string | null): Promise<SessionContext> {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!s) throw new Error(`session ${sessionId} not found`)
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, s.classId))
  const att = await db.select().from(attendance).where(eq(attendance.sessionId, sessionId))
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(s.forDate)))
  const [d] = drillId ? await db.select().from(drills).where(eq(drills.id, drillId)) : []
  return {
    sessionId, classId: s.classId, deckId: s.deckId, forDate: s.forDate, theme: cur?.theme ?? 'General skills', roster,
    presentIds: new Set(att.filter(a => a.status === 'present').map(a => a.studentId)),
    attendanceTaken: att.length > 0, remindIds: new Set(s.remindIds),
    drill: d ? { id: d.id, name: d.name, position: d.position } : null,
  }
}

const presentRoster = (ctx: SessionContext) => (ctx.attendanceTaken ? ctx.roster.filter(r => ctx.presentIds.has(r.id)) : ctx.roster)

export async function markPresent(db: Db, sessionId: string, studentId: string, source: 'voice' | 'phone' | 'backstop') {
  await db.insert(attendance).values({ sessionId, studentId, status: 'present', source })
    .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status: 'present', source } })
}

async function notedIds(db: Db, sessionId: string): Promise<Set<string>> {
  const rows = await db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, sessionId))
  return new Set(rows.flatMap(r => (r.id ? [r.id] : [])))
}

export async function computeCoverage(db: Db, ctx: SessionContext): Promise<Coverage> {
  const fresh = await loadSessionContext(db, ctx.sessionId, null)
  const present = presentRoster(fresh)
  const noted = await notedIds(db, ctx.sessionId)
  return { covered: present.filter(p => noted.has(p.id)).length, present: present.length }
}

export async function nextStudentFor(db: Db, ctx: SessionContext, now: Date): Promise<NextStudent | null> {
  const fresh = await loadSessionContext(db, ctx.sessionId, null)
  const present = presentRoster(fresh)
  const ids = present.map(p => p.id)
  if (!ids.length) return null
  const open = await db.select({ studentId: issues.studentId, tag: issues.tag }).from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open')))
  const last = await db.select({ studentId: notes.studentId, at: max(notes.createdAt) }).from(notes).where(inArray(notes.studentId, ids)).groupBy(notes.studentId)
  return rankNextStudent({
    present: present.map(p => ({ id: p.id, name: p.name.split(' ')[0]! })),
    notedIds: await notedIds(db, ctx.sessionId),
    remindIds: fresh.remindIds,
    openIssue: new Map(open.map(o => [o.studentId, o.tag as SkillTag])),
    lastNoteAt: new Map(last.flatMap(l => (l.studentId && l.at ? [[l.studentId, new Date(l.at)] as const] : []))),
    now,
  })
}
```

- [ ] **Step 4: Implement `utterance.ts`**

`api/src/services/utterance.ts`:
```ts
import { and, eq, gte } from 'drizzle-orm'
import type { Disambiguation, Intent, UtteranceResponse } from '@matside/shared'
import type { Deps } from '../deps'
import { attendance, billingFlags, drills, issues, notes, utterances } from '../db/schema'
import { routeUtterance } from '../agents/router'
import { withRun } from '../agents/runs'
import { draftParentEmail } from '../agents/parentEmail'
import { autoAdjustNextDeck, nextDeckFor, suggestDiff } from '../agents/planner'
import { resolveName } from '../logic/names'
import { parseAttendance } from '../logic/attendance'
import { isRecurring, RECURRING_WINDOW_DAYS } from '../logic/recurring'
import { buildCardLines, type CardAction } from '../logic/cardLines'
import { computeCoverage, loadSessionContext, markPresent, nextStudentFor, type SessionContext } from './context'

const DAY = 86_400_000
const first = (name: string) => name.split(' ')[0]!

export async function handleUtterance(
  deps: Deps,
  input: { sessionId: string; drillId: string | null; mode: 'note' | 'attendance'; transcript: string },
): Promise<UtteranceResponse> {
  const { db } = deps
  const ctx = await loadSessionContext(db, input.sessionId, input.drillId)
  const [utt] = await db.insert(utterances).values({ sessionId: ctx.sessionId, transcript: input.transcript, mode: input.mode }).returning()
  const utteranceId = utt!.id
  const actions: CardAction[] = []
  let disambiguation: Disambiguation | null = null

  const parsed = input.mode === 'attendance' ? parseAttendance(input.transcript) : null
  if (parsed) {
    actions.push(await applyRollCall(deps, ctx, parsed))
  } else {
    const intents = await routeUtterance(deps, { sessionId: ctx.sessionId, transcript: input.transcript, roster: ctx.roster, drillName: ctx.drill?.name ?? null, theme: ctx.theme })
    if (!intents) {
      await db.insert(notes).values({ sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: input.transcript })
      actions.push({ kind: 'saved_unsorted' })
    }
    for (const intent of intents ?? []) {
      const r = await applyIntent(deps, ctx, utteranceId, intent)
      actions.push(...r.actions)
      disambiguation ??= r.disambiguation
    }
  }
  return {
    utteranceId,
    transcript: input.transcript,
    cardLines: buildCardLines(actions),
    coverage: await computeCoverage(db, ctx),
    nextStudent: await nextStudentFor(db, ctx, deps.now()),
    disambiguation,
  }
}

async function applyRollCall(deps: Deps, ctx: SessionContext, parsed: { kind: 'except'; names: string[] } | { kind: 'all' }): Promise<CardAction> {
  const absent = new Map<string, string>()
  if (parsed.kind === 'except') {
    for (const n of parsed.names) {
      const m = resolveName(n, ctx.roster)
      if (m.kind === 'match') absent.set(m.student.id, first(m.student.name))
    }
  }
  for (const s of ctx.roster) {
    const status = absent.has(s.id) ? 'absent' : 'present'
    await deps.db.insert(attendance).values({ sessionId: ctx.sessionId, studentId: s.id, status, source: 'voice' })
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'voice' } })
  }
  await withRun(deps, { agent: 'attendance', trigger: 'roll_call', sessionId: ctx.sessionId }, async () => ({
    result: true, summary: `${ctx.roster.length - absent.size} present, absent: ${[...absent.values()].join(', ') || 'none'}`, reason: 'voice roll call',
  }))
  return { kind: 'attendance', present: ctx.roster.length - absent.size, absentNames: [...absent.values()] }
}

type Applied = { actions: CardAction[]; disambiguation: Disambiguation | null }

async function applyIntent(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  switch (intent.type) {
    case 'feedback': return applyFeedback(deps, ctx, utteranceId, intent)
    case 'billing': return applyBilling(deps, ctx, utteranceId, intent)
    case 'attendance': return applyAttendanceIntent(deps, ctx, intent)
    case 'plan_request': {
      deps.defer((async () => {
        const deckId = await nextDeckFor(deps, ctx.classId, ctx.forDate)
        if (deckId) await suggestDiff(deps, deckId, intent.content, ctx.sessionId)
      })())
      return { actions: [{ kind: 'plan_request' }], disambiguation: null }
    }
    case 'parent_message': {
      const actions: CardAction[] = []
      for (const n of intent.studentNames) {
        const m = resolveName(n, ctx.roster)
        if (m.kind !== 'match') continue
        deps.defer(draftParentEmail(deps, { studentId: m.student.id, sessionId: ctx.sessionId, trigger: { kind: 'request', content: intent.content } }))
        actions.push({ kind: 'parent_note', name: first(m.student.name) })
      }
      return { actions, disambiguation: null }
    }
    case 'add_drill': {
      const minutes = intent.minutes ?? 5
      const name = intent.content.slice(0, 40)
      const position = (ctx.drill?.position ?? 0) + 1
      const existing = await deps.db.select().from(drills).where(eq(drills.deckId, ctx.deckId))
      for (const d of existing.filter(x => x.position >= position)) await deps.db.update(drills).set({ position: d.position + 1 }).where(eq(drills.id, d.id))
      await deps.db.insert(drills).values({ deckId: ctx.deckId, position, name, minutes, kind: 'drill', rationale: 'added live by instructor' })
      return { actions: [{ kind: 'add_drill', name, minutes }], disambiguation: null }
    }
  }
}

async function applyFeedback(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const { db } = deps
  const actions: CardAction[] = []
  let disambiguation: Disambiguation | null = null
  const base = { sessionId: ctx.sessionId, utteranceId, drillId: ctx.drill?.id ?? null, text: intent.content, tags: intent.skillTags }
  if (!intent.studentNames.length) {
    await db.insert(notes).values(base)
    return { actions: [{ kind: 'unassigned' }], disambiguation: null }
  }
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind === 'ambiguous') {
      const [n] = await db.insert(notes).values({ ...base, heard }).returning()
      disambiguation ??= { noteId: n!.id, heard, options: m.options }
      continue
    }
    if (m.kind === 'none') {
      await db.insert(notes).values({ ...base, heard })
      actions.push({ kind: 'unassigned' })
      continue
    }
    const s = m.student
    await db.insert(notes).values({ ...base, studentId: s.id })
    await markPresent(db, ctx.sessionId, s.id, 'backstop')
    const tag = intent.skillTags[0] ?? null
    let count = 1
    let recurring = false
    if (tag) {
      const since = new Date(deps.now().getTime() - RECURRING_WINDOW_DAYS * DAY)
      const recent = await db.select({ tags: notes.tags }).from(notes).where(and(eq(notes.studentId, s.id), gte(notes.createdAt, since)))
      count = recent.filter(r => r.tags.includes(tag)).length
      const [open] = await db.select().from(issues).where(and(eq(issues.studentId, s.id), eq(issues.tag, tag), eq(issues.status, 'open')))
      recurring = isRecurring(count, Boolean(open))
      if (recurring) {
        await db.insert(issues).values({ studentId: s.id, tag })
        deps.defer(draftParentEmail(deps, { studentId: s.id, sessionId: ctx.sessionId, trigger: { kind: 'recurring', tag } }))
        deps.defer(autoAdjustNextDeck(deps, { classId: ctx.classId, afterDate: ctx.forDate, sessionId: ctx.sessionId, requestText: `Add a short, fun drill targeting ${tag} for ${s.name} [${s.id}] (recurring issue).` }))
      }
    }
    await withRun(deps, { agent: 'progress', trigger: 'feedback', sessionId: ctx.sessionId }, async () => ({
      result: true,
      summary: `Logged "${intent.content.slice(0, 60)}" → ${first(s.name)}${ctx.drill ? ` · drill: ${ctx.drill.name}` : ''}`,
      reason: recurring ? `${tag} ${count}× in ${RECURRING_WINDOW_DAYS} days → marked recurring` : tag ? `${tag} note #${count} in ${RECURRING_WINDOW_DAYS} days` : 'feedback note',
    }))
    actions.push({ kind: 'feedback', name: first(s.name), tag, count, recurring })
  }
  return { actions, disambiguation }
}

async function applyBilling(deps: Deps, ctx: SessionContext, utteranceId: string, intent: Intent): Promise<Applied> {
  const heard = intent.studentNames[0]
  const m = heard ? resolveName(heard, ctx.roster) : { kind: 'none' as const }
  const student = m.kind === 'match' ? m.student : null
  const urgency = intent.urgency ?? 'med'
  await deps.db.insert(billingFlags).values({ studentId: student?.id ?? null, utteranceId, urgency, note: intent.content, amount: intent.amount })
  await withRun(deps, { agent: 'billing', trigger: 'billing', sessionId: ctx.sessionId }, async () => ({
    result: true, summary: `Flagged ${student ? first(student.name) : heard ?? 'unknown'}: ${intent.content.slice(0, 60)}`, reason: `urgency ${urgency.toUpperCase()} (note only, no payment)`,
  }))
  return { actions: [{ kind: 'billing', name: student ? first(student.name) : heard ?? '?', urgency }], disambiguation: null }
}

async function applyAttendanceIntent(deps: Deps, ctx: SessionContext, intent: Intent): Promise<Applied> {
  const actions: CardAction[] = []
  const status = intent.attendanceStatus ?? 'present'
  for (const heard of intent.studentNames) {
    const m = resolveName(heard, ctx.roster)
    if (m.kind !== 'match') continue
    await deps.db.insert(attendance).values({ sessionId: ctx.sessionId, studentId: m.student.id, status, source: 'voice' })
      .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'voice' } })
    actions.push({ kind: 'marked', name: first(m.student.name), status })
  }
  return { actions, disambiguation: null }
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w api -- utterance`
Expected: 4 PASS.

Note on attendance test 1: there is no roll call yet, so the roster has 5 students; with Jake and Mia absent, 3 are present. Feedback-only sessions count the whole roster as present until roll call.

- [ ] **Step 6: Commit**

```bash
git add api/src/services
git commit -m "feat(api): utterance pipeline with progress, billing, attendance, recurring issues

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Sessions, today, drills, auth/pairing, Hono app

**Files:**
- Create: `api/src/services/sessions.ts`, `api/src/services/today.ts`, `api/src/app.ts`, `api/src/http/auth.ts`, `api/src/http/rateLimit.ts`
- Test: `api/src/app.test.ts`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces:
  - **HTTP routes.** Everything under `/v1` needs `Authorization: Bearer <token>`.
    - `GET /health` → `{ ok: true }`
    - `POST /pair` `{ code }` → `{ token }`
    - `GET /v1/today` → `Today`
    - `POST /v1/sessions` `{ classId }` → `StartSessionResponse`
    - `POST /v1/sessions/:id/attendance` `{ presentIds: string[] }` → `Coverage`
    - `POST /v1/sessions/:id/end` → `WrapUp`
    - `POST /v1/sessions/:id/remind` `{ studentIds }` → `{ ok: true }`
    - `POST /v1/sessions/:id/drills/:drillId/:event` (`start`|`end`) → `{ ok: true }`
    - `POST /v1/utterance` multipart `{ sessionId, drillId?, mode, text? , audio? }` → `UtteranceResponse`
    - `POST /v1/utterances/:id/undo` → `{ coverage }`
    - `POST /v1/notes/:id/assign` `{ studentId }` → `{ coverage, nextStudent }`
  - **Functions:**
    - `createApp(deps: Deps): Hono`
    - `getToday(deps): Promise<Today>`
    - `startSession(deps, classId): Promise<StartSessionResponse>`
    - `endSession(deps, sessionId): Promise<WrapUp>`
    - `logDrill(deps, sessionId, drillId, event)`
    - `hashToken(t): Promise<string>`

- [ ] **Step 1: Write failing integration tests**

`api/src/app.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { makeTestDb, makeDeps, fakeLlm } from './test/helpers'
import { createApp } from './app'
import { instructors, classes, students, enrollments, guardians, curriculum, decks, drills } from './db/schema'

async function setup() {
  const db = await makeTestDb()
  const [ins] = await db.insert(instructors).values({ name: 'Coach Galen', email: 'g@example.com' }).returning()
  const [c] = await db.insert(classes).values({ instructorId: ins!.id, name: 'Kids Mon', weekday: 1, startTime: '17:00' }).returning()
  const ss = await db.insert(students).values(['Priya Rao', 'Leo Diaz', 'Jake Ross'].map(name => ({ name, belt: 'yellow', birthYear: 2018 }))).returning()
  await db.insert(enrollments).values(ss.map(s => ({ classId: c!.id, studentId: s.id })))
  await db.insert(guardians).values(ss.map(s => ({ studentId: s.id, name: 'P', email: 'p@example.com' })))
  await db.insert(curriculum).values({ weekStart: '2026-10-19', theme: 'Stances', formsDue: ['Kata 2'] })
  const [d] = await db.insert(decks).values({ classId: c!.id, forDate: '2026-10-19' }).returning()
  const [dr] = await db.insert(drills).values({ deckId: d!.id, position: 1, name: 'Horse stance holds', minutes: 4, kind: 'drill' }).returning()
  const deps = makeDeps(db, { llm: fakeLlm(() => ({ intents: [{ type: 'feedback', studentNames: ['Priya'], content: 'great stance', skillTags: ['stance'], urgency: null, amount: null, minutes: null, attendanceStatus: null }] })) })
  const app = createApp(deps)
  const pair = await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: '4242' }), headers: { 'Content-Type': 'application/json' } })
  const { token } = (await pair.json()) as { token: string }
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  return { app, h, classId: c!.id, drillId: dr!.id }
}

describe('http', () => {
  it('rejects bad pairing codes and unauthenticated calls', async () => {
    const { app } = await setup()
    expect((await app.request('/pair', { method: 'POST', body: JSON.stringify({ code: 'nope' }), headers: { 'Content-Type': 'application/json' } })).status).toBe(401)
    expect((await app.request('/v1/today')).status).toBe(401)
  })

  it('runs a class: today → start → drill → text note → end', async () => {
    const { app, h, classId, drillId } = await setup()
    const today = await (await app.request('/v1/today', { headers: h })).json() as { classId: string; theme: string; deck: { drills: unknown[] } }
    expect(today).toMatchObject({ classId, theme: 'Stances' })
    expect(today.deck.drills).toHaveLength(1)
    const start = await (await app.request('/v1/sessions', { method: 'POST', headers: h, body: JSON.stringify({ classId }) })).json() as { sessionId: string }
    expect((await app.request(`/v1/sessions/${start.sessionId}/drills/${drillId}/start`, { method: 'POST', headers: h })).status).toBe(200)
    const form = new FormData()
    form.set('sessionId', start.sessionId); form.set('drillId', drillId); form.set('mode', 'note'); form.set('text', 'Priya great stance')
    const u = await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })
    expect(u.status).toBe(200)
    expect(((await u.json()) as { cardLines: string[] }).cardLines[0]).toBe('✓ Priya · stance')
    const wrap = await (await app.request(`/v1/sessions/${start.sessionId}/end`, { method: 'POST', headers: h })).json() as { coverage: { covered: number; present: number }; missed: { name: string }[]; drillsRun: number }
    expect(wrap.coverage).toEqual({ covered: 1, present: 3 })
    expect(wrap.missed.map(m => m.name).sort()).toEqual(['Jake', 'Leo'])
    expect(wrap.drillsRun).toBe(1)
  })

  it('validates utterance input', async () => {
    const { app, h } = await setup()
    const form = new FormData(); form.set('mode', 'note')
    expect((await app.request('/v1/utterance', { method: 'POST', headers: { Authorization: h.Authorization }, body: form })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- app`
Expected: FAIL.

- [ ] **Step 3: Implement services**

`api/src/services/sessions.ts`:
```ts
import { and, count, eq, gte, isNull, isNotNull } from 'drizzle-orm'
import type { StartSessionResponse, WrapUp } from '@matside/shared'
import type { Deps } from '../deps'
import { agentRuns, billingFlags, classes, decks, drills, notes, outbox, sessions } from '../db/schema'
import { localDate } from '../logic/dates'
import { draftDeck } from '../agents/planner'
import { computeCoverage, loadSessionContext, nextStudentFor } from './context'

export async function startSession(deps: Deps, classId: string): Promise<StartSessionResponse> {
  const { db } = deps
  const forDate = localDate(deps.now(), deps.env.timeZone)
  const [open] = await db.select().from(sessions).where(and(eq(sessions.classId, classId), eq(sessions.forDate, forDate), isNull(sessions.endedAt)))
  let session = open
  if (!session) {
    const deckId = await draftDeck(deps, classId, forDate)
    if (!deckId) throw new Error('could not prepare a deck')
    const [c] = await db.select().from(classes).where(eq(classes.id, classId))
    if (!c) throw new Error(`class ${classId} not found`)
    ;[session] = await db.insert(sessions).values({ classId, deckId, forDate, startedAt: deps.now(), remindIds: c.remindIds }).returning()
    await db.update(classes).set({ remindIds: [] }).where(eq(classes.id, classId))
    await db.update(decks).set({ status: 'active' }).where(eq(decks.id, deckId))
  }
  const ctx = await loadSessionContext(db, session!.id, null)
  return { sessionId: session!.id, startedAt: session!.startedAt.toISOString(), coverage: await computeCoverage(db, ctx), nextStudent: await nextStudentFor(db, ctx, deps.now()) }
}

export async function logDrill(deps: Deps, sessionId: string, drillId: string, event: 'start' | 'end') {
  const { db } = deps
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!s) throw new Error('session not found')
  const now = deps.now()
  if (event === 'start') {
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt), isNull(drills.endedAt)))
    await db.update(drills).set({ startedAt: now, endedAt: null }).where(and(eq(drills.id, drillId), eq(drills.deckId, s.deckId)))
  } else {
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.id, drillId), eq(drills.deckId, s.deckId)))
  }
}

export async function endSession(deps: Deps, sessionId: string): Promise<WrapUp> {
  const { db } = deps
  const now = deps.now()
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  if (!s) throw new Error('session not found')
  if (!s.endedAt) {
    await db.update(sessions).set({ endedAt: now }).where(eq(sessions.id, sessionId))
    await db.update(decks).set({ status: 'done' }).where(eq(decks.id, s.deckId))
    await db.update(drills).set({ endedAt: now }).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt), isNull(drills.endedAt)))
  }
  const ctx = await loadSessionContext(db, sessionId, null)
  const coverage = await computeCoverage(db, ctx)
  const noted = new Set((await db.selectDistinct({ id: notes.studentId }).from(notes).where(eq(notes.sessionId, sessionId))).flatMap(r => (r.id ? [r.id] : [])))
  const present = ctx.attendanceTaken ? ctx.roster.filter(r => ctx.presentIds.has(r.id)) : ctx.roster
  const [ran] = await db.select({ n: count() }).from(drills).where(and(eq(drills.deckId, s.deckId), isNotNull(drills.startedAt)))
  const [runs] = await db.select({ n: count() }).from(agentRuns).where(and(eq(agentRuns.sessionId, sessionId), eq(agentRuns.status, 'ok')))
  const [mail] = await db.select({ n: count() }).from(outbox).where(and(eq(outbox.status, 'pending_review'), gte(outbox.createdAt, s.startedAt)))
  const [bills] = await db.select({ n: count() }).from(billingFlags).where(and(eq(billingFlags.status, 'open'), gte(billingFlags.createdAt, s.startedAt)))
  return {
    sessionId,
    minutes: Math.round(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000),
    drillsRun: ran?.n ?? 0,
    coverage,
    missed: present.filter(p => !noted.has(p.id)).map(p => ({ id: p.id, name: p.name.split(' ')[0]! })),
    agentActions: runs?.n ?? 0,
    pendingReview: (mail?.n ?? 0) + (bills?.n ?? 0),
  }
}
```

`api/src/services/today.ts`:
```ts
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { FocusItem, Today } from '@matside/shared'
import type { Deps } from '../deps'
import { classes, curriculum, enrollments, issues, sessions, students } from '../db/schema'
import { localDate, localWeekday, weekStart } from '../logic/dates'
import { draftDeck } from '../agents/planner'
import { getDeck } from './decks'

const TAG_LABEL: Record<string, string> = {
  stance: 'Stances', guard: 'Guard drops', kicks: 'Kicks', strikes: 'Strikes', forms: 'Forms', footwork: 'Footwork',
  focus: 'Focus', effort: 'Effort', respect: 'Respect', sparring: 'Sparring',
}

export async function getToday(deps: Deps): Promise<Today> {
  const { db } = deps
  const now = deps.now()
  const forDate = localDate(now, deps.env.timeZone)
  const dow = localWeekday(now, deps.env.timeZone)
  const all = await db.select().from(classes)
  if (!all.length) throw new Error('no classes')
  const cls = all.find(c => c.weekday === dow) ?? [...all].sort((a, b) => ((a.weekday - dow + 7) % 7) - ((b.weekday - dow + 7) % 7))[0]!
  const deckId = await draftDeck(deps, cls.id, forDate)
  if (!deckId) throw new Error('deck unavailable')
  const roster = await db.select({ id: students.id, name: students.name, nickname: students.nickname, belt: students.belt })
    .from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).where(eq(enrollments.classId, cls.id))
  const ids = roster.map(r => r.id)
  const open = ids.length ? await db.select().from(issues).where(and(inArray(issues.studentId, ids), eq(issues.status, 'open'))) : []
  const byTag = new Map<string, string[]>()
  for (const i of open) byTag.set(i.tag, [...(byTag.get(i.tag) ?? []), i.studentId])
  const nameOf = (id: string) => roster.find(r => r.id === id)?.name.split(' ')[0] ?? '?'
  const focus: FocusItem[] = [...byTag].sort((a, b) => b[1].length - a[1].length).map(([tag, sids]) => ({
    label: `${TAG_LABEL[tag] ?? tag} · ${sids.length === 1 ? nameOf(sids[0]!) : `${sids.length} kids`}`, studentIds: sids, studentNames: sids.map(nameOf),
  }))
  if (cls.remindIds.length) focus.push({ label: `First on feedback list: ${cls.remindIds.map(nameOf).join(', ')}`, studentIds: cls.remindIds, studentNames: cls.remindIds.map(nameOf) })
  const [cur] = await db.select().from(curriculum).where(eq(curriculum.weekStart, weekStart(forDate)))
  const [open1] = await db.select().from(sessions).where(and(eq(sessions.classId, cls.id), eq(sessions.forDate, forDate), isNull(sessions.endedAt)))
  return {
    classId: cls.id, className: cls.name, startTime: cls.startTime, forDate, sessionId: open1?.id ?? null,
    theme: cur?.theme ?? 'General skills', formsDue: cur?.formsDue ?? [], focus, deck: await getDeck(db, deckId), roster,
  }
}
```

- [ ] **Step 4: Implement HTTP helpers and the app**

`api/src/http/auth.ts`:
```ts
export async function hashToken(t: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}
```

`api/src/http/rateLimit.ts`:
```ts
// Per-instance fixed window. Good enough for one instructor; Fluid Compute reuses instances.
const hits = new Map<string, { n: number; reset: number }>()
export function allow(key: string, limit: number, windowMs = 60_000, now = Date.now()): boolean {
  const h = hits.get(key)
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true }
  h.n++
  return h.n <= limit
}
```

`api/src/app.ts`:
```ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { HTTPException } from 'hono/http-exception'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { UtteranceForm } from '@matside/shared'
import type { Deps } from './deps'
import { attendance, billingFlags, enrollments, instructors, notes, sessions, students, classes } from './db/schema'
import { hashToken } from './http/auth'
import { allow } from './http/rateLimit'
import { getToday } from './services/today'
import { endSession, logDrill, startSession } from './services/sessions'
import { handleUtterance } from './services/utterance'
import { computeCoverage, loadSessionContext, markPresent, nextStudentFor } from './services/context'

type Vars = { Variables: { instructorId: string } }
const MAX_AUDIO_BYTES = 2_000_000

const json = async <T>(req: Request, schema: z.ZodType<T>): Promise<T> => {
  const parsed = schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) throw new HTTPException(400, { message: 'invalid body' })
  return parsed.data
}

export function createApp(deps: Deps) {
  const app = new Hono<Vars>()
  const { db } = deps

  app.use('*', cors({
    origin: o => (deps.env.allowedOrigins.includes('*') ? o || '*' : deps.env.allowedOrigins.includes(o) ? o : null),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    maxAge: 600,
  }))

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status)
    console.error('[api]', c.req.method, c.req.path, err)
    return c.json({ error: 'internal_error' }, 500)
  })

  app.get('/health', c => c.json({ ok: true }))

  app.post('/pair', async c => {
    const ip = c.req.header('x-forwarded-for') ?? 'local'
    if (!allow(`pair:${ip}`, 10)) throw new HTTPException(429, { message: 'slow down' })
    const { code } = await json(c.req.raw, z.object({ code: z.string().min(1).max(32) }))
    if (code !== deps.env.pairingCode) throw new HTTPException(401, { message: 'bad code' })
    const [ins] = await db.select().from(instructors).limit(1)
    if (!ins) throw new HTTPException(500, { message: 'no instructor seeded' })
    const token = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
    await db.update(instructors).set({ tokenHash: await hashToken(token) }).where(eq(instructors.id, ins.id))
    return c.json({ token })
  })

  app.use('/v1/*', async (c, next) => {
    const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) throw new HTTPException(401, { message: 'missing token' })
    const [ins] = await db.select({ id: instructors.id }).from(instructors).where(eq(instructors.tokenHash, await hashToken(token)))
    if (!ins) throw new HTTPException(401, { message: 'bad token' })
    c.set('instructorId', ins.id)
    await next()
  })

  app.get('/v1/today', async c => c.json(await getToday(deps)))

  app.post('/v1/sessions', async c => {
    const { classId } = await json(c.req.raw, z.object({ classId: z.string().min(1) }))
    return c.json(await startSession(deps, classId))
  })

  app.post('/v1/sessions/:id/attendance', async c => {
    const { presentIds } = await json(c.req.raw, z.object({ presentIds: z.array(z.string()) }))
    const sessionId = c.req.param('id')
    const ctx = await loadSessionContext(db, sessionId, null)
    for (const s of ctx.roster) {
      const status = presentIds.includes(s.id) ? 'present' : 'absent'
      await db.insert(attendance).values({ sessionId, studentId: s.id, status, source: 'phone' })
        .onConflictDoUpdate({ target: [attendance.sessionId, attendance.studentId], set: { status, source: 'phone' } })
    }
    return c.json(await computeCoverage(db, ctx))
  })

  app.post('/v1/sessions/:id/end', async c => c.json(await endSession(deps, c.req.param('id'))))

  app.post('/v1/sessions/:id/remind', async c => {
    const { studentIds } = await json(c.req.raw, z.object({ studentIds: z.array(z.string()).max(30) }))
    const [s] = await db.select().from(sessions).where(eq(sessions.id, c.req.param('id')))
    if (!s) throw new HTTPException(404, { message: 'session not found' })
    await db.update(classes).set({ remindIds: studentIds }).where(eq(classes.id, s.classId))
    return c.json({ ok: true })
  })

  app.post('/v1/sessions/:id/drills/:drillId/:event', async c => {
    const event = z.enum(['start', 'end']).safeParse(c.req.param('event'))
    if (!event.success) throw new HTTPException(400, { message: 'bad event' })
    await logDrill(deps, c.req.param('id'), c.req.param('drillId'), event.data)
    return c.json({ ok: true })
  })

  app.post('/v1/utterance', async c => {
    if (!allow(`utt:${c.get('instructorId')}`, 30)) throw new HTTPException(429, { message: 'slow down' })
    const body = await c.req.parseBody()
    const str = (k: string) => (typeof body[k] === 'string' && body[k] !== '' ? (body[k] as string) : null)
    const form = UtteranceForm.safeParse({ sessionId: str('sessionId'), drillId: str('drillId'), mode: str('mode'), text: str('text') })
    if (!form.success) throw new HTTPException(400, { message: 'invalid utterance form' })
    let transcript = form.data.text
    const audio = body['audio']
    if (!transcript && audio instanceof File) {
      if (audio.size > MAX_AUDIO_BYTES) throw new HTTPException(413, { message: 'audio too large' })
      const ctx = await loadSessionContext(db, form.data.sessionId, null)
      transcript = (await deps.stt.transcribe(new Uint8Array(await audio.arrayBuffer()), ctx.roster.map(r => r.name))).trim()
    }
    if (!transcript) throw new HTTPException(422, { message: 'empty_transcript' })
    return c.json(await handleUtterance(deps, { sessionId: form.data.sessionId, drillId: form.data.drillId, mode: form.data.mode, transcript }))
  })

  app.post('/v1/utterances/:id/undo', async c => {
    const id = c.req.param('id')
    const [n] = await db.select({ sessionId: notes.sessionId }).from(notes).where(eq(notes.utteranceId, id)).limit(1)
    await db.delete(notes).where(eq(notes.utteranceId, id))
    await db.delete(billingFlags).where(eq(billingFlags.utteranceId, id))
    const coverage = n?.sessionId ? await computeCoverage(db, await loadSessionContext(db, n.sessionId, null)) : null
    return c.json({ coverage })
  })

  app.post('/v1/notes/:id/assign', async c => {
    const { studentId } = await json(c.req.raw, z.object({ studentId: z.string().min(1) }))
    const [n] = await db.select().from(notes).where(eq(notes.id, c.req.param('id')))
    if (!n) throw new HTTPException(404, { message: 'note not found' })
    if (n.sessionId) {
      const [en] = await db.select().from(enrollments).innerJoin(sessions, eq(sessions.classId, enrollments.classId))
        .where(and(eq(sessions.id, n.sessionId), eq(enrollments.studentId, studentId)))
      if (!en) throw new HTTPException(400, { message: 'student not in class' })
    } else {
      const [st] = await db.select().from(students).where(inArray(students.id, [studentId]))
      if (!st) throw new HTTPException(400, { message: 'unknown student' })
    }
    await db.update(notes).set({ studentId }).where(eq(notes.id, n.id))
    if (!n.sessionId) return c.json({ coverage: null, nextStudent: null })
    await markPresent(db, n.sessionId, studentId, 'backstop')
    const ctx = await loadSessionContext(db, n.sessionId, null)
    return c.json({ coverage: await computeCoverage(db, ctx), nextStudent: await nextStudentFor(db, ctx, deps.now()) })
  })

  return app
}
```

- [ ] **Step 5: Run tests**

Run: `npm test -w api`
Expected: all PASS (logic, router, agents, utterance, app). Coverage is `{covered: 1, present: 3}` because attendance wasn't taken, so the whole roster counts as present.

- [ ] **Step 6: Commit**

```bash
git add api/src
git commit -m "feat(api): hono app with pairing, auth, sessions, today, utterance routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Seed data (demo school)

**Files:**
- Create: `api/src/db/seed.ts`, `api/src/db/seed-cli.ts`
- Test: `api/src/db/seed.test.ts`

**Interfaces:**
- Consumes: schema, `localDate`, `weekStart`, `addDays`, `nextDateForWeekday`.
- Produces:
  - `seed(db, opts: { today: string; guardianEmail: (i: number) => string }): Promise<{ instructorId; classIds: { tue; thu }; priyaId }>`.
  - Idempotent: wipes demo tables first.
  - Result: 14 students; Priya with 2 prior guard notes; 4 kids with guard notes, 2 of them with an open guard issue; Leo with no notes in 20+ days; curriculum for 4 weeks around `today`; a Tue deck and a Thu deck for the next class dates.

- [ ] **Step 1: Failing test**

`api/src/db/seed.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb } from '../test/helpers'
import { seed } from './seed'
import { students, notes, issues, curriculum, decks } from './schema'

describe('seed', () => {
  it('creates the demo world and is idempotent', async () => {
    const db = await makeTestDb()
    const opts = { today: '2026-10-17', guardianEmail: (i: number) => `parent${i}@example.com` }
    await seed(db, opts)
    const r = await seed(db, opts)
    expect(await db.select().from(students)).toHaveLength(14)
    const priyaNotes = await db.select().from(notes).where(eq(notes.studentId, r.priyaId))
    expect(priyaNotes.filter(n => n.tags.includes('guard'))).toHaveLength(2)
    expect((await db.select().from(issues)).length).toBe(2)
    expect((await db.select().from(curriculum)).length).toBe(4)
    expect((await db.select().from(decks)).length).toBe(2)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -w api -- seed`
Expected: FAIL.

- [ ] **Step 3: Implement**

`api/src/db/seed.ts`:
```ts
import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday, weekStart } from '../logic/dates'

const KIDS = [
  ['Priya Rao', 'orange', 2018], ['Leonardo Diaz', 'yellow', 2017], ['Jake Ross', 'white', 2019], ['Mia Lopez', 'white', 2019],
  ['Maya Chen', 'yellow', 2018], ['Sam Lee', 'green', 2016], ['Ava Kim', 'green', 2016], ['Ben Ortiz', 'white', 2018],
  ['Cal Wu', 'yellow', 2017], ['Dee Park', 'orange', 2017], ['Eli Shah', 'white', 2019], ['Fay Ng', 'yellow', 2018],
  ['Gus Hill', 'green', 2015], ['Ivy Cruz', 'orange', 2016],
] as const

const drill = (name: string, minutes: number, kind: 'warmup' | 'technique' | 'drill' | 'forms' | 'game' | 'sparring', cues: string[], rationale: string, focus: string[] = []) =>
  ({ name, minutes, kind, cues, rationale, focusStudentIds: focus })

export async function seed(db: Db, opts: { today: string; guardianEmail: (i: number) => string }) {
  for (const table of [t.agentRuns, t.reportCards, t.outbox, t.billingFlags, t.issues, t.notes, t.utterances, t.deckDiffs, t.drills, t.decks, t.attendance, t.sessions, t.curriculum, t.enrollments, t.guardians, t.students, t.classes, t.instructors, t.preferences]) {
    await db.delete(table)
  }
  const [ins] = await db.insert(t.instructors).values({ name: 'Coach Galen', email: 'coach@matside.dev' }).returning()
  const [tue, thu] = await db.insert(t.classes).values([
    { instructorId: ins!.id, name: 'Kids · Tue', weekday: 2, startTime: '17:00' },
    { instructorId: ins!.id, name: 'Kids · Thu', weekday: 4, startTime: '17:00' },
  ]).returning()
  const kids = await db.insert(t.students).values(KIDS.map(([name, belt, birthYear]) => ({ name, belt, birthYear, nickname: name.startsWith('Leonardo') ? 'Leo' : null }))).returning()
  await db.insert(t.guardians).values(kids.map((k, i) => ({ studentId: k.id, name: `${k.name.split(' ')[1]} family`, email: opts.guardianEmail(i) })))
  await db.insert(t.enrollments).values(kids.flatMap(k => [{ classId: tue!.id, studentId: k.id }, { classId: thu!.id, studentId: k.id }]))

  const thisWeek = weekStart(opts.today)
  await db.insert(t.curriculum).values([
    { weekStart: addDays(thisWeek, -14), theme: 'Hands', formsDue: ['Kata 1'] },
    { weekStart: addDays(thisWeek, -7), theme: 'Legs', formsDue: ['Kata 1'] },
    { weekStart: thisWeek, theme: 'Stances', formsDue: ['Kata 2 (yellow+)', 'Kata 1 (white)'] },
    { weekStart: addDays(thisWeek, 7), theme: 'Blocks', formsDue: ['Kata 2 (yellow+)'] },
  ])

  const by = (first: string) => kids.find(k => k.name.startsWith(first))!
  const at = (daysAgo: number) => new Date(`${addDays(opts.today, -daysAgo)}T01:00:00Z`)
  await db.insert(t.notes).values([
    { studentId: by('Priya').id, text: 'Guard drops after the jab', tags: ['guard'], createdAt: at(12) },
    { studentId: by('Priya').id, text: 'Hands low when tired in sparring', tags: ['guard'], createdAt: at(5) },
    { studentId: by('Priya').id, text: 'Remembered every move of Kata 1', tags: ['forms'], createdAt: at(8) },
    { studentId: by('Sam').id, text: 'Guard drops on the cross', tags: ['guard'], createdAt: at(10) },
    { studentId: by('Sam').id, text: 'Guard low again', tags: ['guard'], createdAt: at(6) },
    { studentId: by('Sam').id, text: 'Guard drops when kicking', tags: ['guard'], createdAt: at(3) },
    { studentId: by('Ava').id, text: 'Guard low in pad work', tags: ['guard'], createdAt: at(9) },
    { studentId: by('Ava').id, text: 'Kicks getting higher', tags: ['kicks'], createdAt: at(4) },
    { studentId: by('Ben').id, text: 'Guard drops on the jab', tags: ['guard'], createdAt: at(4) },
    { studentId: by('Maya').id, text: 'Front stance too short', tags: ['stance'], createdAt: at(6) },
    { studentId: by('Leonardo').id, text: 'Great respect bowing in', tags: ['respect'], createdAt: at(24) },
    { studentId: by('Cal').id, text: 'Talking in line-up', tags: ['focus'], createdAt: at(7) },
  ])
  await db.insert(t.issues).values([
    { studentId: by('Sam').id, tag: 'guard', openedAt: at(3) },
    { studentId: by('Ava').id, tag: 'guard', openedAt: at(9) },
  ])

  const tueDate = nextDateForWeekday(addDays(opts.today, -1), 2)
  const thuDate = nextDateForWeekday(addDays(opts.today, -1), 4)
  const [tueDeck, thuDeck] = await db.insert(t.decks).values([{ classId: tue!.id, forDate: tueDate }, { classId: thu!.id, forDate: thuDate }]).returning()
  const guardKids = [by('Priya').id, by('Sam').id, by('Ava').id, by('Ben').id]
  const deck = [
    drill('Warm-up: stance tag', 5, 'warmup', ['low stances only'], 'Warm-up on this week\'s theme'),
    drill('Horse stance holds', 4, 'technique', ['knees out', 'back tall'], 'Stances theme'),
    drill('Front stance transitions', 5, 'technique', ['back leg straight', 'hips square'], 'Maya: short front stance', [by('Maya').id]),
    drill('Guard-up jab drill', 6, 'drill', ['hands back to cheeks', 'chin down'], '4 kids have guard notes', guardKids),
    drill('Kata 2 · yellow belts', 8, 'forms', ['slow and sharp'], 'Forms cycle: Kata 2 due'),
    drill('Kata 1 · white belts', 6, 'forms', ['count out loud'], 'Forms cycle: Kata 1'),
    drill('Sharks & minnows', 5, 'game', ['stances when tagged'], 'Fun reset'),
    drill('Pad rotation: kicks', 6, 'drill', ['chamber first'], 'Mixed skill practice'),
    drill('Bow-out & reflection', 2, 'warmup', ['one thing you improved'], 'Calm finish'),
  ]
  for (const d of [tueDeck!, thuDeck!]) await db.insert(t.drills).values(deck.map((x, i) => ({ ...x, deckId: d.id, position: i + 1 })))
  return { instructorId: ins!.id, classIds: { tue: tue!.id, thu: thu!.id }, priyaId: by('Priya').id }
}
```

`api/src/db/seed-cli.ts`:
```ts
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'
import { seed } from './seed'
import { localDate } from '../logic/dates'
import type { Db } from './client'

const url = process.env.DATABASE_URL
const emails = (process.env.SEED_GUARDIAN_EMAILS ?? '').split(',').map(s => s.trim()).filter(Boolean)
if (!url || !emails.length) {
  console.error('Set DATABASE_URL and SEED_GUARDIAN_EMAILS (comma-separated inboxes you own; round-robin across 14 guardians).')
  process.exit(1)
}
const db = drizzle({ client: neon(url), schema }) as unknown as Db
const r = await seed(db, { today: localDate(new Date(), 'America/Los_Angeles'), guardianEmail: i => emails[i % emails.length]! })
console.log('seeded', r)
```

- [ ] **Step 4: Run tests**

Run: `npm test -w api`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/db
git commit -m "feat(api): idempotent demo seed with recurring-issue setup

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
