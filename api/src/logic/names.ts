import { isNameLike, type RosterStudent, type StudentRef } from '@matside/shared'

export const AUTO_MATCH = 0.88
export const AMBIGUOUS = 0.75

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1
  const la = a.length, lb = b.length
  if (!la || !lb) return 0
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1)
  const aM = new Array<boolean>(la).fill(false)
  const bM = new Array<boolean>(lb).fill(false)
  let matches = 0
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb)
    for (let j = lo; j < hi; j++) {
      if (!bM[j] && a[i] === b[j]) { aM[i] = true; bM[j] = true; matches++; break }
    }
  }
  if (!matches) return 0
  let t = 0, k = 0
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue
    while (!bM[k]) k++
    if (a[i] !== b[k]) t++
    k++
  }
  const jaro = (matches / la + matches / lb + (matches - t / 2) / matches) / 3
  let p = 0
  while (p < 4 && p < la && p < lb && a[p] === b[p]) p++
  return jaro + p * 0.1 * (1 - jaro)
}

export const norm = (s: string) => s.toLowerCase().replace(/['\u2019]s\b/g, '').replace(/[^a-z\s-]/g, '').trim()

function scoreStudent(heard: string, s: RosterStudent): number {
  const h = norm(heard)
  const candidates = [s.name, s.name.split(' ')[0] ?? s.name, s.nickname ?? '', ...(s.aliases ?? [])].map(norm).filter(Boolean)
  return Math.max(...candidates.map(c => jaroWinkler(h, c)))
}

export type NameMatch =
  | { kind: 'match'; student: RosterStudent }
  | { kind: 'ambiguous'; options: [StudentRef, StudentRef] }
  | { kind: 'none' }

export function resolveName(heard: string, roster: RosterStudent[]): NameMatch {
  const ranked = roster.map(s => ({ s, score: scoreStudent(heard, s) })).sort((x, y) => y.score - x.score)
  const [best, second] = ranked
  if (!best || best.score < AMBIGUOUS) return { kind: 'none' }
  if (best.score >= AUTO_MATCH && (!second || second.score < AUTO_MATCH || best.score - second.score >= 0.05)) return { kind: 'match', student: best.s }
  if (!second || second.score < AMBIGUOUS) return { kind: 'none' }
  return { kind: 'ambiguous', options: [{ id: best.s.id, name: best.s.name }, { id: second.s.id, name: second.s.name }] }
}

/**
 * Learn a heard spelling as an alias: deduped (case/punctuation-insensitive), skipped when it already
 * equals the name, first name or nickname, keeping the most recent `max`.
 */
/** Dedupe key for aliases: "Pree-ya", "Preeya" and "preeya's" collapse. */
export const aliasKey = (s: string) => norm(s).replace(/[^a-z]/g, '')

export function addAlias(s: { name: string; nickname: string | null; aliases: string[] }, heard: string | null, max = 10): string[] {
  const h = heard?.trim().replace(/\s+/g, ' ') ?? ''
  if (!isNameLike(h)) return s.aliases
  const key = aliasKey(h)
  if (!key) return s.aliases
  const known = [s.name, s.name.split(' ')[0] ?? '', s.nickname ?? ''].map(aliasKey)
  if (known.includes(key) || s.aliases.some(a => aliasKey(a) === key)) return s.aliases
  return [...s.aliases, h.slice(0, 40)].slice(-max)
}
