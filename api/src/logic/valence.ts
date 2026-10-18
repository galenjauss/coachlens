// PURE: what an observation means. The router labels new notes; rows written before migration 0013 are labelled once
// by the backfill script (db/backfill-valence.ts) with inferValence, and router replies that omit the field fall back
// to it too. Only current concerns count toward a recurring issue; praise and improvement never do.
import type { Valence } from '@matside/shared'

const PROBLEM = '(?:drop(?:s|ped|ping)?|forg[eo]t\\w*|miss(?:ed|es|ing)?|rush(?:ed|es|ing)?|slipp?(?:ed|ing|s)?|los(?:e|es|t|ing)|mistakes?|errors?)'
/** A problem word negated ("never dropped it", "no drops", "didn't forget"): evidence of doing it right. */
const NEGATED_PROBLEM = new RegExp(`\\b(?:never|not|no longer|didn['’]?t|did not|doesn['’]?t|without|zero|no)\\s+(?:\\w+\\s+)?${PROBLEM}\\b`, 'gi')
/** "kept/keeps her guard up", "guard up all class": something held up the whole time. "kept" alone is not praise. */
const HELD_UP = /\b(?:keep|keeps|kept|keeping)\s+(?:\w+\s+){0,2}up\b|\b\w+\s+up\s+(?:all|the whole|the entire|every)\b/gi
const IMPROVING = /\b(better|improv(?:e|ed|es|ing|ement)|getting (?:higher|better|stronger|cleaner|faster|there)|progress(?:ed|ing)?|more consistent|much stronger)\b/i
const POSITIVE = /\b(great|good|nice|excellent|awesome|strong|solid|clean(?:ly)?|sharp|perfect|proud|nailed|remembered|helped|led|confident(?:ly)?|calm|steady|control|hustle|listened|well done|fantastic|beautiful|impressive|every target)\b/gi
const CONCERN = new RegExp(`\\b(${PROBLEM}|low|lazy|sloppy|struggl\\w*|trouble|too (?:short|high|low|fast|slow|wide|narrow)|not|\\w+n['’]t|never|talking|careless|cut short|skipp\\w*|hurt|pain|injur\\w*|again|wrong|poor|weak|late|distracted|rolled|fell|hit (?:his|her|their|my|a|another|someone|somebody|him|her) ?\\w*)\\b`, 'gi')

const count = (re: RegExp, text: string) => (text.match(re) ?? []).length

/**
 * Best-effort valence of free text, for rows the router did not label.
 * - A negated problem word ("never dropped", "no drops") and "kept … up" count as praise, and are removed before
 *   looking for problem words.
 * - Any problem word that outnumbers or ties the praise words makes it a concern ("Dropped guard, great energy").
 * - Otherwise improvement words make it improving, praise words positive, and anything else neutral (never counted).
 */
export function inferValence(text: string): Valence {
  const praiseSpans = count(NEGATED_PROBLEM, text) + count(HELD_UP, text)
  const rest = text.replace(NEGATED_PROBLEM, ' ').replace(HELD_UP, ' ')
  const concern = count(CONCERN, rest)
  const positive = count(POSITIVE, rest) + praiseSpans
  if (concern > 0 && concern >= positive) return 'concern'
  if (IMPROVING.test(rest)) return 'improving'
  if (positive > 0) return 'positive'
  return 'neutral'
}

export interface ValenceRow { valence: Valence | null; text: string }

/** The stored valence, else the text's. */
export const effectiveValence = (r: ValenceRow): Valence => r.valence ?? inferValence(r.text)

/** True for a current (not historical) concern: the only kind that counts toward a recurring issue. */
export const countsAsConcern = (r: ValenceRow & { historical: boolean }): boolean => !r.historical && effectiveValence(r) === 'concern'

/** Praise or improvement: evidence an open issue may be getting better. */
export const isPositive = (v: Valence): boolean => v === 'positive' || v === 'improving'
