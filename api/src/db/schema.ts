import { pgTable, text, integer, real, timestamp, jsonb, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core'
import type { SkillTag, Urgency, DeckDiff, ReportCardContent } from '@matside/shared'

const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })
const createdAt = () => ts('created_at').notNull().defaultNow()

export const instructors = pgTable('instructors', {
  id: id(), name: text('name').notNull(), email: text('email').notNull(), tokenHash: text('token_hash'),
  tokenHashes: jsonb('token_hashes').$type<string[]>().notNull().default([]),
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
  status: text('status').$type<'pending_review' | 'sending' | 'sent' | 'skipped' | 'error'>().notNull().default('pending_review'),
  error: text('error'), sentAt: ts('sent_at'), createdAt: createdAt(),
})
export const reportCards = pgTable('report_cards', {
  id: id(), studentId: text('student_id').notNull(), month: text('month').notNull(),
  content: jsonb('content').$type<ReportCardContent>().notNull(), outboxId: text('outbox_id').notNull(),
}, t => [uniqueIndex('report_cards_student_month').on(t.studentId, t.month)])
export const agentRuns = pgTable('agent_runs', {
  id: id(), sessionId: text('session_id'), agent: text('agent').notNull(), trigger: text('trigger').notNull(),
  summary: text('summary').notNull(), reason: text('reason').notNull(), output: jsonb('output'),
  status: text('status').$type<'ok' | 'error'>().notNull(), ms: integer('ms').notNull(), createdAt: createdAt(),
})
export const preferences = pgTable('preferences', {
  id: id(), classId: text('class_id').notNull(), text: text('text').notNull(), createdAt: createdAt(),
})
