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
export type Polarity = 'positive' | 'concern' | 'unclear'
export interface Support { name: string; count: number; notes: string[] }
export interface FastAnswer { path: AnswerPath; detail: string; lines: string[]; support: Support[] }

const PROBLEM_Q = "(?:drop\\w*|forget\\w*|forgot|miss\\w*|rush\\w*|los(?:e|es|t|ing)|slip\\w*|mistakes?)"
/** "who never drops their guard", "who doesn't forget to chamber": a negated problem asks for strengths. */
const NEGATED_PROBLEM_Q = new RegExp(`\\b(?:never|not|no longer|doesn['\u2019]?t|don['\u2019]?t|didn['\u2019]?t|without|no)\\s+(?:\\w+\\s+)?${PROBLEM_Q}`)
/** "who keeps their guard up": holding something up asks for strengths... */
const HELD_UP_Q = /\b(?:keep\w*|kept)\s+(?:\w+\s+){0,2}up\b/
/** ...unless it is negated or forgotten ("who is forgetting to keep their guard up", "who isn't keeping it up"). */
const NOT_HELD_Q = /(?:\bnot|\bnever|n['\u2019]t|\bforget\w*|\bforgot|\bfail\w*|\bstop\w*)\s+(?:\w+\s+){0,2}(?:keep\w*|kept)\b/
// A problem word, or a negation next to a praise word ("who isn't doing well"), makes it a concern question.
const CONCERN_Q = new RegExp(`\\b(${PROBLEM_Q}|struggl\\w*|trouble|weak\\w*|bad|poor\\w*|sloppy|needs? (?:work|help)|working on|issues?|problems?|careless|lazy|low|not|\\w+n['\u2019]t|never|lacking|cutting|wrong|behind|talk\\w*)\\b`)
const POSITIVE_Q = /\b(excellent|great|good|best|strong\w*|solid|nice|nail\w*|improv\w*|better|well|clean|sharp|impressive|top|awesome|proud|stand(?:s|ing)? out)\b/

/**
 * Whether a "who…" question asks for problems, for strengths, or neither (then both kinds of evidence are shown).
 * Order matters: a forgotten/negated "keep … up" is a concern, a negated problem or "keep … up" is a strength,
 * then plain problem words, then praise words.
 */
export function questionPolarity(question: string): Polarity {
  const q = question.toLowerCase()
  if (NOT_HELD_Q.test(q)) return 'concern'
  if (NEGATED_PROBLEM_Q.test(q) || HELD_UP_Q.test(q)) return 'positive'
  if (CONCERN_Q.test(q)) return 'concern'
  if (POSITIVE_Q.test(q)) return 'positive'
  return 'unclear'
}

/**
 * Questions answered purely from attendance and today's notes: "how many are here", "who hasn't been noted yet",
 * "how many have I noted". Shared by the answer fast path and the pre-router (which also requires question form).
 */
export function deterministicQuestion(question: string): 'attendance' | 'coverage' | 'coverage_count' | null {
  const q = question.toLowerCase().trim()
  const noteWord = /\b(feedback|notes?|noted|observations?|observed)\b/
  if (/^how many\b/.test(q) && noteWord.test(q)) return 'coverage_count'
  if (has(q, noteWord) && has(q, /\b(no|not|hasn'?t|haven'?t|didn'?t|without|yet|needs?|missing|still)\b/)) return 'coverage'
  if (/^how many\b(?:\s+[\w']+){0,4}?\s+(here|present|absent|came|showed|attend\w*)\b/.test(q)) return 'attendance'
  return null
}

const QUESTION_FORM = /^(?:who|whom|whose|which|how many|has everyone|have i|did i|is everyone|are there|anyone|anybody)\b|\?\s*$/i
/** True when the utterance is plainly a question the class data answers without a model (pre-routing). */
export const isDeterministicQuestion = (t: string): boolean => QUESTION_FORM.test(t.trim()) && deterministicQuestion(t) !== null

function coverageAnswer(f: ClassFacts, count: boolean): FastAnswer {
  const present = presentStudents(f)
  const waiting = present.filter(s => !s.notedToday).map(s => s.first)
  const noted = present.length - waiting.length
  const lines = !present.length ? ['Nobody marked present yet']
    : !waiting.length ? [`Everyone here noted (${present.length})`]
      : count ? [`${noted} of ${present.length} noted today`, ...packList('No observation yet', waiting, ANSWER_LINES - 1)]
        : packList('No observation yet', waiting)
  return { path: 'coverage', detail: count ? 'coverage count' : 'coverage', lines, support: [] }
}

function attendanceAnswer(f: ClassFacts): FastAnswer {
  if (!f.attendanceTaken) return { path: 'attendance', detail: 'attendance', lines: ['No roll call yet', `${f.students.length} on the roster`], support: [] }
  const present = presentStudents(f)
  const absent = f.students.filter(s => !s.presentToday).map(s => s.first)
  const head = `${present.length} here · ${absent.length} absent`
  return { path: 'attendance', detail: 'attendance', lines: absent.length ? [head, ...packList('Absent', absent, ANSWER_LINES - 1)] : [head], support: [] }
}

/**
 * A tag question answered from the evidence that matches its polarity: concerns for problems, praise for strengths,
 * and both (labelled) when the question takes no side ("who has guard notes?").
 */
function tagAnswer(f: ClassFacts, tag: string, polarity: Polarity): FastAnswer {
  const label = tag.charAt(0).toUpperCase() + tag.slice(1)
  const stat = (s: ClassFacts['students'][number]) => s.tagStats[tag]
  if (polarity === 'unclear') {
    const hits = f.students.map(s => ({ s, c: stat(s)?.concern ?? 0, p: stat(s)?.positive ?? 0 })).filter(x => x.c + x.p > 0)
      .sort((a, b) => b.c + b.p - (a.c + a.p) || a.s.first.localeCompare(b.s.first))
    const item = (x: (typeof hits)[number]) => `${x.s.first} (${[x.c ? `${x.c} concern` : '', x.p ? `${x.p} praise` : ''].filter(Boolean).join(', ')})`
    const lines = hits.length ? packList(`${label} notes`, hits.map(item)) : [clip(`No ${tag} notes in ${DIGEST_WINDOW_DAYS} days`, LINE)]
    return { path: 'tag', detail: `tag ${tag} (both)`, lines, support: hits.map(x => ({ name: x.s.first, count: x.c + x.p, notes: [...(stat(x.s)?.concernNotes ?? []), ...(stat(x.s)?.positiveNotes ?? [])].slice(0, 3) })) }
  }
  if (polarity === 'positive') {
    const hits = f.students.map(s => ({ s, n: stat(s)?.positive ?? 0 })).filter(x => x.n > 0)
      .sort((a, b) => b.n - a.n || a.s.first.localeCompare(b.s.first))
    const lines = hits.length ? packList(`Good ${tag}`, hits.map(x => `${x.s.first} (${x.n})`)) : [clip(`No positive ${tag} notes in ${DIGEST_WINDOW_DAYS} days`, LINE)]
    return { path: 'tag', detail: `tag ${tag} (positive)`, lines, support: hits.map(x => ({ name: x.s.first, count: x.n, notes: stat(x.s)!.positiveNotes.slice(0, 3) })) }
  }
  const hits = f.students
    .map(s => ({ s, n: stat(s)?.concern ?? 0, open: s.openIssues.some(i => i.tag === tag), better: Boolean(stat(s)?.latestPositive) }))
    .filter(x => x.n > 0 || x.open)
    .sort((a, b) => b.n - a.n || Number(b.open) - Number(a.open) || a.s.first.localeCompare(b.s.first))
  const item = (x: (typeof hits)[number]) => (x.n ? `${x.s.first} (${x.n}${x.better ? ', improving' : ''})` : x.s.first)
  const lines = hits.length ? packList(label, hits.map(item)) : [clip(`No ${tag} concerns in ${DIGEST_WINDOW_DAYS} days`, LINE)]
  return { path: 'tag', detail: `tag ${tag}`, lines, support: hits.map(x => ({ name: x.s.first, count: x.n, notes: (stat(x.s)?.concernNotes ?? []).slice(0, 3) })) }
}

/** Deterministic answers for questions that clearly map to the data; null sends the question to the model. */
export function fastAnswer(f: ClassFacts, question: string): FastAnswer | null {
  const kind = deterministicQuestion(question)
  if (kind === 'coverage' || kind === 'coverage_count') return coverageAnswer(f, kind === 'coverage_count')
  if (kind === 'attendance') return attendanceAnswer(f)
  const tag = matchTag(f.mode, question)
  if (!tag) return null
  return tagAnswer(f, tag, questionPolarity(question))
}

export function answerInstructions(mode: ModeConfig): string {
  return `You answer a coach's quick question during a live ${mode.label.toLowerCase()} class. The answer shows on smart glasses, so it must be glanceable.
- Answer ONLY from the class digest. Never invent ${mode.people}, numbers, dates or notes.
- Each note is marked concern, praise, improving or neutral. A question about who does something well uses only praise/improving notes; a question about problems uses only concern notes. Never list a ${mode.person} as doing well because of a concern note, or as struggling because of praise.
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
    if (fast) return { result: fast.lines, summary, reason: `fast path: ${fast.detail}`, output: { path: fast.path, lines: fast.lines, support: fast.support } }
    if (isThin(facts)) return { result: [NOT_ENOUGH], summary, reason: 'not enough data yet (no model call)', output: { path: 'thin', lines: [NOT_ENOUGH] } }
    const out = await deps.llm.object({
      name: 'answer', instructions: answerInstructions(facts.mode), schema: RawAnswer,
      prompt: `Question: """${a.question}"""\n\nClass digest:\n${digestText(facts)}`,
    })
    const lines = normalizeAnswer(out.lines)
    return { result: lines, summary, reason: 'model answer from the class digest', output: { path: 'model', lines } }
  })
}
