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
    async object({ name, instructions, prompt, schema, images }) {
      await opts.budget.take() // throws BudgetExceededError before any provider call
      const model = anthropic(modelFor(name, opts))
      const output = Output.object({ schema })
      const { output: out } = images?.length
        ? await generateText({
          model, instructions, output,
          messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...images.map(i => ({ type: 'file' as const, mediaType: i.mediaType, data: i.data }))] }],
        })
        : await generateText({ model, instructions, prompt, output })
      return schema.parse(out)
    },
  }
}
