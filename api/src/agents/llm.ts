import { generateText, Output } from 'ai'
import type { Llm } from '../deps'

export const MODEL = 'anthropic/claude-sonnet-5-5'

// Uses AI Gateway: plain "provider/model" strings; auth via AI_GATEWAY_API_KEY or Vercel OIDC.
export function gatewayLlm(model: string = MODEL): Llm {
  return {
    async object({ instructions, prompt, schema }) {
      const { output } = await generateText({ model, instructions, prompt, output: Output.object({ schema }) })
      return schema.parse(output)
    },
  }
}
