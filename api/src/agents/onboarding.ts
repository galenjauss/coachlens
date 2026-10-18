import { MODE_IDS, MODES, ModeProposal, type ExtractRequest, type ExtractResponse, type ModeId } from '@matside/shared'
import type { Deps, LlmImage } from '../deps'
import { cleanClasses, cleanCurriculum, cleanRoster, mergeNotes, RawClasses, RawCurriculum, RawRoster } from '../logic/onboarding'

const modeList = MODE_IDS.map(id => `${id} (${MODES[id].label})`).join(', ')

const BASE = `You help a coach set up CoachLens from their own documents: pasted text, a CSV, or a photo of a schedule, sign-in sheet or notes.
- Extract only what is in the source. Never invent people, emails, classes or dates. Use null for anything you cannot read.
- Photos may be handwritten or at an angle: read carefully; when a value is a guess, still return it and mention it in notes.
- notes: one or two short plain sentences for the coach saying what you found and what is missing or unclear. No markdown.`

function instructionsFor(step: ExtractRequest['step'], mode: ModeId): string {
  const m = MODES[mode]
  switch (step) {
    case 'mode':
      return `${BASE}\nTask: pick the closest coaching mode for this business from: ${modeList}. reason: one short sentence.`
    case 'classes':
      return `${BASE}\nTask: list the recurring weekly ${m.label.toLowerCase()} classes.
- name: short class name as written (≤60 chars). If one class meets on several days, return one entry per day and add the day to the name (e.g. "Kids · Tue").
- weekday: the day name in English (e.g. "Tuesday").
- startTime: 24-hour "HH:MM" (5:30 PM → "17:30").
- mode: one of ${MODE_IDS.join(', ')}; default ${mode}.`
    case 'roster':
      return `${BASE}\nTask: list every ${m.person} on the roster or sign-in sheet.
- name: full name as written. nickname: only if the source gives one.
- level: their ${mode === 'martial_arts' ? 'belt' : 'level or grade'} if given.
- age: whole years if given (convert a birth year using the current year), else null.
- guardianName / guardianEmail: the ${m.recipient}'s name and email if given; copy emails exactly.
- classNames: classes this ${m.person} attends if the source says, else [].
- notes: say how many have ${m.recipient} emails and how many are missing.`
    case 'curriculum':
      return `${BASE}\nTask: turn curriculum notes into weekly entries.
- week: 1 for the first week listed, 2 for the next, and so on.
- weekStart: the Monday of that week as YYYY-MM-DD only if the source gives a date, else null.
- theme: the week's ${m.weeklyLabel.toLowerCase()} (≤80 chars).
- itemsDue: the ${m.itemsDueLabel.toLowerCase()} for that week (≤10 short items).`
  }
}

/** One extraction call for one quiz step. Throws BudgetExceededError or provider errors (mapped by the route). */
export async function extractOnboarding(deps: Deps, req: ExtractRequest, today: string): Promise<ExtractResponse> {
  const mode: ModeId = req.mode ?? 'martial_arts'
  const images: LlmImage[] | undefined = req.imageBase64 ? [{ data: req.imageBase64, mediaType: req.mimeType ?? 'image/jpeg' }] : undefined
  const source = req.text?.trim() ? `Source text:\n"""\n${req.text.trim()}\n"""` : 'Source: the attached image.'
  const prompt = `Today is ${today}.\n${source}${req.text?.trim() && images ? '\nAlso use the attached image.' : ''}`
  const base = { name: `onboarding.${req.step}`, instructions: instructionsFor(req.step, mode), prompt, images }
  switch (req.step) {
    case 'mode': {
      const out = await deps.llm.object({ ...base, schema: ModeProposal })
      return { step: 'mode', mode: out.mode, reason: out.reason }
    }
    case 'classes': {
      const out = await deps.llm.object({ ...base, schema: RawClasses })
      const c = cleanClasses(out, mode, MODE_IDS)
      return { step: 'classes', classes: c.items, notes: mergeNotes(out.notes, c.dropped, 'classes') }
    }
    case 'roster': {
      const out = await deps.llm.object({ ...base, schema: RawRoster })
      const c = cleanRoster(out)
      return { step: 'roster', students: c.items, notes: mergeNotes(out.notes, c.dropped, 'entries') }
    }
    case 'curriculum': {
      const out = await deps.llm.object({ ...base, schema: RawCurriculum })
      const c = cleanCurriculum(out)
      return { step: 'curriculum', weeks: c.items, notes: mergeNotes(out.notes, c.dropped, 'weeks') }
    }
  }
}
