# Amendment C: cost controls (applies to Task 12b and Task 13; overrides the Global Constraints "Model" line)

**Source:** Galen's decision. Protect the $200 Claude API credit before the demo.

## Decisions
1. **Call Anthropic directly with the user's own key. Do not use AI Gateway.**
   - Use `@ai-sdk/anthropic` with the env var `ANTHROPIC_API_KEY`. The user explicitly asked for a direct provider key.
   - Remove `AI_GATEWAY_API_KEY` from env docs.
2. **Model routing by agent:**
   - **fast** = `claude-haiku-5-5`, for `router` (every utterance; also faster for the ≤3 s target).
   - **smart** = `claude-sonnet-5-5`, for `planner.*`, `parent_email` and `report_card`.
   - Model ids come from env `MODEL_FAST` / `MODEL_SMART` with those defaults.
3. **Daily AI-call cap**, `AI_DAILY_CAP` (default 400 calls per day in the America/Los_Angeles day).
   - Over the cap, `Llm.object` throws `BudgetExceededError` *before* calling the provider.
   - The existing `withRun` error path logs it as an error run with summary "Daily AI budget reached".
   - The router failure path already saves the note as unassigned (card: `● Saved · sorting failed, see Review`).
   - Implementation: a new table `llm_usage(day text primary key, calls integer not null default 0)` with an atomic upsert-increment: `insert … on conflict (day) do update set calls = llm_usage.calls + 1 returning calls`. If the returned value is over the cap → throw. Counting happens before the call, so failed calls still count, which is fine.
4. **Speech-to-text stays OpenAI** (`gpt-4o-transcribe`, pennies per minute).
5. The user sets a spend limit in the Anthropic Console. Add it to the README setup steps.

## Code changes
- **`api/src/agents/llm.ts`:**
  - Replace `gatewayLlm` with `anthropicLlm(opts: { fast: string; smart: string; budget: Budget })`.
  - Pick `fast` when `name === 'router'`, otherwise `smart`.
  - Use `generateText({ model: anthropic(modelId), instructions, prompt, output: Output.object({ schema }) })` and return `schema.parse(output)`.
  - Keep `MODEL_FAST` / `MODEL_SMART` constants as defaults.
  - Update `evals/run-router.ts` to use `anthropicLlm` with a no-op budget.
- **`api/src/agents/budget.ts`** (new):
  - `interface Budget { take(): Promise<void> }`
  - `dbBudget(db, cap, tz, now)`
  - `class BudgetExceededError extends Error`
  - Unit tests with PGlite: cap 2 → the third `take()` throws, and the counter resets on a new day.
- **Migration** for `llm_usage`.
- **`api/package.json`:** add the `@ai-sdk/anthropic` dependency at a version compatible with `ai@7`. Check `npm view @ai-sdk/anthropic version` and the peer range.
- **Task 13 `prod.ts`:**
  - `llm: anthropicLlm({ fast: env MODEL_FAST, smart: env MODEL_SMART, budget: dbBudget(db, Number(AI_DAILY_CAP ?? 400), tz, () => new Date()) })`.
  - Required env: `ANTHROPIC_API_KEY` (read implicitly by the provider; `prodDeps` must check it is present).
  - Also enforce `PAIRING_CODE.length >= 6` (cross-task note from the Task 8 review).
- **`api/.env.example`:**
  - Replace `AI_GATEWAY_API_KEY` with `ANTHROPIC_API_KEY`.
  - Add `MODEL_FAST=claude-haiku-5-5`, `MODEL_SMART=claude-sonnet-5-5`, `AI_DAILY_CAP=400`.

## Where it runs
**Task 12b** builds the budget table, the guard and the new `anthropicLlm`, together with the modes work (both touch `llm.ts` and the agents). **Task 13** wires `prodDeps`.
