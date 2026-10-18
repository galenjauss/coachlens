import { routerOutputFor, type Intent, type ModeConfig, type RosterStudent } from '@matside/shared'
import type { Deps } from '../deps'
import { withRun } from './runs'

const contactLine = (mode: ModeConfig) => (mode.recipient === 'client'
  ? `- parent_message: an explicit request to message the client (the ${mode.person} themself), e.g. "email Tom that…". content = what to tell them.`
  : `- parent_message: an explicit request to contact a ${mode.person}'s parent/guardian. content = what to tell them.`)

export function routerInstructions(mode: ModeConfig): string {
  return `You are the intake router for CoachLens, a voice assistant used by a coach while teaching a ${mode.label.toLowerCase()} class of ${mode.people}.
Split the coach's spoken utterance into one or more intents. Output every field; use [] or null when unused.
- feedback: an observation about one or more ${mode.people}' technique, work, effort or behavior. studentNames = names exactly as spoken. skillTags: 1-2 from [${mode.tags.join(', ')}] (only these). content = the observation, lightly cleaned, in the coach's voice. Praise counts as feedback.
- billing: money owed, payments, declined cards, fees, packages (e.g. ${mode.billingExamples}). urgency: ALWAYS "high" if the speaker says urgent, "kinda urgent", "pretty urgent", "asap", "right away", or that it is overdue; "low" if casual; else "med". amount in dollars if spoken, else null. Never give financial advice.
- attendance: a ${mode.person} arrived, left, or is absent. attendanceStatus present|absent.
- plan_request: a request about a FUTURE ${mode.planUnit.toLowerCase()} (e.g. "next time more practice on X"). content = the request.
${contactLine(mode)}
- add_drill: adding a ${mode.planItem} to TODAY's ${mode.planUnit.toLowerCase()}. content = ${mode.planItem} name; minutes if spoken.
- Injuries or pain: record only as a feedback observation (no diagnosis, no advice).
- ${mode.guardrails}
- One utterance can hold several intents, e.g. feedback for two ${mode.people} plus a billing note.`
}

export async function routeUtterance(
  deps: Deps,
  a: { sessionId: string; transcript: string; roster: RosterStudent[]; drillName: string | null; theme: string; mode: ModeConfig },
): Promise<Intent[] | null> {
  const prompt = [
    `Roster: ${a.roster.map(s => (s.nickname ? `${s.name} ("${s.nickname}")` : s.name)).join('; ')}`,
    `Current ${a.mode.planItem}: ${a.drillName ?? 'none'}`,
    `${a.mode.weeklyLabel}: ${a.theme}`,
    `Utterance: """${a.transcript}"""`,
  ].join('\n')
  return withRun(deps, { agent: 'router', trigger: 'utterance', sessionId: a.sessionId }, async () => {
    const out = await deps.llm.object({ name: 'router', instructions: routerInstructions(a.mode), prompt, schema: routerOutputFor(a.mode.id) })
    return {
      result: out.intents,
      summary: `Sorted "${a.transcript.slice(0, 60)}" into ${out.intents.map(i => i.type).join(', ') || 'nothing'}`,
      reason: `${out.intents.length} intent(s)`,
      output: out,
    }
  })
}
