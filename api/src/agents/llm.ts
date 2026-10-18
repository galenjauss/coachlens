import { generateText, Output } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import type { Llm } from '../deps'
import type { Budget } from './budget'

// Direct Anthropic provider; auth via ANTHROPIC_API_KEY (read by @ai-sdk/anthropic).
export const MODEL_FAST = 'claude-haiku-5-5' // router + answer: in class, latency-sensitive
export const MODEL_SMART = 'claude-sonnet-5-5' // planner.*, parent_email, report_card

export interface ModelChoice { fast: string; smart: string }

/** Agents the coach waits on mid-class: these run on the fast model; every other agent uses the smart one. */
export const FAST_AGENTS: ReadonlySet<string> = new Set(['router', 'answer'])

export function modelFor(name: string, opts: ModelChoice): string {
  return FAST_AGENTS.has(name) ? opts.fast : opts.smart
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
