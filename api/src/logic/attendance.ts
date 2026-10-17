const EXCEPT = /^(?:everyone|everybody|all)(?:['\u2019]s|\s+is|\s+are)?(?:\s+(?:here|present))?,?\s+(?:except(?:\s+for)?|but)\s+(.+?)[.!]?$/i
const ALL = /^(?:everyone|everybody|all)(?:['\u2019]s|\s+is|\s+are)?\s+(?:here|present)[.!]?$/i

export function splitNames(list: string): string[] {
  return list.split(/,|\band\b|&/i).map(s => s.trim()).filter(Boolean)
}

export function parseAttendance(t: string): { kind: 'except'; names: string[] } | { kind: 'all' } | null {
  const s = t.trim()
  const m = EXCEPT.exec(s)
  if (m?.[1]) {
    const names = splitNames(m[1])
    if (names.some(n => n.split(/\s+/).length > 2)) return null
    return { kind: 'except', names }
  }
  if (ALL.test(s)) return { kind: 'all' }
  return null
}
