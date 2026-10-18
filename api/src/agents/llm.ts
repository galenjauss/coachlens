import { generateText, Output } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { Llm } from '../deps'
import type { Budget } from './budget'

// Direct Anthropic provider; auth via ANTHROPIC_API_KEY (read by @ai-sdk/anthropic).
export const MODEL_FAST = 'claude-haiku-5-5' // router: every utterance, latency-sensitive
export const MODEL_SMART = 'claude-sonnet-5-5' // planner.*, parent_email, report_card

export interface ModelChoice { fast: string; smart: string }

export function modelFor(name: string, opts: ModelChoice): string {
  return name === 'router' ? opts.fast : opts.smart
}

export function anthropicLlm(opts: ModelChoice & { budget: Budget }): Llm {
  return {
    async object({ name, instructions, prompt, schema }) {
      await opts.budget.take() // throws BudgetExceededError before any provider call
      const { output } = await generateText({ model: anthropic(modelFor(name, opts)), instructions, prompt, output: Output.object({ schema }) })
      return schema.parse(output)
    },
  }
}
