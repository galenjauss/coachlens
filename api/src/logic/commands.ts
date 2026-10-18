// PURE: obvious commands recognized before the model (F04/F20). A roll call works the same from any capture mode,
// and questions the class data answers deterministically never spend a router call.
import { parseAttendance, type RollCall } from './attendance'
import { isDeterministicQuestion } from '../agents/answer'

export type Command = { kind: 'rollcall'; parsed: RollCall } | { kind: 'question' }

/** A command for the whole utterance, or null to route it through the model. */
export function detectCommand(transcript: string): Command | null {
  const parsed = parseAttendance(transcript)
  if (parsed) return { kind: 'rollcall', parsed }
  if (isDeterministicQuestion(transcript)) return { kind: 'question' }
  return null
}
