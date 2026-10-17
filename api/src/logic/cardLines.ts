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
  | { kind: 'rollcall_unclear'; names: string[] }

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
    case 'rollcall_unclear': return [`Didn't catch: ${a.names.join(', ')}`, 'Say it again or use phone roster']
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
    if (out.length === 0) return (groups.length === 1 ? g.slice(0, MAX_LINES) : [...g.slice(0, MAX_LINES - 1), `+${groups.length - 1} more`]).map(clip)
    out.push(`+${groups.length - i} more`)
    break
  }
  return out.map(clip)
}
