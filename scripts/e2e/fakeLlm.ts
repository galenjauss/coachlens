/**
 * Deterministic stand-in for the model layer (no network, no randomness). The router answers from a fixed table
 * keyed by the utterance text; the parent-email agent writes a factual draft from the observation in its prompt.
 * Anything not in the table fails fast, exactly like a model outage, and is recorded as `unexpected` so a scenario
 * can assert on it. Every call is logged with its name, the utterance it was for, and the outcome.
 */
import type { Llm } from '../../api/src/deps'

export interface LlmCall { at: string; name: string; utterance: string | null; ok: boolean; unexpected?: boolean; error?: string }

const intent = (o: Record<string, unknown>) => ({
  type: 'feedback', studentNames: [], content: '', skillTags: [], urgency: null, amount: null, minutes: null,
  attendanceStatus: null, urgent: false, ...o,
})
const question = (q: string) => intent({ type: 'question', content: q, question: q })

/** Router outputs by utterance (lower-cased, trailing punctuation trimmed). */
export const ROUTER_TABLE: Record<string, { intents: Record<string, unknown>[] }> = {
  'priya kept her guard up today': { intents: [intent({ studentNames: ['Priya'], content: 'kept her guard up today', skillTags: ['guard'], valence: 'positive', observedWhen: 'today' })] },
  'who keeps their guard up': { intents: [question('Who keeps their guard up?')] },
  'who never drops their guard': { intents: [question('Who never drops their guard?')] },
  // A no-op: the router finds nothing to do.
  'um okay where was i': { intents: [] },
  'dee rolled her ankle and sat out the last drill': { intents: [intent({ studentNames: ['Dee'], content: 'rolled her ankle and sat out the last drill', skillTags: [], valence: 'concern', observedWhen: 'today', urgent: true })] },
  'leo showed excellent stance control today': { intents: [intent({ studentNames: ['Leo'], content: 'showed excellent stance control today', skillTags: ['stance'], valence: 'positive', observedWhen: 'today' })] },
  'maya kept her front stance long': { intents: [intent({ studentNames: ['Maya'], content: 'kept her front stance long', skillTags: ['stance'], valence: 'positive', observedWhen: 'today' })] },
  'cal was calm in line-up': { intents: [intent({ studentNames: ['Cal'], content: 'was calm in line-up', skillTags: ['focus'], valence: 'positive', observedWhen: 'today' })] },
  'fay counted her kata out loud': { intents: [intent({ studentNames: ['Fay'], content: 'counted her kata out loud', skillTags: ['forms'], valence: 'positive', observedWhen: 'today' })] },
  // An unknown name: the note waits in Review for a student pick (F16 roster picker).
  'zed nailed his roundhouse': { intents: [intent({ studentNames: ['Zed'], content: 'nailed his roundhouse', skillTags: ['kicks'], valence: 'positive', observedWhen: 'today' })] },
  'ben listened well in line-up': { intents: [intent({ studentNames: ['Ben'], content: 'listened well in line-up', skillTags: ['focus'], valence: 'positive', observedWhen: 'today' })] },
  'sam hit his head on the mat and sat out': { intents: [intent({ studentNames: ['Sam'], content: 'hit his head on the mat and sat out', skillTags: [], valence: 'concern', observedWhen: 'today', urgent: true })] },
  'gus bumped his nose in sparring and sat out': { intents: [intent({ studentNames: ['Gus'], content: 'bumped his nose in sparring and sat out', skillTags: ['sparring'], valence: 'concern', observedWhen: 'today', urgent: true })] },
  'ivy had great control in partner drills': { intents: [intent({ studentNames: ['Ivy'], content: 'had great control in partner drills', skillTags: ['sparring'], valence: 'positive', observedWhen: 'today' })] },
}

const norm = (s: string) => s.toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ')
const utteranceOf = (prompt: string) => prompt.match(/Utterance: """([\s\S]*?)"""/)?.[1] ?? null

/** "Observation (logged today): rolled her ankle …" → a short factual draft that keeps the observation's words. */
function emailFrom(prompt: string): { subject: string; body: string } {
  const obs = prompt.match(/Observation \(logged [^)]*\): (.+)/)?.[1]?.trim() ?? 'a note from class today'
  const student = prompt.match(/Student: ([A-Z][a-z]+)/)?.[1] ?? prompt.match(/about ([A-Z][a-z]+)/)?.[1] ?? 'your child'
  return {
    subject: `${student}: ${obs}`.slice(0, 120),
    body: `Hello,\n\nA quick note from class today about ${student}: ${obs}. Please reply if you have any questions.\n\nCoach Galen`,
  }
}

export function createFakeLlm(log: LlmCall[], delayFor: (name: string) => number = () => 150): Llm {
  return {
    async object({ name, prompt, schema }) {
      const utterance = utteranceOf(prompt)
      const at = new Date().toISOString()
      await new Promise(r => setTimeout(r, delayFor(name))) // a model call takes a moment; keeps the lens "thinking" stage visible
      try {
        let out: unknown
        if (name === 'router') {
          const hit = utterance ? ROUTER_TABLE[norm(utterance)] : undefined
          if (!hit) throw Object.assign(new Error(`e2e fake: no router script for ${JSON.stringify(utterance)}`), { unexpected: true })
          out = hit
        } else if (name === 'parent_email' || name === 'parent_email.redraft') {
          out = emailFrom(prompt)
        } else {
          throw Object.assign(new Error(`e2e fake: model call "${name}" is not scripted`), { unexpected: true })
        }
        const parsed = schema.parse(out)
        log.push({ at, name, utterance, ok: true })
        return parsed
      } catch (e) {
        const err = e as Error & { unexpected?: boolean }
        log.push({ at, name, utterance, ok: false, unexpected: err.unexpected ?? false, error: err.message })
        throw e
      }
    },
  }
}
