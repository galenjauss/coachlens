import { readFileSync } from 'node:fs'
import { RouterOutput } from '@matside/shared'
import { gatewayLlm } from '../src/agents/llm'
import { ROUTER_INSTRUCTIONS } from '../src/agents/router'

type Case = { t: string; types: string[]; names: string[]; urgency?: string }
const cases: Case[] = JSON.parse(readFileSync(new URL('./router-cases.json', import.meta.url), 'utf8'))
const roster = 'Priya Rao; Sam Lee; Ava Kim; Leo Diaz ("Leo"); Maya Chen; Jake Ross; Mia Lopez; Ben Ortiz; Cal Wu; Dee Park'
const llm = gatewayLlm()
let pass = 0
for (const c of cases) {
  const out = await llm.object({ name: 'router', instructions: ROUTER_INSTRUCTIONS, schema: RouterOutput,
    prompt: `Roster: ${roster}\nCurrent drill: Guard-up jab drill\nWeekly theme: Stances\nUtterance: """${c.t}"""` })
  const types = [...new Set(out.intents.map(i => i.type))].sort()
  const names = [...new Set(out.intents.flatMap(i => i.studentNames))]
  const ok = JSON.stringify(types) === JSON.stringify([...c.types].sort())
    && c.names.every(n => names.some(x => x.toLowerCase().includes(n.toLowerCase())))
    && (!c.urgency || out.intents.some(i => i.urgency === c.urgency))
  if (ok) pass++
  console.log(ok ? 'PASS' : 'FAIL', c.t, ok ? '' : JSON.stringify(out.intents))
}
console.log(`${pass}/${cases.length}`)
if (pass < 13) process.exit(1)
