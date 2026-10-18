// The answer agent: a coach's spoken class question ("who is forgetting to keep their guard up?") answered on the lens.
// Deterministic fast paths cover the common asks with no LLM; anything else goes to the fast model over the class digest.
import { z } from 'zod'
import { BRIEF_LINE_MAX, type ModeConfig } from '@matside/shared'
import type { Deps } from '../deps'
import { withRun } from './runs'
import { clip } from '../logic/text'
import { DIGEST_WINDOW_DAYS, digestText, isThin, loadClassFacts, presentStudents, type ClassFacts } from '../services/classDigest'

export const ANSWER_LINES = 4
export const NOT_ENOUGH = 'Not enough notes yet'
const LINE = BRIEF_LINE_MAX

/** Lenient model output: any strings; normalizeAnswer enforces the lens limits in code. */
export const RawAnswer = z.object({ lines: z.array(z.string()) })

/** Spoken words for each tag beyond the tag itself (regex sources, matched on word boundaries). */
const TAG_WORDS: Record<string, string[]> = {
  guard: ['guards?', 'hands? up', 'hands? down', 'drop(?:s|ping)? (?:their |his |her )?hands'],
  stance: ['stances?'],
  kicks: ['kicks?', 'kicking'],
  strikes: ['strikes?', 'striking', 'punch(?:es|ing)?'],
  forms: ['forms?', 'kata', 'poomsae'],
  footwork: ['footwork', 'feet'],
  focus: ['focus(?:ing)?', 'paying attention', 'listening'],
  effort: ['effort', 'trying'],
  respect: ['respect(?:ful)?', 'manners'],
  sparring: ['spar(?:ring)?'],
  form: ['form', 'technique'],
  depth: ['depth', 'deep enough'],
  tempo: ['tempo', 'rushing'],
  bracing: ['brac(?:e|ing)', 'core'],
  range: ['range(?: of motion)?', 'mobility'],
  breathing: ['breath(?:e|ing)?'],
  load: ['load', 'weight'],
  consistency: ['consisten(?:t|cy)'],
  recovery: ['recover(?:y|ing)?'],
  concept: ['concepts?'],
  procedure: ['procedures?', 'steps'],
  accuracy: ['accura(?:te|cy)', 'careless'],
  speed: ['speed', 'too slow'],
  vocabulary: ['vocab(?:ulary)?'],
  reasoning: ['reasoning'],
  confidence: ['confiden(?:t|ce)'],
  homework: ['homework'],
}

const has = (q: string, re: RegExp) => re.test(q)

/** The mode tag a "who…" question is about, or null. */
export function matchTag(mode: ModeConfig, question: string): string | null {
  const q = question.toLowerCase()
  if (!has(q, /\b(who|whose|which|anyone|anybody)\b/)) return null
  for (const tag of mode.tags) {
    const words = [tag, ...(TAG_WORDS[tag] ?? [])]
    if (words.some(w => new RegExp(`\\b(?:${w})\\b`).test(q))) return tag
  }
  return null
}

/**
 * "Head: A, B, C" packed into ≤`max` lines of ≤38 chars at item boundaries; overflow ends in "+N more".
 */
export function packList(head: string, items: readonly string[], max = ANSWER_LINES): string[] {
  const wrap = (xs: readonly string[]) => {
    const lines: string[] = []
    let cur = `${head}:`
    xs.forEach((x, i) => {
      const token = i < xs.length - 1 ? `${x},` : x
      if (`${cur} ${token}`.length <= LINE) cur = `${cur} ${token}`
      else { lines.push(cur); cur = token }
    })
    lines.push(cur)
    return lines.map(l => clip(l, LINE))
  }
  for (let k = items.length; k >= 0; k--) {
    const shown = k < items.length ? [...items.slice(0, k), `+${items.length - k} more`] : items
    const lines = wrap(shown)
    if (lines.length <= max) return lines
  }
  return [clip(head, LINE)]
}

export type AnswerPath = 'tag' | 'coverage' | 'attendance'

/** Deterministic answers for questions that clearly map to the data; null sends the question to the model. */
export function fastAnswer(f: ClassFacts, question: string): { path: AnswerPath; detail: string; lines: string[] } | null {
  const q = question.toLowerCase()
  if (has(q, /\b(feedback|notes?)\b/) && has(q, /\b(no|not|hasn'?t|haven'?t|didn'?t|without|yet|needs?|missing|still)\b/)) {
    const present = presentStudents(f)
    const waiting = present.filter(s => !s.notedToday).map(s => s.first)
    const lines = !present.length ? ['Nobody marked present yet']
      : !waiting.length ? [`Everyone here has feedback (${present.length})`]
        : packList('No feedback yet', waiting)
    return { path: 'coverage', detail: 'coverage', lines }
  }
  if (has(q, /\bhow many\b/) && has(q, /\b(here|present|came|showed|in class|attend\w*|today|absent)\b/)) {
    if (!f.attendanceTaken) return { path: 'attendance', detail: 'attendance', lines: ['No roll call yet', `${f.students.length} on the roster`] }
    const present = presentStudents(f)
    const absent = f.students.filter(s => !s.presentToday).map(s => s.first)
    const head = `${present.length} here · ${absent.length} absent`
    return { path: 'attendance', detail: 'attendance', lines: absent.length ? [head, ...packList('Absent', absent, ANSWER_LINES - 1)] : [head] }
  }
  const tag = matchTag(f.mode, question)
  if (tag) {
    const hits = f.students
      .map(s => ({ s, n: s.tagCounts[tag] ?? 0, open: s.openIssues.some(i => i.tag === tag) }))
      .filter(x => x.n > 0 || x.open)
      .sort((a, b) => b.n - a.n || Number(b.open) - Number(a.open) || a.s.first.localeCompare(b.s.first))
    const label = tag.charAt(0).toUpperCase() + tag.slice(1)
    const lines = hits.length ? packList(label, hits.map(x => (x.n ? `${x.s.first} (${x.n})` : x.s.first))) : [clip(`No ${tag} notes in ${DIGEST_WINDOW_DAYS} days`, LINE)]
    return { path: 'tag', detail: `tag ${tag}`, lines }
  }
  return null
}

export function answerInstructions(mode: ModeConfig): string {
  return `You answer a coach's quick question during a live ${mode.label.toLowerCase()} class. The answer shows on smart glasses, so it must be glanceable.
- Answer ONLY from the class digest. Never invent ${mode.people}, numbers, dates or notes.
- At most ${ANSWER_LINES} lines, each at most ${LINE} characters. Names first (first names), then the reason, e.g. "Priya · guard 3× in ${DIGEST_WINDOW_DAYS}d".
- If the digest does not hold enough to answer, reply with exactly one line: "${NOT_ENOUGH}".
- No medical, injury, nutrition, financial or safety advice; for those reply "Ask a professional".
- Plain text only: no markdown, bullets or emoji.`
}

/** Model lines → ≤4 lines of ≤38 chars cut at word boundaries; nothing usable → "Not enough notes yet". */
export function normalizeAnswer(raw: readonly string[]): string[] {
  const lines = raw.flatMap(l => l.split('\n')).map(l => clip(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/[*_`#]/g, ''), LINE)).filter(Boolean)
  return lines.length ? lines.slice(0, ANSWER_LINES) : [NOT_ENOUGH]
}

export interface AnswerArgs { sessionId: string; drillId: string | null; utteranceId: string | null; question: string }

/** The answer lines, or null when answering failed (budget reached, model error): the run is logged either way. */
export async function answerQuestion(deps: Deps, a: AnswerArgs): Promise<string[] | null> {
  return withRun(deps, { agent: 'answer', trigger: 'question', sessionId: a.sessionId, utteranceId: a.utteranceId }, async () => {
    const summary = clip(a.question, 120)
    const facts = await loadClassFacts(deps.db, a.sessionId, a.drillId, deps.now(), deps.env.timeZone)
    const fast = fastAnswer(facts, a.question)
    if (fast) return { result: fast.lines, summary, reason: `fast path: ${fast.detail}`, output: { path: fast.path, lines: fast.lines } }
    if (isThin(facts)) return { result: [NOT_ENOUGH], summary, reason: 'not enough data yet (no model call)', output: { path: 'thin', lines: [NOT_ENOUGH] } }
    const out = await deps.llm.object({
      name: 'answer', instructions: answerInstructions(facts.mode), schema: RawAnswer,
      prompt: `Question: """${a.question}"""\n\nClass digest:\n${digestText(facts)}`,
    })
    const lines = normalizeAnswer(out.lines)
    return { result: lines, summary, reason: 'model answer from the class digest', output: { path: 'model', lines } }
  })
}
