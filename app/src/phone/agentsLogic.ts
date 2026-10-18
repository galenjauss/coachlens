import { AGENT_TASK_LABELS, AUTONOMY_RULES, MAX_VOCAB, VOCAB_TERM_MAX, type AgentColor, type AgentRunDetail, type AgentTask, type AgentTile, type Autonomy } from '@matside/shared'

const COLOR_RANK: Record<AgentColor, number> = { red: 0, amber: 1, green: 2 }
/** Text that backs up the color so it is never the only signal. */
export const COLOR_WORD: Record<AgentColor, string> = { red: 'Urgent', amber: 'Needs review', green: 'Done' }

/** Red tiles first, then amber, then green; ties by today's volume, then label. Does not mutate. */
export function sortTiles(tiles: readonly AgentTile[]): AgentTile[] {
  return [...tiles].sort((a, b) => COLOR_RANK[a.color] - COLOR_RANK[b.color] || b.counts.today - a.counts.today || a.label.localeCompare(b.label))
}

export function taskLabel(task: AgentTask | string): string {
  return task in AGENT_TASK_LABELS ? AGENT_TASK_LABELS[task as AgentTask] : task
}

/** The tile whose latest run is newest, or null when nothing has run yet. */
export function latestTile(tiles: readonly AgentTile[]): AgentTile | null {
  let best: AgentTile | null = null
  for (const t of tiles) if (t.latest && (!best?.latest || t.latest.createdAt > best.latest.createdAt)) best = t
  return best
}

/** One-line status under a tile's big number. */
export function tileStatus(t: AgentTile): string {
  const { urgent, pending } = t.counts
  if (urgent > 0) return `${urgent} urgent`
  if (pending > 0) return `${pending} to review`
  return t.counts.today > 0 ? 'all done' : 'quiet today'
}

export function tileAriaLabel(t: AgentTile): string {
  return `${t.label}: ${t.counts.today} today, ${tileStatus(t)}. ${COLOR_WORD[t.color]}.`
}

export type Steering = 'redraft' | 'suggest' | 'reassign' | 'billing_note' | 'none'

/** Which "Tell this agent…" action a run supports, from what it actually produced. */
export function steeringFor(r: Pick<AgentRunDetail, 'task' | 'outbox' | 'diff' | 'note' | 'billing'>): Steering {
  if (r.outbox?.status === 'pending_review') return 'redraft'
  if (r.diff?.status === 'pending') return 'suggest'
  if (r.billing?.status === 'open') return 'billing_note'
  if (r.task === 'progress' && r.note) return 'reassign'
  return 'none'
}

export const STEERING_PROMPT: Record<Exclude<Steering, 'none'>, { placeholder: string; button: string }> = {
  redraft: { placeholder: 'e.g. shorter, mention the belt test', button: 'Redraft' },
  suggest: { placeholder: 'e.g. swap the warm-up for more footwork', button: 'Suggest new plan' },
  reassign: { placeholder: '', button: '' },
  billing_note: { placeholder: 'Add a note to this flag…', button: 'Save note' },
}

export function relTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/** Clean an alias draft; null when it is empty, too long, a duplicate (case-insensitive), or over the cap. */
export function addAlias(list: readonly string[], draft: string, max = 10, maxLen = 40): { list: string[] } | { error: string } {
  const a = draft.trim()
  if (!a) return { error: 'Type a nickname first.' }
  if (a.length > maxLen) return { error: `Keep it under ${maxLen} characters.` }
  if (list.some(x => x.toLowerCase() === a.toLowerCase())) return { error: 'Already added.' }
  if (list.length >= max) return { error: `Up to ${max} nicknames.` }
  return { list: [...list, a] }
}
export const removeAlias = (list: readonly string[], alias: string): string[] => list.filter(a => a !== alias)

/**
 * Reassign chips for a note: the note's class roster when we know it (the stored class's roster), so a
 * tap can't hit "student not in class"; every student only when no class is known (`classRoster` null).
 */
export function reassignChoices<S extends { id: string }>(classRoster: S[] | null, all: S[] | null): { students: S[] | null; scoped: boolean } {
  if (classRoster) return { students: classRoster, scoped: true }
  return { students: all, scoped: false }
}

// ---- Autonomy (Auto · Review · Off) and custom vocabulary ----
export const AUTONOMY_LABEL: Record<Autonomy, string> = { auto: 'Auto', review: 'Review', off: 'Off' }

/** One sentence per agent and mode: what that choice does. Only the modes the agent allows are offered. */
export const AUTONOMY_COPY: Record<AgentTask, Partial<Record<Autonomy, string>>> = {
  parent_email: {
    auto: 'Writes the email and sends it right away. No review step.',
    review: 'Writes the email and waits for your OK in Review before anything is sent.',
    off: 'Doesn’t write parent emails at all. Each skipped one is logged.',
  },
  report_card: {
    review: 'Drafts monthly report cards and waits for your OK before they’re sent.',
    off: 'Doesn’t draft report cards.',
  },
  planner: {
    auto: 'Applies its own changes to next class’s plan as it goes.',
    review: 'Suggests changes to next class’s plan and waits for you to accept them.',
    off: 'Doesn’t adjust next class’s plan on its own. Your explicit requests still make suggestions.',
  },
  billing: {
    auto: 'Records billing flags from what you say. Notes only, never a payment.',
    off: 'Ignores billing mentions.',
  },
  progress: {
    auto: 'Logs your notes and tracks recurring issues for report cards and plans.',
    off: 'Still saves your notes, but stops tracking recurring issues.',
  },
  attendance: {
    auto: 'Marks who’s here or absent when you say so.',
    off: 'Ignores spoken attendance. Use the roster instead.',
  },
  insights: {
    auto: 'Spots patterns and acts on them (emails and plans still follow their own settings).',
    review: 'Spots patterns and suggests an action you accept or dismiss.',
    off: 'Doesn’t look for patterns.',
  },
}

export const autonomyOptions = (task: AgentTask): Autonomy[] =>
  (['auto', 'review', 'off'] as const).filter(m => AUTONOMY_RULES[task].allowed.includes(m))

/** Next index for ←/→ (wraps); null for other keys. */
export function radioStep(key: string, i: number, n: number): number | null {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n
  return null
}

/** Adds a vocabulary term (trim, 40 chars, no case-insensitive duplicates, 200 max). */
export function addVocabTerm(list: readonly string[], draft: string, max = MAX_VOCAB, maxLen = VOCAB_TERM_MAX): { list: string[] } | { error: string } {
  const t = draft.trim().replace(/\s+/g, ' ')
  if (!t) return { error: 'Type a word first.' }
  if (t.length > maxLen) return { error: `Keep it under ${maxLen} characters.` }
  if (list.some(x => x.toLowerCase() === t.toLowerCase())) return { error: 'Already added.' }
  if (list.length >= max) return { error: `Up to ${max} words.` }
  return { list: [...list, t] }
}
export const removeVocabTerm = (list: readonly string[], term: string): string[] => list.filter(x => x !== term)
