import { RouterOutput, SKILL_TAGS, type Intent, type RosterStudent } from '@matside/shared'
import type { Deps } from '../deps'
import { withRun } from './runs'

export const ROUTER_INSTRUCTIONS = `You are the intake router for MatSide, a voice assistant used by a kids' martial arts instructor while teaching class.
Split the instructor's spoken utterance into one or more intents. Output every field; use [] or null when unused.
- feedback: an observation about one or more students' technique, effort or behavior. studentNames = names exactly as spoken. skillTags: 1-2 from [${SKILL_TAGS.join(', ')}]. content = the observation, lightly cleaned, in the instructor's voice. Praise counts as feedback.
- billing: money owed, payments, declined cards, fees, gear purchases. urgency: "high" if urgent/asap/overdue a while, "low" if casual, else "med". amount in dollars if spoken, else null. Never give financial advice.
- attendance: a student arrived, left, or is absent. attendanceStatus present|absent.
- plan_request: a request about a FUTURE class plan (e.g. "next class more sparring"). content = the request.
- parent_message: an explicit request to contact a student's parent/guardian. content = what to tell them.
- add_drill: adding a drill to TODAY's class. content = drill name; minutes if spoken.
- Injuries or pain: record only as a feedback observation (no diagnosis, no advice).
- One utterance can hold several intents, e.g. feedback for two students plus a billing note.`

export async function routeUtterance(
  deps: Deps,
  a: { sessionId: string; transcript: string; roster: RosterStudent[]; drillName: string | null; theme: string },
): Promise<Intent[] | null> {
  const prompt = [
    `Roster: ${a.roster.map(s => (s.nickname ? `${s.name} ("${s.nickname}")` : s.name)).join('; ')}`,
    `Current drill: ${a.drillName ?? 'none'}`,
    `Weekly theme: ${a.theme}`,
    `Utterance: """${a.transcript}"""`,
  ].join('\n')
  return withRun(deps, { agent: 'router', trigger: 'utterance', sessionId: a.sessionId }, async () => {
    const out = await deps.llm.object({ name: 'router', instructions: ROUTER_INSTRUCTIONS, prompt, schema: RouterOutput })
    return {
      result: out.intents,
      summary: `Sorted "${a.transcript.slice(0, 60)}" into ${out.intents.map(i => i.type).join(', ') || 'nothing'}`,
      reason: `${out.intents.length} intent(s)`,
      output: out,
    }
  })
}
