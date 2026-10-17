import type { NextStudent, SkillTag, StudentRef } from '@matside/shared'

export interface RankInput {
  present: StudentRef[]
  notedIds: Set<string>
  remindIds: Set<string>
  openIssue: Map<string, SkillTag>
  lastNoteAt: Map<string, Date>
  now: Date
}

const DAY = 86_400_000

export function rankNextStudent(i: RankInput): NextStudent | null {
  const eligible = i.present.filter(s => !i.notedIds.has(s.id))
  if (!eligible.length) return null
  const key = (s: StudentRef) => [i.remindIds.has(s.id) ? 0 : 1, i.openIssue.has(s.id) ? 0 : 1, i.lastNoteAt.get(s.id)?.getTime() ?? 0] as const
  const sorted = [...eligible].sort((a, b) => {
    const x = key(a), y = key(b)
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]
  })
  const s = sorted[0]!
  const last = i.lastNoteAt.get(s.id)
  const reason = i.remindIds.has(s.id) ? 'missed last class'
    : i.openIssue.get(s.id) ?? (last ? `${Math.floor((i.now.getTime() - last.getTime()) / DAY)} days since note` : 'no notes yet')
  return { id: s.id, name: s.name, reason }
}
