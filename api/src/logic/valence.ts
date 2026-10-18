// PURE: what an observation means. The router labels new notes; rows written before migration 0013 (and router
// replies that omit the field) fall back to a conservative reading of the text. Only current concerns count toward
// a recurring issue; praise and improvement never do.
import type { Valence } from '@matside/shared'

const IMPROVING = /\b(better|improv(?:e|ed|es|ing|ement)|getting (?:higher|better|stronger|cleaner|faster|there)|progress(?:ed|ing)?|more consistent|much stronger)\b/i
const POSITIVE = /\b(great|good|nice|excellent|awesome|strong|solid|clean|sharp|perfect|proud|nailed|kept|remembered|helped|led|confident(?:ly)?|calm|steady|control|hustle|listened|well done|fantastic|beautiful|impressive)\b/i
const CONCERN = /\b(drop(?:s|ped|ping)?|low|lazy|sloppy|forg[eo]t\w*|struggl\w*|trouble|too (?:short|high|low|fast|slow|wide|narrow)|not|\w+n['’]t|never|talking|careless|cut short|skipp\w*|miss(?:ed|es|ing)?|rush(?:ed|ing)?|hurt|pain|injur\w*|again|wrong|poor|weak|late|distracted|rolled|fell|hit)\b/i

const matches = (re: RegExp, text: string) => (text.match(new RegExp(re.source, 'gi')) ?? []).length

/**
 * Best-effort valence of free text, for rows the router did not label. Ambiguous text is neutral, so it never
 * counts toward an issue; an explicit concern word outweighs a single praise word ("drops again, great energy though").
 */
export function inferValence(text: string): Valence {
  const concern = matches(CONCERN, text)
  const positive = matches(POSITIVE, text)
  if (IMPROVING.test(text) && concern <= positive) return 'improving'
  if (concern > positive) return 'concern'
  if (positive > concern) return 'positive'
  return 'neutral'
}

export interface ValenceRow { valence: Valence | null; text: string }

/** The stored valence, else the text's. */
export const effectiveValence = (r: ValenceRow): Valence => r.valence ?? inferValence(r.text)

/** True for a current (not historical) concern: the only kind that counts toward a recurring issue. */
export const countsAsConcern = (r: ValenceRow & { historical: boolean }): boolean => !r.historical && effectiveValence(r) === 'concern'

/** Praise or improvement: evidence an open issue may be getting better. */
export const isPositive = (v: Valence): boolean => v === 'positive' || v === 'improving'
