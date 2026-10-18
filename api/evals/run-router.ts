// Live router eval against Anthropic (needs ANTHROPIC_API_KEY). Runs one suite per teaching mode.
import { readFileSync } from 'node:fs'
import { MODES, routerOutputFor, type ModeId } from '@matside/shared'
import { anthropicLlm, MODEL_FAST, MODEL_SMART } from '../src/agents/llm'
import { noBudget } from '../src/agents/budget'
import { routerInstructions } from '../src/agents/router'

type Case = { t: string; types: string[]; names: string[]; urgency?: string; tags?: string[] }
interface Suite { file: string; mode: ModeId; roster: string; drill: string; theme: string; min: number }

const SUITES: Suite[] = [
  { file: 'router-cases.json', mode: 'martial_arts', min: 15, drill: 'Guard-up jab drill', theme: 'Stances',
    roster: 'Priya Rao; Sam Lee; Ava Kim; Leo Diaz ("Leo"); Maya Chen; Jake Ross; Mia Lopez; Ben Ortiz; Cal Wu; Dee Park' },
  { file: 'router-cases-pt.json', mode: 'personal_training', min: 6, drill: 'Back squat 5×5', theme: 'Lower-body strength',
    roster: 'Maria Gomez; Tom Becker; Priyanka Shah; Derek Owens; Lena Fischer' },
  { file: 'router-cases-tutoring.json', mode: 'tutoring', min: 6, drill: 'Guided: distribute first', theme: 'Linear equations',
    roster: 'Sam Patel; Ava Brooks; Noah Kim; Zoe Alvarez' },
]

const llm = anthropicLlm({ fast: process.env.MODEL_FAST || MODEL_FAST, smart: process.env.MODEL_SMART || MODEL_SMART, budget: noBudget })
let failed = false
for (const s of SUITES) {
  const mode = MODES[s.mode]
  const cases: Case[] = JSON.parse(readFileSync(new URL(`./${s.file}`, import.meta.url), 'utf8'))
  let pass = 0
  console.log(`\n== ${mode.label} (${s.file})`)
  for (const c of cases) {
    const out = await llm.object({ name: 'router', instructions: routerInstructions(mode), schema: routerOutputFor(s.mode),
      prompt: `Roster: ${s.roster}\nCurrent ${mode.planItem}: ${s.drill}\n${mode.weeklyLabel}: ${s.theme}\nToday: 2026-10-19\nUtterance: """${c.t}"""` })
    const types = [...new Set(out.intents.map(i => i.type))].sort()
    const names = [...new Set(out.intents.flatMap(i => i.studentNames))]
    const tags = out.intents.flatMap(i => i.skillTags)
    const ok = JSON.stringify(types) === JSON.stringify([...c.types].sort())
      && c.names.every(n => names.some(x => x.toLowerCase().includes(n.toLowerCase())))
      && (!c.urgency || out.intents.some(i => i.urgency === c.urgency))
      && (!c.tags || tags.some(t => c.tags!.includes(t)))
    if (ok) pass++
    console.log(ok ? 'PASS' : 'FAIL', c.t, ok ? '' : JSON.stringify(out.intents))
  }
  console.log(`${pass}/${cases.length} (need ${s.min})`)
  if (pass < s.min) failed = true
}
if (failed) process.exit(1)
