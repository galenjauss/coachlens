import { pgTable, text, integer, real, timestamp, jsonb, primaryKey, uniqueIndex, index, boolean, date, doublePrecision } from 'drizzle-orm/pg-core'
import type { ModeId, SkillTag, Urgency, Valence, DeckDiff, DrillDraft, ReportCardContent, AgentRunLinks, InsightAction, InsightKind, InsightStatus, InsightUrgency } from '@matside/shared'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = (name = 'created_at') => ts(name).notNull().defaultNow()

export const instructors = pgTable('instructors', {
  id: id(), name: text('name').notNull(), email: text('email').notNull(), tokenHash: text('token_hash'),
  tokenHashes: jsonb('token_hashes').$type<string[]>().notNull().default([]),
  // Set by onboarding (Task 24); null until the coach finishes the quiz.
  schoolName: text('school_name'), timeZone: text('time_zone'),
  // SHA-256 of the instructor's reusable pairing code (C4). Null until set by the seed, rotation or the env bootstrap.
  pairingCodeHash: text('pairing_code_hash'),
}, t => [uniqueIndex('instructors_pairing_code_hash').on(t.pairingCodeHash)])
// One row per paired phone (C4): tokens expire after 90 days and can be revoked by POST /v1/unpair.
export const apiTokens = pgTable('api_tokens', {
  id: id(), instructorId: text('instructor_id').notNull(), tokenHash: text('token_hash').notNull(),
  createdAt: createdAt(), expiresAt: ts('expires_at').notNull(), revokedAt: ts('revoked_at'),
}, t => [uniqueIndex('api_tokens_hash').on(t.tokenHash), index('api_tokens_instructor').on(t.instructorId, t.createdAt)])
export const classes = pgTable('classes', {
  id: id(), instructorId: text('instructor_id').notNull(), name: text('name').notNull(),
  weekday: integer('weekday').notNull(), // 0 = Sunday
  startTime: text('start_time').notNull(), // "17:00"
  mode: text('mode').$type<ModeId>().notNull().default('martial_arts'),
  remindIds: jsonb('remind_ids').$type<string[]>().notNull().default([]),
})
export const students = pgTable('students', {
  id: id(), name: text('name').notNull(), nickname: text('nickname'), belt: text('belt').notNull(), birthYear: integer('birth_year').notNull(),
  aliases: jsonb('aliases').$type<string[]>().notNull().default([]), // learned STT spellings, max 10
  rankSince: date('rank_since', { mode: 'string' }), // YYYY-MM-DD; time in rank is derived from it
  // Owner (C4). Legacy rows may be null: those are owned through an enrollment in the instructor's class.
  instructorId: text('instructor_id'),
}, t => [index('students_instructor').on(t.instructorId)])
export const guardians = pgTable('guardians', {
  id: id(), studentId: text('student_id').notNull(), name: text('name').notNull(), email: text('email').notNull(),
})
export const enrollments = pgTable('enrollments', {
  classId: text('class_id').notNull(), studentId: text('student_id').notNull(),
}, t => [primaryKey({ columns: [t.classId, t.studentId] })])
export const curriculum = pgTable('curriculum', {
  weekStart: text('week_start').notNull(), // Monday, YYYY-MM-DD
  mode: text('mode').$type<ModeId>().notNull().default('martial_arts'),
  theme: text('theme').notNull(), // the mode's weekly label: theme / program block / unit
  formsDue: jsonb('forms_due').$type<string[]>().notNull(), // the mode's items-due: forms / goals / upcoming
}, t => [primaryKey({ columns: [t.weekStart, t.mode] })])
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
  // Starter-plan fallback bookkeeping: a starter deck is re-drafted by the LLM later (rate-limited by lastAttemptAt).
  isStarter: boolean('is_starter').notNull().default(false),
  createdAt: createdAt(),
  lastAttemptAt: ts('last_attempt_at'),
}, t => [uniqueIndex('decks_class_date').on(t.classId, t.forDate)])
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
  // Drills as they were before an applied-on-creation diff (voice plan), so undo can restore them. Null for ordinary suggestions.
  before: jsonb('before').$type<(DrillDraft & { id: string })[] | null>(),
  status: text('status').$type<'pending' | 'accepted' | 'undone'>().notNull().default('pending'),
  createdAt: createdAt(),
  utteranceId: text('utterance_id'), // the voice note that asked for it (C2: its Undo reverts or withdraws it)
}, t => [index('deck_diffs_utterance').on(t.utteranceId)])
export const utterances = pgTable('utterances', {
  id: id(), sessionId: text('session_id'), transcript: text('transcript').notNull(),
  mode: text('mode').$type<'note' | 'attendance'>().notNull(), createdAt: createdAt(),
  // Set once by POST /v1/utterances/:id/undo (C2): deferred work checks it before writing or sending.
  undoneAt: ts('undone_at'),
})
export const notes = pgTable('notes', {
  id: id(), sessionId: text('session_id'), utteranceId: text('utterance_id'), studentId: text('student_id'),
  heard: text('heard'), drillId: text('drill_id'), text: text('text').notNull(),
  tags: jsonb('tags').$type<SkillTag[]>().notNull().default([]), createdAt: createdAt(),
  urgent: boolean('urgent').notNull().default(false), // urgent feedback still waiting for a student pick
  // What the observation means (concern | positive | improving | neutral); null on rows written before 0013 (inferred from text).
  valence: text('valence').$type<Valence>(),
  // The coach described a past occurrence ("last week…"): kept as a note, never counted as a new one.
  historical: boolean('historical').notNull().default(false),
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
  status: text('status').$type<'pending_review' | 'sending' | 'sent' | 'skipped' | 'error' | 'cancelled'>().notNull().default('pending_review'),
  error: text('error'), sentAt: ts('sent_at'), createdAt: createdAt(),
  // What drafted it: request | urgent | recurring | monthly (null on rows drafted before v2).
  trigger: text('trigger'),
  utteranceId: text('utterance_id'), // the utterance whose action drafted it (C2: Undo cancels it while unsent)
}, t => [index('outbox_utterance').on(t.utteranceId)])
export const reportCards = pgTable('report_cards', {
  id: id(), studentId: text('student_id').notNull(), month: text('month').notNull(),
  content: jsonb('content').$type<ReportCardContent>().notNull(), outboxId: text('outbox_id').notNull(),
}, t => [uniqueIndex('report_cards_student_month').on(t.studentId, t.month)])
export const agentRuns = pgTable('agent_runs', {
  id: id(), sessionId: text('session_id'), agent: text('agent').notNull(), trigger: text('trigger').notNull(),
  summary: text('summary').notNull(), reason: text('reason').notNull(), output: jsonb('output'),
  status: text('status').$type<'ok' | 'error'>().notNull(), ms: integer('ms').notNull(), createdAt: createdAt(),
  utteranceId: text('utterance_id'), links: jsonb('links').$type<AgentRunLinks>(),
  instructorId: text('instructor_id'), // set from the request scope (C4)
}, t => [index('agent_runs_utterance').on(t.utteranceId), index('agent_runs_agent_created').on(t.agent, t.createdAt), index('agent_runs_instructor_created').on(t.instructorId, t.createdAt)])
export const preferences = pgTable('preferences', {
  id: id(), classId: text('class_id').notNull(), text: text('text').notNull(), createdAt: createdAt(),
})
// One row per local day (America/Los_Angeles by default): AI calls made that day, for the daily cap.
export const llmUsage = pgTable('llm_usage', {
  day: text('day').primaryKey(), calls: integer('calls').notNull().default(0),
})
// Per-agent autonomy ('auto' | 'review' | 'off'); a missing row means that task's default.
export const agentSettings = pgTable('agent_settings', {
  task: text('task').primaryKey(), autonomy: text('autonomy').notNull(),
})
// Per-instructor autonomy (C4). agent_settings above is the legacy deployment-wide table, read only outside a request scope.
export const instructorSettings = pgTable('instructor_settings', {
  instructorId: text('instructor_id').notNull(), task: text('task').notNull(), autonomy: text('autonomy').notNull(),
}, t => [primaryKey({ columns: [t.instructorId, t.task] })])
// Per-instructor vocabulary (C4); school_vocab below is the legacy deployment-wide table.
export const instructorVocab = pgTable('instructor_vocab', {
  instructorId: text('instructor_id').notNull(), term: text('term').notNull(), createdAt: createdAt(),
}, t => [primaryKey({ columns: [t.instructorId, t.term] })])
// Per-instructor weekly themes (C4). The shared curriculum table is the demo catalog used when an instructor has none.
export const instructorCurriculum = pgTable('instructor_curriculum', {
  instructorId: text('instructor_id').notNull(), weekStart: text('week_start').notNull(),
  mode: text('mode').$type<ModeId>().notNull(), theme: text('theme').notNull(), formsDue: jsonb('forms_due').$type<string[]>().notNull(),
}, t => [primaryKey({ columns: [t.instructorId, t.weekStart, t.mode] })])
// Instructor's custom words (names of moves, studio jargon) fed to speech-to-text and the router.
export const schoolVocab = pgTable('school_vocab', {
  term: text('term').primaryKey(), createdAt: createdAt(),
})
// Per-student measurements: rank, lift PRs, test grades, or any custom field. Higher-is-better logic lives in logic/metrics.ts.
export const studentMetrics = pgTable('student_metrics', {
  id: id(), studentId: text('student_id').notNull(), key: text('key').notNull(), value: text('value').notNull(),
  num: doublePrecision('num'), unit: text('unit'), recordedAt: createdAt('recorded_at'),
  source: text('source').$type<'voice' | 'phone' | 'seed'>().notNull(), utteranceId: text('utterance_id'),
}, t => [index('student_metrics_student_key').on(t.studentId, t.key, t.recordedAt)])
// Opportunistic insights: detector findings the coach can accept or dismiss. dedupe_key = kind:student:ISO week.
// session_id: the live session a finding was made in (the lens shows only that session's high items).
export const insights = pgTable('insights', {
  id: id(), kind: text('kind').$type<InsightKind>().notNull(),
  studentId: text('student_id'), classId: text('class_id'), sessionId: text('session_id'),
  title: text('title').notNull(), detail: text('detail').notNull(),
  urgency: text('urgency').$type<InsightUrgency>().notNull(),
  action: jsonb('action').$type<InsightAction>().notNull(),
  status: text('status').$type<InsightStatus>().notNull().default('new'),
  outcome: text('outcome'),
  dedupeKey: text('dedupe_key').notNull(), createdAt: createdAt(), actedAt: ts('acted_at'),
}, t => [uniqueIndex('insights_dedupe_key').on(t.dedupeKey), index('insights_status_created').on(t.status, t.createdAt)])
// Tiny key/value store for best-effort bookkeeping (e.g. when the insights detectors last ran).
export const kv = pgTable('kv', {
  key: text('key').primaryKey(), value: text('value').notNull(), updatedAt: createdAt('updated_at'),
})

// C2 · action ledger: one row per state change an utterance applied that is not a plain insert tagged with
// utterance_id (attendance, rank/rank_since, issues opened, drills added and positions shifted). before/after
// hold the values needed to compensate. Inserts tagged with utterance_id (notes, billing flags, metrics, outbox
// drafts, deck diffs) are found through that column.
export const actionLedger = pgTable('action_ledger', {
  id: id(), utteranceId: text('utterance_id').notNull(),
  kind: text('kind').$type<'attendance' | 'rank' | 'issue' | 'drill_added' | 'deck_drafted'>().notNull(),
  entityId: text('entity_id').notNull(), before: jsonb('before'), after: jsonb('after'), createdAt: createdAt(),
}, t => [index('action_ledger_utterance').on(t.utteranceId, t.createdAt)])
// C1 + C2 · deferred agent work started by an utterance, one row per (utterance, kind, subject): a re-run never
// enqueues it twice, and Undo flips pending/running rows to cancelled.
export const deferredTasks = pgTable('deferred_tasks', {
  id: id(), utteranceId: text('utterance_id').notNull(), kind: text('kind').notNull(), subject: text('subject').notNull().default(''),
  status: text('status').$type<'pending' | 'running' | 'done' | 'failed' | 'cancelled'>().notNull().default('pending'),
  createdAt: createdAt(), updatedAt: ts('updated_at'),
}, t => [uniqueIndex('deferred_tasks_once').on(t.utteranceId, t.kind, t.subject)])
// C1 · idempotency: one row per (instructor, Idempotency-Key). done rows replay their stored response.
export const operations = pgTable('operations', {
  instructorId: text('instructor_id').notNull(), key: text('key').notNull(), route: text('route').notNull(),
  status: text('status').$type<'pending' | 'done'>().notNull().default('pending'),
  responseJson: text('response_json'), createdAt: createdAt(), // the exact JSON text sent, replayed byte for byte
}, t => [primaryKey({ columns: [t.instructorId, t.key] })])
// S1 · pairing attempt counters shared by every instance (fixed window per bucket: an IP, or a code prefix).
export const pairAttempts = pgTable('pair_attempts', {
  bucket: text('bucket').primaryKey(), count: integer('count').notNull().default(0), windowStart: ts('window_start').notNull(),
})
// S2 · per-instructor AI calls per local day (the global llm_usage cap stays the ceiling).
export const llmUsageInstructor = pgTable('llm_usage_instructor', {
  instructorId: text('instructor_id').notNull(), day: text('day').notNull(), calls: integer('calls').notNull().default(0),
}, t => [primaryKey({ columns: [t.instructorId, t.day] })])
