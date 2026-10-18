const EXCEPT = /^(?:everyone|everybody|all)(?:['\u2019]s|\s+is|\s+are)?(?:\s+(?:here|present))?,?\s+(?:except(?:\s+for)?|but)\s+(.+?)[.!]?$/i
const ALL = /^(?:everyone|everybody|all)(?:['\u2019]s|\s+is|\s+are)?\s+(?:here|present)[.!]?$/i

const PRESENT = /^(?:present|here)\s*[:,\-\u2013\u2014]\s*(.+?)[.!]?$/i
const ONLY = /^only\s+(.+?)(?:\s+(?:is|are))?\s+(?:here|present)[.!]?$/i

export type RollCall = { kind: 'except'; names: string[] } | { kind: 'present'; names: string[] } | { kind: 'all' }

export function splitNames(list: string): string[] {
  return list.split(/,|\band\b|&/i).map(s => s.trim()).filter(Boolean)
}

const nameList = (list: string): string[] | null => {
  const names = splitNames(list)
  return names.length && !names.some(n => n.split(/\s+/).length > 2) ? names : null
}

export function parseAttendance(t: string): RollCall | null {
  const s = t.trim()
  const m = EXCEPT.exec(s)
  if (m?.[1]) {
    const names = nameList(m[1])
    return names ? { kind: 'except', names } : null
  }
  if (ALL.test(s)) return { kind: 'all' }
  const p = PRESENT.exec(s) ?? ONLY.exec(s)
  if (p?.[1]) {
    const names = nameList(p[1])
    return names ? { kind: 'present', names } : null
  }
  return null
}
