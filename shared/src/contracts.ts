import { z } from 'zod'
import { MODES, ModeId } from './modes'

// Tags are per-mode (see modes.ts). On the wire a tag is any short string; the router validates
// against the class's own taxonomy with routerOutputFor(mode).
/** @deprecated martial-arts tags only; use MODES[mode].tags */
export const SKILL_TAGS = MODES.martial_arts.tags
export const SkillTag = z.string().min(1).max(24)
export type SkillTag = z.infer<typeof SkillTag>

export const Urgency = z.enum(['low', 'med', 'high'])
export type Urgency = z.infer<typeof Urgency>

export const IntentType = z.enum(['feedback', 'attendance', 'billing', 'plan_request', 'parent_message', 'add_drill', 'metric', 'student_query', 'question'])
export type IntentType = z.infer<typeof IntentType>

// Core fields are required and nullable/array for LLM structured output; the metric* fields are nullish so older callers still parse.
/** A real calendar date as YYYY-MM-DD (rejects 2026-02-31). */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const intentShape = <T extends z.ZodType<string>>(tag: T) => z.object({
  type: IntentType,
  studentNames: z.array(z.string()),
  content: z.string(),
  skillTags: z.array(tag).max(2),
  urgency: Urgency.nullable(),
  amount: z.number().nullable(),
  minutes: z.number().int().nullable(),
  attendanceStatus: z.enum(['present', 'absent']).nullable(),
  // Injury, safety or serious behavior: drafts a parent/client note right away (bypasses the email cooldown).
  urgent: z.boolean(),
  // metric intents (nullish so older transports and stubs that omit them still parse).
  metricKey: z.string().max(40).nullish(),
  metricValue: z.string().max(80).nullish(),
  metricNum: z.number().nullish(),
  metricUnit: z.string().max(12).nullish(),
  /** A rank change with a date ("yellow belt since March"): YYYY-MM-DD resolved against today's date. */
  metricSince: z.string().nullish(),
  /** question intents: the coach's question about the class, restated (nullish so older transports still parse). */
  question: z.string().nullish(),
})
export const Intent = intentShape(SkillTag)
export type Intent = z.infer<typeof Intent>

export const RouterOutput = z.object({ intents: z.array(Intent) })
export type RouterOutput = z.infer<typeof RouterOutput>

/** RouterOutput whose skillTags must come from the given mode's taxonomy. */
export function routerOutputFor(mode: ModeId) {
  const tag = z.enum(MODES[mode].tags as [string, ...string[]])
  return z.object({ intents: z.array(intentShape(tag)) })
}

export const ClassSummary = z.object({ id: z.string(), name: z.string(), mode: ModeId, modeLabel: z.string() })
export type ClassSummary = z.infer<typeof ClassSummary>

export const DrillKind = z.enum(['warmup', 'technique', 'drill', 'forms', 'game', 'sparring'])
export type DrillKind = z.infer<typeof DrillKind>

export const DrillDraft = z.object({
  name: z.string().min(1).max(80),
  minutes: z.number().int().min(1).max(30),
  kind: DrillKind,
  cues: z.array(z.string().max(90)).max(2),
  focusStudentIds: z.array(z.string()),
  rationale: z.string().max(240),
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
  /** True while the deck is the generic fallback plan (the planner was unavailable); it self-heals later. */
  isStarter: z.boolean().optional(),
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

// A learned STT spelling must look like a name: 1-3 words of letters, hyphens or apostrophes, each ≥2 chars,
// and not a pronoun, descriptor or group word ("he", "the new kid", "everyone").
const NAME_LIKE = /^[A-Za-z'\u2019-]{2,}(?: [A-Za-z'\u2019-]{2,}){0,2}$/
const ALIAS_STOP = new Set(['he', 'she', 'him', 'her', 'his', 'hers', 'they', 'them', 'their', 'it', 'kid', 'kids', 'boy', 'girl', 'guy', 'everyone', 'everybody', 'all', 'twins', 'someone', 'somebody', 'you', 'me', 'we', 'us'])
export function isNameLike(s: string): boolean {
  const t = s.trim().replace(/\s+/g, ' ')
  if (!NAME_LIKE.test(t)) return false
  const lower = t.toLowerCase()
  if (lower.startsWith('the ')) return false
  return !lower.split(' ').some(w => ALIAS_STOP.has(w.replace(/['\u2019]s$/, '')))
}
export const Alias = z.string().trim().min(2).max(40).refine(isNameLike, 'not a name')
export const MAX_ALIASES = 10
export const RosterStudent = StudentRef.extend({ nickname: z.string().nullable(), belt: z.string(), aliases: z.array(z.string()).optional() })
export type RosterStudent = z.infer<typeof RosterStudent>

export const Coverage = z.object({ covered: z.number().int(), present: z.number().int() })
export type Coverage = z.infer<typeof Coverage>

export const NextStudent = StudentRef.extend({ reason: z.string() })
export type NextStudent = z.infer<typeof NextStudent>

export const Disambiguation = z.object({ noteId: z.string(), heard: z.string(), options: z.array(StudentRef).length(2) })
export type Disambiguation = z.infer<typeof Disambiguation>

export const BRIEF_LINE_MAX = 38
export const BRIEF_LINES_MAX = 5
/** A glanceable student summary for the lens: ≤5 lines of ≤38 chars. */
export const Brief = z.object({ name: z.string(), lines: z.array(z.string().max(BRIEF_LINE_MAX)).max(BRIEF_LINES_MAX) })
export type Brief = z.infer<typeof Brief>
/** Brief.name of a class-question answer: the lens titles it ANSWER instead of a student name. */
export const ANSWER_BRIEF_NAME = 'Answer'

export const UtteranceResponse = z.object({
  utteranceId: z.string(),
  transcript: z.string(),
  cardLines: z.array(z.string()).max(4),
  coverage: Coverage,
  nextStudent: NextStudent.nullable(),
  disambiguation: Disambiguation.nullable(),
  /** Present for a student_query: the lens shows it in place of the agent-progress column. */
  brief: Brief.nullish(),
  /** True when this utterance changed attendance (roll call or a voice "mark present"): the lens polls insights right away. */
  attendanceChanged: z.boolean().optional(),
})
export type UtteranceResponse = z.infer<typeof UtteranceResponse>

export const UtteranceForm = z.object({
  sessionId: z.string().min(1),
  drillId: z.string().min(1).nullable(),
  mode: z.enum(['note', 'attendance']),
  text: z.string().min(1).max(1000).nullable(),
})
export type UtteranceForm = z.infer<typeof UtteranceForm>

/** POST /v1/transcribe: multipart `audio` plus optional `sessionId` or `classId` (roster name hints). */
export const TranscribeForm = z.object({
  sessionId: z.string().min(1).max(64).nullable(),
  classId: z.string().min(1).max(64).nullable(),
})
export type TranscribeForm = z.infer<typeof TranscribeForm>
export const TranscribeResponse = z.object({ transcript: z.string() })
export type TranscribeResponse = z.infer<typeof TranscribeResponse>

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
  mode: ModeId,
  modeLabel: z.string(),
  weeklyLabel: z.string(),
  itemsDueLabel: z.string(),
  planUnit: z.string(),
  people: z.string(),
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

export const MetricSource = z.enum(['voice', 'phone', 'seed'])
export const StudentMetric = z.object({
  id: z.string(), key: z.string(), value: z.string(), num: z.number().nullable(), unit: z.string().nullable(),
  recordedAt: z.string(), source: MetricSource,
})
export type StudentMetric = z.infer<typeof StudentMetric>
export const MetricCreate = z.object({
  key: z.string().trim().min(1).max(40), value: z.string().trim().min(1).max(80),
  num: z.number().finite().nullish(), unit: z.string().trim().max(12).nullish(),
})
export type MetricCreate = z.infer<typeof MetricCreate>

export const StudentDetail = z.object({
  id: z.string(),
  name: z.string(),
  belt: z.string(),
  age: z.number().int().nullable(), // null when unknown (birth year not set)
  classCount: z.number().int(),
  issues: z.array(z.object({ tag: SkillTag, status: z.enum(['open', 'resolved']) })),
  notes: z.array(z.object({ date: z.string(), drillName: z.string().nullable(), text: z.string() })),
  reportCard: z.object({ id: z.string(), month: z.string(), content: ReportCardContent, outboxId: z.string(), status: z.string() }).nullable(),
  rankSince: z.string().nullable(), // YYYY-MM-DD
  metrics: z.array(StudentMetric),
  brief: Brief,
})
export type StudentDetail = z.infer<typeof StudentDetail>

export const SuggestResponse = z.object({ diffId: z.string(), diff: DeckDiff, totalBefore: z.number().int(), totalAfter: z.number().int() })
export type SuggestResponse = z.infer<typeof SuggestResponse>

export const DeckPatch = z.object({ drills: z.array(DrillDraft.extend({ id: z.string().nullable() })).min(1).max(20) })
export type DeckPatch = z.infer<typeof DeckPatch>

export const ReplaceSource = z.union([
  z.enum(['last', 'blank', 'ai']),
  z.object({ deckId: z.string().min(1).max(64) }),
  z.object({ classId: z.string().min(1).max(64) }), // that class's nearest upcoming plan with items, else its latest; never drafts
])
export type ReplaceSource = z.infer<typeof ReplaceSource>
export const ReplaceDeckRequest = z.object({ source: ReplaceSource })
export type ReplaceDeckRequest = z.infer<typeof ReplaceDeckRequest>

export const VOICE_LINE_MAX = 38
export const VOICE_LINES_MAX = 4
export const VoicePlanRequest = z.object({ classId: z.string().min(1).max(64), transcript: z.string().trim().min(1).max(20000) })
export type VoicePlanRequest = z.infer<typeof VoicePlanRequest>
export const VoicePlanResponse = z.object({
  diffId: z.string().nullable(), deckId: z.string().nullable(),
  lines: z.array(z.string().max(VOICE_LINE_MAX)).max(VOICE_LINES_MAX),
})
export type VoicePlanResponse = z.infer<typeof VoicePlanResponse>

export const Alternatives = z.object({ alternatives: z.array(DrillDraft).length(3) })
export type Alternatives = z.infer<typeof Alternatives>

export const StudentPatch = z.object({
  aliases: z.array(Alias).max(MAX_ALIASES).optional(),
  belt: z.string().trim().min(1).max(40).optional(),
  rankSince: z.string().refine(isRealDate, 'not a real date').nullable().optional(),
}).refine(p => p.aliases !== undefined || p.belt !== undefined || p.rankSince !== undefined, 'nothing to change')
export type StudentPatch = z.infer<typeof StudentPatch>

// ---- Agents UI: topic tiles -> color-coded runs -> run detail ----
export const AgentTask = z.enum(['progress', 'parent_email', 'report_card', 'billing', 'planner', 'attendance', 'insights'])
export type AgentTask = z.infer<typeof AgentTask>
export const AGENT_TASK_LABELS: Record<AgentTask, string> = {
  progress: 'Progress notes', parent_email: 'Parent emails', report_card: 'Report cards',
  billing: 'Billing flags', planner: 'Planner', attendance: 'Attendance', insights: 'Insights',
}
/** red = urgent and unhandled (or failed); amber = waiting for review; green = done. */
export const AgentColor = z.enum(['red', 'amber', 'green'])
export type AgentColor = z.infer<typeof AgentColor>

export const AgentRunLinks = z.object({
  outboxId: z.string().optional(),
  billingFlagId: z.string().optional(),
  diffId: z.string().optional(),
  noteId: z.string().optional(),
  studentId: z.string().optional(),
})
export type AgentRunLinks = z.infer<typeof AgentRunLinks>

export const AgentTaskRun = AgentRunView.extend({ color: AgentColor, links: AgentRunLinks })
export type AgentTaskRun = z.infer<typeof AgentTaskRun>

export const AgentTile = z.object({
  task: AgentTask,
  label: z.string(),
  counts: z.object({ today: z.number().int(), pending: z.number().int(), urgent: z.number().int() }),
  color: AgentColor,
  latest: AgentRunView.nullable(),
})
export type AgentTile = z.infer<typeof AgentTile>
export const AgentsSummary = z.array(AgentTile)
export type AgentsSummary = z.infer<typeof AgentsSummary>

export const AgentRunDetail = AgentTaskRun.extend({
  task: AgentTask.nullable(),
  trigger: z.string(),
  utteranceId: z.string().nullable(),
  transcript: z.string().nullable(),
  studentName: z.string().nullable(),
  outbox: z.object({ id: z.string(), kind: z.enum(['parent_email', 'report_card']), to: z.string(), subject: z.string(), body: z.string(), status: z.string(), urgent: z.boolean() }).nullable(),
  billing: z.object({ id: z.string(), note: z.string(), urgency: Urgency, amount: z.number().nullable(), status: z.enum(['open', 'handled']) }).nullable(),
  diff: z.object({ id: z.string(), deckId: z.string(), requestText: z.string(), diff: DeckDiff, status: z.enum(['pending', 'accepted', 'undone']) }).nullable(),
  note: z.object({ id: z.string(), text: z.string(), heard: z.string().nullable(), studentId: z.string().nullable() }).nullable(),
})
export type AgentRunDetail = z.infer<typeof AgentRunDetail>

/** Live agent progress for one utterance (polled by the lens). */
export const UtteranceRun = z.object({ agent: z.string(), summary: z.string(), status: z.enum(['ok', 'error']), createdAt: z.string() })
export type UtteranceRun = z.infer<typeof UtteranceRun>

export const RedraftRequest = z.object({ instruction: z.string().trim().min(2).max(500) })
export type RedraftRequest = z.infer<typeof RedraftRequest>
export const RedraftResponse = z.object({ id: z.string(), kind: z.enum(['parent_email', 'report_card']), subject: z.string(), body: z.string(), status: z.literal('pending_review') })
export type RedraftResponse = z.infer<typeof RedraftResponse>

// ---- Agent autonomy + custom vocabulary (Settings) ----
/** Agents with an autonomy setting (every Agents tile has one). */
export const AutonomyTask = z.enum(['progress', 'parent_email', 'report_card', 'billing', 'planner', 'attendance', 'insights'])
export type AutonomyTask = z.infer<typeof AutonomyTask>
export const Autonomy = z.enum(['auto', 'review', 'off'])
export type Autonomy = z.infer<typeof Autonomy>
export const AUTONOMY_RULES: Record<AutonomyTask, { default: Autonomy; allowed: readonly Autonomy[] }> = {
  parent_email: { default: 'review', allowed: ['auto', 'review', 'off'] },
  report_card: { default: 'review', allowed: ['review', 'off'] },
  planner: { default: 'review', allowed: ['auto', 'review', 'off'] },
  billing: { default: 'auto', allowed: ['auto', 'off'] },
  progress: { default: 'auto', allowed: ['auto', 'off'] },
  attendance: { default: 'auto', allowed: ['auto', 'off'] },
  insights: { default: 'review', allowed: ['auto', 'review', 'off'] },
}
export const MAX_VOCAB = 200
export const VOCAB_TERM_MAX = 40
export const VocabTerm = z.string().trim().min(1).max(VOCAB_TERM_MAX)
export const SettingsPatch = z.object({
  autonomy: z.partialRecord(AutonomyTask, Autonomy).optional(),
  vocabulary: z.array(VocabTerm).max(MAX_VOCAB).optional(),
})
export type SettingsPatch = z.infer<typeof SettingsPatch>
export const SettingsResponse = z.object({
  autonomy: z.record(AutonomyTask, Autonomy),
  vocabulary: z.array(z.string()),
})
export type SettingsResponse = z.infer<typeof SettingsResponse>

// ---- Opportunistic insights (agents notice things and suggest or act) ----
export const InsightKind = z.enum(['attendance_decline', 'returning_student', 'no_feedback', 'ready_to_test', 'new_pr', 'grade_drop', 'issue_resolved', 'billing_repeat'])
export type InsightKind = z.infer<typeof InsightKind>
export const InsightStatus = z.enum(['new', 'accepted', 'dismissed', 'auto_done'])
export type InsightStatus = z.infer<typeof InsightStatus>
export const InsightUrgency = z.enum(['low', 'high'])
export type InsightUrgency = z.infer<typeof InsightUrgency>
export const INSIGHT_TITLE_MAX = 60
export const INSIGHT_DETAIL_MAX = 160
export const INSIGHT_LABEL_MAX = 20
export const INSIGHT_OUTCOME_MAX = 60

/** What accepting an insight does (stored on the row). `label` is the button text, null for no button. */
const label = z.string().min(1).max(INSIGHT_LABEL_MAX)
export const InsightAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('draft_email'), studentId: z.string(), purpose: z.string(), label }),
  z.object({ type: z.literal('plan_focus'), classId: z.string(), studentId: z.string(), text: z.string(), label }),
  // notify: also draft a positive note home once the issue is resolved.
  z.object({ type: z.literal('resolve_issue'), issueId: z.string(), studentId: z.string(), notify: z.boolean(), label }),
  z.object({ type: z.literal('none'), label: z.null() }),
])
export type InsightAction = z.infer<typeof InsightAction>

/** One insight as the lens and phone see it. kind and status stay loose strings so a newer server never breaks a client. */
export const Insight = z.object({
  id: z.string(),
  kind: z.string(),
  studentId: z.string().nullable(),
  studentName: z.string().nullable(),
  classId: z.string().nullable(),
  title: z.string().max(INSIGHT_TITLE_MAX),
  detail: z.string().max(INSIGHT_DETAIL_MAX),
  urgency: InsightUrgency,
  status: z.string(),
  createdAt: z.string(),
  actionLabel: z.string().max(INSIGHT_LABEL_MAX).nullable(),
})
export type Insight = z.infer<typeof Insight>
export const InsightsResponse = z.object({ insights: z.array(Insight) })
export type InsightsResponse = z.infer<typeof InsightsResponse>
export const InsightAcceptResponse = z.object({ ok: z.literal(true), outcome: z.string().max(INSIGHT_OUTCOME_MAX) })
export type InsightAcceptResponse = z.infer<typeof InsightAcceptResponse>
export const InsightsQuery = z.object({
  scope: z.enum(['all', 'class']).default('all'),
  classId: z.string().min(1).max(64).optional(),
  sessionId: z.string().min(1).max(64).optional(),
})
export type InsightsQuery = z.input<typeof InsightsQuery>
