import type { DeckDiff, DrillDraft } from '@matside/shared'

export type ExistingDrill = DrillDraft & { id: string; position: number }
export type PlannedDrill = DrillDraft & { id: string | null }

const draftOf = (d: DrillDraft): DrillDraft => ({ name: d.name, minutes: d.minutes, kind: d.kind, cues: d.cues, focusStudentIds: d.focusStudentIds, rationale: d.rationale })

export function applyDiff(drills: ExistingDrill[], diff: DeckDiff): PlannedDrill[] {
  const removed = new Set(diff.removed.map(r => r.drillId))
  const changed = new Map(diff.changed.map(c => [c.drillId, c.after]))
  const kept = [...drills].sort((a, b) => a.position - b.position).filter(d => !removed.has(d.id))
  const out: (PlannedDrill & { origPos: number })[] = kept.map(d => ({ ...draftOf(changed.get(d.id) ?? d), id: d.id, origPos: d.position }))
  const adds = [...diff.added].sort((a, b) => b.afterPosition - a.afterPosition)
  for (const a of adds) {
    const item = { ...draftOf(a), id: null, origPos: -1 }
    if (a.afterPosition === 0) { out.unshift(item); continue }
    const idx = out.findIndex(x => x.origPos === a.afterPosition)
    if (idx === -1) out.push(item)
    else out.splice(idx + 1, 0, item)
  }
  return out.map(({ origPos: _o, ...rest }) => rest)
}

export function totalMinutes(d: { minutes: number }[]): number {
  return d.reduce((n, x) => n + x.minutes, 0)
}
