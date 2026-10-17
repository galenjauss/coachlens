import type { DeckDiff, DrillDraft } from '@matside/shared'

export type ExistingDrill = DrillDraft & { id: string; position: number }
export type PlannedDrill = DrillDraft & { id: string | null }

const draftOf = (d: DrillDraft): DrillDraft => ({ name: d.name, minutes: d.minutes, kind: d.kind, cues: d.cues, focusStudentIds: d.focusStudentIds, rationale: d.rationale })

export function applyDiff(drills: ExistingDrill[], diff: DeckDiff): PlannedDrill[] {
  const removed = new Set(diff.removed.map(r => r.drillId))
  const changed = new Map(diff.changed.map(c => [c.drillId, c.after]))
  const kept = [...drills].sort((a, b) => a.position - b.position).filter(d => !removed.has(d.id))
  // slots[n] = adds inserted after the n-th kept drill (slot 0 = start). Anchors use ORIGINAL positions.
  const slots: PlannedDrill[][] = Array.from({ length: kept.length + 1 }, () => [])
  for (const a of diff.added) {
    const slot = kept.filter(d => d.position <= a.afterPosition).length
    slots[slot]!.push({ ...draftOf(a), id: null })
  }
  const out: PlannedDrill[] = [...slots[0]!]
  kept.forEach((d, i) => {
    out.push({ ...draftOf(changed.get(d.id) ?? d), id: d.id }, ...slots[i + 1]!)
  })
  return out
}

export function totalMinutes(d: { minutes: number }[]): number {
  return d.reduce((n, x) => n + x.minutes, 0)
}
