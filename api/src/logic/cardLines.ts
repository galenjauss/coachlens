import type { Autonomy, SkillTag, Urgency, Valence } from '@matside/shared'
import { clip as clipWords } from './text'

export type CardAction =
  /**
   * count = current concerns with this tag in the window (0 for praise). valence defaults to concern (older callers).
   * historical: a past occurrence, not counted. improving: praise/improvement on an open issue with this tag.
   */
  | { kind: 'feedback'; name: string; tag: SkillTag | null; count: number; recurring: boolean; urgent?: boolean; deck?: Autonomy; mail?: Autonomy; valence?: Valence; historical?: boolean; improving?: boolean }
  | { kind: 'billing'; name: string; urgency: Urgency }
  | { kind: 'attendance'; present: number; absentNames: string[] }
  | { kind: 'marked'; name: string; status: 'present' | 'absent' }
  | { kind: 'parent_note'; name: string }
  | { kind: 'plan_request' }
  | { kind: 'add_drill'; name: string; minutes: number }
  | { kind: 'metric'; name: string; text: string }
  | { kind: 'metric_off' }
  | { kind: 'student_query'; name: string }
  | { kind: 'question'; question: string }
  | { kind: 'answer_failed' }
  | { kind: 'unassigned' }
  | { kind: 'urgent_unassigned' }
  | { kind: 'saved_unsorted' }
  | { kind: 'rollcall_unclear'; names: string[] }
  | { kind: 'name_unclear'; name: string }
  /** Nothing was saved or changed; `hint` is the recovery path. Never an empty card. */
  | { kind: 'nothing_changed'; hint: string }
  /** One intent was skipped by a Settings switch ("Billing flags off"); other intents may still have applied. */
  | { kind: 'skipped'; what: string }

const MAX_LINES = 4
const MAX_CHARS = 38
const ordinal = (n: number) => `${n}${n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`
const clip = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s)

function linesFor(a: CardAction): string[] {
  switch (a.kind) {
    case 'feedback': {
      const urgentLine = a.urgent && a.mail !== 'off'
      const urgent = urgentLine ? ['! urgent · parent note drafting'] : []
      const tag = a.tag ? ` · ${a.tag}` : ''
      const valence = a.valence ?? 'concern'
      if (a.historical) return [`√ ${a.name}${tag} · earlier, not counted`, ...urgent]
      if (valence === 'positive' || valence === 'improving') {
        const word = valence === 'positive' ? 'praise' : 'improving'
        return [`√ ${a.name} · ${word}${tag}`, ...urgent, ...(a.improving && a.tag ? [`→ open ${a.tag} issue: improving`] : [])]
      }
      if (valence === 'neutral') return [`√ ${a.name}${tag}`, ...urgent]
      const head = `√ ${a.name}${tag}${a.count >= 2 ? ` (${ordinal(a.count)} time)` : ''}`
      const deck = a.deck === 'off' ? [] : a.deck === 'review' ? ['→ next deck change to review'] : ['→ added to next deck']
      if (a.recurring) return [head, ...urgent, ...(urgentLine ? [] : ['→ progress logged']), '→ added to report card', ...deck]
      return [head, ...urgent]
    }
    case 'billing': return [`√ Billing flag · ${a.name} · ${a.urgency.toUpperCase()}`]
    case 'attendance': return [`${a.present} present`, ...(a.absentNames.length ? [`absent: ${a.absentNames.join(', ')}`] : [])]
    case 'marked': return [`√ ${a.name} marked ${a.status}`]
    case 'parent_note': return [`→ parent note for ${a.name} drafting`]
    case 'plan_request': return ['√ Planner: next deck suggestion queued']
    case 'add_drill': return [`√ Added: ${a.name} · ${a.minutes}m`]
    case 'metric': return [`√ ${a.name} · ${a.text}`]
    case 'metric_off': return ['● Progress logging off · not saved']
    case 'student_query': return [`${a.name} · see profile`]
    case 'question': return [clipWords(`? ${a.question}`, MAX_CHARS)]
    case 'answer_failed': return ["● Couldn't answer · try again"]
    case 'unassigned': return ['● Saved · pick student in Review']
    case 'urgent_unassigned': return ['! urgent · pick student']
    case 'saved_unsorted': return ['● Saved · sorting failed, see Review']
    case 'name_unclear': return [`? Didn't catch "${a.name}" · say again`]
    case 'nothing_changed': return ['● Nothing changed', a.hint]
    case 'skipped': return [`● ${a.what} · not saved`]
    case 'rollcall_unclear': return [`Didn't catch: ${a.names.join(', ')}`, 'Say it again or use phone roster']
  }
}

const isUrgent = (a: CardAction) => a.kind === 'urgent_unassigned' || (a.kind === 'feedback' && Boolean(a.urgent))

export function buildCardLines(actions: CardAction[]): string[] {
  // Urgent groups go first so the "+N more" overflow can never cut them.
  const ordered = [...actions.filter(isUrgent), ...actions.filter(a => !isUrgent(a))]
  const groups = ordered.map(linesFor)
  const total = groups.reduce((n, g) => n + g.length, 0)
  if (total <= MAX_LINES) return groups.flat().map(clip)
  // Over budget: keep whole groups while leaving the last line for "+N more".
  const out: string[] = []
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!
    if (out.length + g.length <= MAX_LINES - 1) { out.push(...g); continue }
    if (out.length === 0) return (groups.length === 1 ? g.slice(0, MAX_LINES) : [...g.slice(0, MAX_LINES - 1), `+${groups.length - 1} more`]).map(clip)
    out.push(`+${groups.length - i} more`)
    break
  }
  return out.map(clip)
}
