import type { Db } from './client'
import * as t from './schema'
import { addDays, nextDateForWeekday } from '../logic/dates'

// Demo history: past finished sessions with attendance and in-session notes, so attendance dots render and the
// insight detectors have believable hits on the first run after seeding.

export const PAST_SESSIONS_PER_CLASS = 6

export interface PastSession { id: string; classId: string; forDate: string; startedAt: Date }

/** Class start as a UTC instant: 17:00 Pacific (00:00Z the next day) is close enough for every seeded class. */
const startOf = (forDate: string) => new Date(`${addDays(forDate, 1)}T00:00:00Z`)

/** The last `n` meetings of a class strictly before today, each with a finished (empty) deck. Oldest first. */
export async function pastSessions(db: Db, classId: string, weekday: number, today: string, n = PAST_SESSIONS_PER_CLASS): Promise<PastSession[]> {
  const latest = nextDateForWeekday(addDays(today, -8), weekday) // in [today-7, today-1]
  const dates = Array.from({ length: n }, (_, k) => addDays(latest, -7 * (n - 1 - k)))
  const out: PastSession[] = []
  for (const forDate of dates) {
    const [deck] = await db.insert(t.decks).values({ classId, forDate, status: 'done' }).returning()
    const startedAt = startOf(forDate)
    const [s] = await db.insert(t.sessions).values({ classId, deckId: deck!.id, forDate, startedAt, endedAt: new Date(startedAt.getTime() + 45 * 60_000) }).returning()
    out.push({ id: s!.id, classId, forDate, startedAt })
  }
  return out
}

/**
 * Writes attendance for sessions (merged across classes, oldest first). `absentAgo(studentId)` lists positions counted
 * from the most recent session (0 = latest) at which that student was absent. Everyone enrolled is recorded.
 */
export async function recordAttendance(db: Db, sessions: PastSession[], roster: Map<string, string[]>, absentAgo: (studentId: string) => readonly number[]) {
  const ordered = [...sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
  const rows = ordered.flatMap((s, i) => (roster.get(s.classId) ?? []).map(studentId => ({
    sessionId: s.id, studentId, source: 'phone' as const,
    status: absentAgo(studentId).includes(ordered.length - 1 - i) ? 'absent' as const : 'present' as const,
  })))
  if (rows.length) await db.insert(t.attendance).values(rows)
  return ordered
}

/** One untagged note in a given session (`ago` sessions back in the merged order), 10 minutes into class. */
export async function sessionNotes(db: Db, ordered: PastSession[], items: readonly { studentId: string; ago: number; text: string }[]) {
  const rows = items.map(n => {
    const s = ordered[ordered.length - 1 - n.ago]!
    return { sessionId: s.id, studentId: n.studentId, text: n.text, createdAt: new Date(s.startedAt.getTime() + 10 * 60_000) }
  })
  if (rows.length) await db.insert(t.notes).values(rows)
}
