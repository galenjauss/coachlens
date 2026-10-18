import { ClassCreate, ClassUpdate, GuardianInput, type ModeId, type StudentCreate, type StudentUpdate } from '@matside/shared'

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }
export type GuardianDraft = { name: string; email: string }
export type StudentDraft = { name: string; nickname: string; belt: string; classIds: string[]; guardians: GuardianDraft[] }
export type ClassDraft = { name: string; mode: ModeId; startTime: string; weekday: number }
/** Editing: weekday null / startTime '' = not known from the server (left unset, never defaulted). */
export type ClassEditDraft = { name: string; mode: ModeId; startTime: string; weekday: number | null }
export type ClassRowLike = { name: string; mode: ModeId; startTime?: string; weekday?: number }

/** Guardians from the form: blank rows are ignored; a half-filled row is an error naming it. */
function guardians(rows: readonly GuardianDraft[]): Result<{ name: string; email: string }[]> {
  const out: { name: string; email: string }[] = []
  for (const [i, g] of rows.entries()) {
    const name = g.name.trim(), email = g.email.trim()
    if (!name && !email) continue
    if (!name) return { ok: false, error: `Guardian ${i + 1}: enter a name.` }
    if (!GuardianInput.safeParse({ name, email }).success) return { ok: false, error: `Guardian ${i + 1}: enter a valid email.` }
    out.push({ name, email })
  }
  return { ok: true, value: out }
}

/** Add student (C3 POST /v1/students). */
export function studentCreatePayload(d: StudentDraft): Result<StudentCreate> {
  const name = d.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!d.classIds.length) return { ok: false, error: 'Pick at least one class.' }
  const g = guardians(d.guardians)
  if (!g.ok) return g
  const nickname = d.nickname.trim(), belt = d.belt.trim()
  return { ok: true, value: { name, ...(nickname ? { nickname } : {}), ...(belt ? { belt } : {}), classIds: [...d.classIds], ...(g.value.length ? { guardians: g.value } : {}) } }
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x))

/**
 * Edit student (C3 PATCH): only changed fields. Guardians REPLACE the stored list, so they are sent only
 * when the coach edited them (an older server may not have told us the current list: never wipe it blind).
 */
export function studentUpdatePayload(before: StudentDraft, after: StudentDraft, o: { guardiansTouched: boolean }): Result<StudentUpdate> {
  const name = after.name.trim()
  if (!name) return { ok: false, error: 'Name is required.' }
  if (!after.classIds.length) return { ok: false, error: 'Pick at least one class.' }
  const patch: StudentUpdate = {}
  if (name !== before.name.trim()) patch.name = name
  if (after.nickname.trim() !== before.nickname.trim()) patch.nickname = after.nickname.trim() || null
  if (after.belt.trim() && after.belt.trim() !== before.belt.trim()) patch.belt = after.belt.trim()
  if (!sameSet(after.classIds, before.classIds)) patch.classIds = [...after.classIds]
  if (o.guardiansTouched) {
    const g = guardians(after.guardians)
    if (!g.ok) return g
    patch.guardians = g.value
  }
  return { ok: true, value: patch }
}

/** Add / edit class (C3): the class row's fields. */
export function classPayload(d: ClassDraft): Result<ClassCreate> {
  const name = d.name.trim()
  if (!name) return { ok: false, error: 'Class name is required.' }
  const parsed = ClassCreate.safeParse({ name, mode: d.mode, startTime: d.startTime.trim(), weekday: d.weekday })
  if (!parsed.success) {
    const bad = parsed.error.issues[0]?.path[0]
    return { ok: false, error: bad === 'startTime' ? 'Start time must look like 18:00.' : bad === 'weekday' ? 'Pick a day.' : 'Check the class details.' }
  }
  return { ok: true, value: parsed.data }
}

/**
 * Edit class (C3 PATCH): a diff against the row. A weekday or start time the server did not send is never
 * defaulted (it would silently move the class): it is only sent once the coach sets it.
 */
export function classUpdatePayload(row: ClassRowLike, d: ClassEditDraft): Result<ClassUpdate> {
  const patch: ClassUpdate = {}
  const name = d.name.trim()
  if (!name) return { ok: false, error: 'Class name is required.' }
  if (name !== row.name) patch.name = name
  if (d.mode !== row.mode) patch.mode = d.mode
  const t = d.startTime.trim()
  if (t && t !== row.startTime) patch.startTime = t
  if (d.weekday !== null && d.weekday !== row.weekday) patch.weekday = d.weekday
  const parsed = ClassUpdate.safeParse(patch)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.path[0] === 'startTime' ? 'Start time must look like 18:00.' : 'Check the class details.' }
  return { ok: true, value: parsed.data }
}
