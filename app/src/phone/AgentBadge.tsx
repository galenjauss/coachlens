import type { AgentColor } from '@matside/shared'
import { COLOR_WORD } from './agentsLogic'

/** Color + word, so status never relies on color alone. */
export function AgentBadge({ color, failed }: { color: AgentColor; failed?: boolean }) {
  return <span className={`abadge ${color}`}>{failed ? 'Failed' : COLOR_WORD[color]}</span>
}
