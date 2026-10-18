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

export const IntentType = z.enum(['feedback', 'attendance', 'billing', 'plan_request', 'parent_message', 'add_drill'])
export type IntentType = z.infer<typeof IntentType>

// Every field is required and nullable/array so it works with LLM structured output.
const intentShape = <T extends z.ZodType<string>>(tag: T) => z.object({
  type: IntentType,
  studentNames: z.array(z.string()),
  content: z.string(),
  skillTags: z.array(tag).max(2),
  urgency: Urgency.nullable(),
  amount: z.number().nullable(),
  minutes: z.number().int().nullable(),
  attendanceStatus: z.enum(['present', 'absent']).nullable(),
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

export const SuggestResponse = z.object({ diffId: z.string(), diff: DeckDiff, totalBefore: z.number().int(), totalAfter: z.number().int() })
export type SuggestResponse = z.infer<typeof SuggestResponse>

export const DeckPatch = z.object({ drills: z.array(DrillDraft.extend({ id: z.string().nullable() })).min(1).max(20) })
export type DeckPatch = z.infer<typeof DeckPatch>

export const Alternatives = z.object({ alternatives: z.array(DrillDraft).length(3) })
export type Alternatives = z.infer<typeof Alternatives>
