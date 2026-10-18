import { routerOutputFor, type Intent, type ModeConfig, type RosterStudent } from '@matside/shared'
import type { Deps } from '../deps'
import { withRun } from './runs'
import { localDate } from '../logic/dates'
import { capHints, vocabNewestFirst } from '../services/vocab'

const contactLine = (mode: ModeConfig) => (mode.recipient === 'client'
  ? `- parent_message: an explicit request to message the client (the ${mode.person} themself), e.g. "email Tom that…". content = what to tell them.`
  : `- parent_message: an explicit request to contact a ${mode.person}'s parent/guardian. content = what to tell them.`)

const EX: Record<string, string> = {
  martial_arts: '"Leo\'s been a yellow belt since March" -> rank yellow, since March 1 of this year; "Ava got a 9 on her kata" -> metric kata, num 9',
  personal_training: '"Maria hit 225 on deadlift" -> metricKey deadlift, metricNum 225, metricUnit lb; "Tom squatted 185 for five" -> squat 185 lb',
  tutoring: '"Sam got an 88 on the unit test" -> metricKey test, metricValue "Unit 3 test" if spoken, metricNum 88, metricUnit %; "Zoe scored 72 on the fractions quiz" -> quiz 72 %',
}
const QX: Record<string, string> = {
  martial_arts: '"how\'s Priya doing?" or "what did I say about Leo last week?" -> student_query',
  personal_training: '"how\'s Maria doing?" or "what\'s Tom\'s deadlift at?" -> student_query',
  tutoring: '"how\'s Noah doing?" or "what did I say about Zoe last week?" -> student_query',
}

export function routerInstructions(mode: ModeConfig, terms: readonly string[] = []): string {
  return `You are the intake router for CoachLens, a voice assistant used by a coach while teaching a ${mode.label.toLowerCase()} class of ${mode.people}.
Split the coach's spoken utterance into one or more intents. Output every field; use [] or null when unused.
- feedback: an observation about one or more ${mode.people}' technique, work, effort or behavior. studentNames = names exactly as spoken. skillTags: 1-2 from [${mode.tags.join(', ')}] (only these). content = the observation, lightly cleaned, in the coach's voice. Praise counts as feedback.
- billing: money owed, payments, declined cards, fees, packages (e.g. ${mode.billingExamples}). urgency: ALWAYS "high" if the speaker says urgent, "kinda urgent", "pretty urgent", "asap", "right away", or that it is overdue; "low" if casual; else "med". amount in dollars if spoken, else null. Never give financial advice.
- attendance: a ${mode.person} arrived, left, or is absent. attendanceStatus present|absent.
- plan_request: a request about a FUTURE ${mode.planUnit.toLowerCase()} (e.g. "next time more practice on X"). content = the request.
${contactLine(mode)}
- add_drill: adding a ${mode.planItem} to TODAY's ${mode.planUnit.toLowerCase()}. content = ${mode.planItem} name; minutes if spoken.
- metric: a measurable result for ONE ${mode.person}: a rank/belt, a lift or weight, a score or grade. studentNames = who. metricKey = a short lower-case word (rank, deadlift, squat, bench, test, quiz, or the coach's own word). metricValue = the reading as said ("225 lb", "Unit 3 test", "yellow"). metricNum = the number if any, else null. metricUnit = lb, kg, % etc. or null; grades are percents (metricUnit "%"). For rank use metricKey "rank", metricValue = the new rank, and metricSince = the date in YYYY-MM-DD only if the coach says when it began (resolve months against Today); else null. Set metricKey, metricValue, metricNum, metricUnit, metricSince to null on every other intent. Examples: ${EX[mode.id]}. content = the sentence, lightly cleaned. Observations without a number are feedback, not metric.
- student_query: the coach ASKS about a ${mode.person} (how they are doing, what was said about them, their rank or last result); no change is requested. studentNames = who. Examples: ${QX[mode.id]}.
- Injuries or pain: record only as a feedback observation (no diagnosis, no advice).
- urgent: true ONLY for a feedback intent about an injury, a safety concern, or serious behavior (e.g. hitting, bullying, leaving without permission) that a ${mode.recipient === 'client' ? mode.person : 'parent'} should hear today. Everything else, including every non-feedback intent and ordinary corrections or praise, is urgent: false.
- ${mode.guardrails}
- One utterance can hold several intents, e.g. feedback for two ${mode.people} plus a billing note.${terms.length ? `\n- Known terms (the coach's own vocabulary; speech-to-text may mis-hear them, so match close spellings to these): ${terms.join(', ')}.` : ''}`
}

const rosterEntry = (s: RosterStudent) => {
  const also = [s.nickname, ...(s.aliases ?? [])].filter(Boolean).map(x => `"${x}"`)
  return also.length ? `${s.name} (${also.join(', ')})` : s.name
}

export async function routeUtterance(
  deps: Deps,
  a: { sessionId: string; utteranceId?: string | null; transcript: string; roster: RosterStudent[]; drillName: string | null; theme: string; mode: ModeConfig },
): Promise<Intent[] | null> {
  const prompt = [
    `Roster: ${a.roster.map(rosterEntry).join('; ')}`,
    `Current ${a.mode.planItem}: ${a.drillName ?? 'none'}`,
    `${a.mode.weeklyLabel}: ${a.theme}`,
    `Today: ${localDate(deps.now(), deps.env.timeZone)}`,
    `Utterance: """${a.transcript}"""`,
  ].join('\n')
  const terms = capHints(await vocabNewestFirst(deps.db).catch(() => []), 400)
  return withRun(deps, { agent: 'router', trigger: 'utterance', sessionId: a.sessionId, utteranceId: a.utteranceId ?? null }, async () => {
    const out = await deps.llm.object({ name: 'router', instructions: routerInstructions(a.mode, terms), prompt, schema: routerOutputFor(a.mode.id) })
    return {
      result: out.intents,
      summary: `Sorted "${a.transcript.slice(0, 60)}" into ${out.intents.map(i => (i.urgent ? `${i.type} (urgent)` : i.type)).join(', ') || 'nothing'}`,
      reason: `${out.intents.length} intent(s)`,
      output: out,
    }
  })
}
